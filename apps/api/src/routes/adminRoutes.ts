import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type {
  AiConnectorPolicySettingsDto,
  AppConfigDto,
  ProviderActivityItemDto,
  ProviderActivityResponse,
  ProviderFixerDashboardDiagnosticsResponse,
  ProviderFixerDashboardEvidenceSampleDto,
  ProviderFixerDashboardGuardrailSettingsDto,
  ProviderFixerDashboardLogEntryDto,
  ProviderFixerDashboardLogsResponse,
  ProviderFixerDashboardOperationDto,
  ProviderFixerDashboardOperationsResponse,
  ProviderFixerDashboardSummaryResponse,
  ProviderIncidentDto,
  ProviderIncidentsResponse,
  ProviderLogPurgeExecuteResponse,
  ProviderLogPurgePreviewResponse,
  ProviderOperationOutcomeDto,
  ProviderOperationOutcomesResponse,
  ProviderResolutionMappingDto,
  ProviderResolutionMappingsResponse,
  ProviderUnresolvedItemDto,
  ProviderUnresolvedItemUpdateResponse,
  ProviderUnresolvedItemsResponse,
} from "@vakwen/shared-types";
import {
  ACCOUNT_DEFAULT_CURRENCIES,
  MARKET_CODES,
  DEFAULT_DASHBOARD_PERFORMANCE_RANGES,
  dashboardPerformanceRangesSchema,
} from "@vakwen/shared-types";
import { Env } from "@vakwen/config";
import { signImpersonationCookie } from "../auth/googleOAuth.js";
import { routeError } from "../lib/routeError.js";
import { requireAdminRole } from "../lib/routeGuards.js";
// KZO-198 Fix 3 — DTO is built directly from the post-write row + Env. The
// `getEffective*()` resolvers are NOT imported here because they read from
// the TTL cache, which may briefly be cold immediately after a PATCH
// `invalidate()` and would return env-fallback values for fields the user
// just wrote. The resolver-based cache path is the source of truth for
// source-code paths (rate-limit handlers, providers, etc.) — only the
// admin DTO bypasses it. KZO-197: the `getEffectiveProviderRerunCooldownMs()`
// import below remains for the `/admin/providers/:id/rerun` cooldown gate
// AND the `GET /admin/providers` per-row `rerunCooldownMs` field
// (cache-correct for both paths — the cache value is the same the rerun
// gate consults, so DB ⇄ UI stay coherent under live PATCHes).
import { getEffectiveProviderRerunCooldownMs } from "../services/appConfig/providerHealth.js";
import { PROVIDER_FIXER_DEFAULTS } from "../services/appConfig/providerFixer.js";
import { enqueueAuCatalogBarsBackfill } from "../services/market-data/enqueueAuCatalogBarsBackfill.js";
import { APP_CONFIG_BOUNDS, APP_CONFIG_SECRET_LENGTH } from "../services/appConfig/bounds.js";
import {
  invalidate as invalidateAppConfigCache,
  refresh as refreshAppConfigCache,
} from "../services/appConfig/cache.js";
import type {
  AppConfigPlainField,
  ProviderErrorTrailRow,
  ProviderOperationOutcomeRecord,
  ProviderOperationPhase,
  ProviderOperationRecord,
  SaveAiConnectorPolicySettingsInput,
} from "../persistence/types.js";
import {
  assertFreshAuth,
  createMcpFreshAuthToken,
  updateAiConnectorPolicySettings,
} from "../services/mcpConnectorLifecycle.js";
import {
  FX_REFRESH_QUEUE,
  STORED_QUOTES,
} from "../services/market-data/fxRefreshWorker.js";
import { today_utc } from "../services/market-data/deriveFetchWindow.js";
import { enqueueDailyRefresh } from "../services/market-data/dailyRefreshEnqueue.js";
import { CATALOG_SYNC_QUEUE } from "../services/market-data/registerCatalogSyncWorker.js";
import {
  BACKFILL_QUEUE,
  getBackfillSingletonKey,
  type BackfillJobData,
} from "../services/market-data/backfillWorker.js";
import { RateLimitedError, type MarketDataResolverMode, type ProviderSymbolVerificationResult } from "../services/market-data/types.js";
import { yahooSuffixHintFromKrCatalogEvidence } from "../services/market-data/providers/twelveDataKr.js";
import type { MarketCode } from "@vakwen/domain";
import type {
  AdminProvidersResponse,
  ProviderHealthStatusDto,
  ProviderErrorTrailEntryDto,
} from "@vakwen/shared-types";
import {
  calendarMarketForProvider,
  computeStatus,
  type ProviderId,
} from "../services/market-data/providerHealth.js";
import { listProviderOperationCapabilities } from "../services/market-data/providerOperationCapabilities.js";
import {
  impersonationClearCookieString,
  impersonationSetCookieString,
  requireSessionUserId,
  userRoleSchema,
  userScopedIdSchema,
} from "./registerRoutes.js";

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const fxBaseCurrencySchema = z.enum(ACCOUNT_DEFAULT_CURRENCIES);

function catalogSyncRerunSingletonKey(marketCode: MarketCode): string {
  return `${CATALOG_SYNC_QUEUE}:${marketCode}`;
}

const fxRefreshBodySchema = z
  .object({
    startDate: isoDateSchema.optional(),
    endDate: isoDateSchema.optional(),
    bases: z.array(fxBaseCurrencySchema).min(1).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.startDate && value.endDate && value.startDate > value.endDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "startDate must be before or equal to endDate",
        path: ["startDate"],
      });
    }
  });

const adminProviderRerunBodySchema = z
  .object({
    resolverMode: z.enum(["chart_probe_v1", "quote_first"]).optional(),
    resolverModeRiskAccepted: z.boolean().optional(),
  })
  .strict();

/**
 * KZO-198: a Tier 1 plain field accepts an integer within `APP_CONFIG_BOUNDS`,
 * or `null` to clear the override (falls back to env). Single source of truth
 * for `min`/`max` is `bounds.ts` — never inline here.
 */
function plainBoundedField(key: keyof typeof APP_CONFIG_BOUNDS) {
  const { min, max } = APP_CONFIG_BOUNDS[key];
  return z.union([z.number().int().min(min).max(max), z.null()]).optional();
}

/**
 * KZO-195 — non-int variant for `catalogAbsenceGuardPercent`. Zod's `.int()`
 * is too strict for a percentage that may legitimately be 1.0 / 0.5 / etc.
 */
function plainBoundedDecimalField(key: keyof typeof APP_CONFIG_BOUNDS) {
  const { min, max } = APP_CONFIG_BOUNDS[key];
  return z.union([z.number().min(min).max(max), z.null()]).optional();
}

/**
 * KZO-198 Tier 0: a Tier 0 secret accepts a plaintext string within
 * `APP_CONFIG_SECRET_LENGTH` (denoting a rotation), or `null` to clear.
 * The plaintext is encrypted at the persistence boundary (never logged).
 */
const tier0SecretField = z
  .union([
    z.string().min(APP_CONFIG_SECRET_LENGTH.min).max(APP_CONFIG_SECRET_LENGTH.max),
    z.null(),
  ])
  .optional();

function normalizeMcpOAuthIssuer(value: string): string {
  const url = new URL(value);
  url.pathname = "";
  url.search = "";
  url.hash = "";
  const localRuntime = Env.NODE_ENV === "test" || Env.NODE_ENV === "development";
  const localHost = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(localRuntime && localHost)) {
    throw routeError(400, "mcp_oauth_issuer_https_required", "MCP OAuth public issuer must use HTTPS");
  }
  return url.toString().replace(/\/$/, "");
}

function normalizeMcpOAuthRedirectUri(value: string): string {
  const url = new URL(value);
  const localRuntime = Env.NODE_ENV === "test" || Env.NODE_ENV === "development";
  const localHost = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(localRuntime && localHost)) {
    throw routeError(400, "mcp_oauth_redirect_https_required", "MCP OAuth redirect URIs must use HTTPS");
  }
  if (url.username || url.password || url.search || url.hash || url.pathname === "/" || url.pathname === "") {
    throw routeError(400, "mcp_oauth_redirect_invalid", "MCP OAuth redirect URIs must be exact path URLs without query or hash");
  }
  return url.toString();
}

const aiConnectorPolicySettingsPatchSchema = z
  .object({
    enabled: z.boolean().optional(),
    maxActiveConnectionsPerUser: z.number().int().min(1).max(25).optional(),
    allowedProviders: z
      .object({
        chatgpt: z.boolean().optional(),
        self_hosted: z.boolean().optional(),
      })
      .strict()
      .optional(),
    groupToggles: z
      .object({
        read: z.boolean().optional(),
        drafts: z.boolean().optional(),
        write: z.boolean().optional(),
      })
      .strict()
      .optional(),
    inactivityExpiryDays: z.number().int().min(1).max(365).optional(),
    expirationWarningDays: z.number().int().min(1).max(60).optional(),
    freshAuthMaxAgeMs: z.number().int().min(60_000).max(86_400_000).optional(),
    maxConnectorLifetimeDays: z.number().int().min(1).max(365).optional(),
    oauthPublicIssuer: z.union([
      z.string().url().transform((value) => normalizeMcpOAuthIssuer(value)),
      z.null(),
    ]).optional(),
    oauthRedirectUriAllowlist: z
      .array(z.string().url().transform((value) => normalizeMcpOAuthRedirectUri(value)))
      .max(100)
      .transform((values) => [...new Set(values)])
      .optional(),
    mcpOauthTokenSecret: tier0SecretField,
  })
  .strict();

export const patchAdminSettingsSchema = z
  .object({
    // KZO-133 — pre-existing
    repairCooldownMinutes: plainBoundedField("repairCooldownMinutes"),
    // KZO-159 (158A): admin override for the user-facing timeframe picker.
    // `null` clears the override (falls back to the hardcoded default list).
    dashboardPerformanceRanges: z
      .union([dashboardPerformanceRangesSchema, z.null()])
      .optional(),
    // KZO-189: admin override for AU metadata enrichment mode.
    // `null` clears the override (falls back to Env.METADATA_ENRICHMENT_MODE).
    metadataEnrichmentMode: z
      .union([z.enum(["unconditional", "conditional"]), z.null()])
      .optional(),

    // ── KZO-198 Tier 1 — rate limits ────────────────────────────────────
    marketDataPriceWindowMs: plainBoundedField("marketDataPriceWindowMs"),
    marketDataPriceLimit: plainBoundedField("marketDataPriceLimit"),
    marketDataSearchWindowMs: plainBoundedField("marketDataSearchWindowMs"),
    marketDataSearchLimit: plainBoundedField("marketDataSearchLimit"),
    inviteStatusWindowMs: plainBoundedField("inviteStatusWindowMs"),
    inviteStatusLimit: plainBoundedField("inviteStatusLimit"),

    // ── KZO-198 Tier 1 — provider health ────────────────────────────────
    providerDownNotificationSuppressionMs: plainBoundedField("providerDownNotificationSuppressionMs"),
    providerErrorTrailRetentionDays: plainBoundedField("providerErrorTrailRetentionDays"),
    providerRerunCooldownMs: plainBoundedField("providerRerunCooldownMs"),
    // KZO-197 (surfaced in KZO-199 Phase 4): yahoo-finance-au-specific override.
    yahooAuRerunCooldownMs: plainBoundedField("yahooAuRerunCooldownMs"),
    providerFixerDangerousMatchThreshold: plainBoundedField("providerFixerDangerousMatchThreshold"),
    providerFixerPreviewSampleLimit: plainBoundedField("providerFixerPreviewSampleLimit"),
    providerFixerUiPageSize: plainBoundedField("providerFixerUiPageSize"),
    providerFixerAutoPauseFailuresPerMinute: plainBoundedField("providerFixerAutoPauseFailuresPerMinute"),
    providerFixerPreviewTokenTtlMinutes: plainBoundedField("providerFixerPreviewTokenTtlMinutes"),
    providerOperationAutoRenewIntervalMinutes: plainBoundedField("providerOperationAutoRenewIntervalMinutes"),
    providerIncidentRecurrenceWindowMinutes: plainBoundedField("providerIncidentRecurrenceWindowMinutes"),
    providerHealthWarningUnresolvedThreshold: plainBoundedField("providerHealthWarningUnresolvedThreshold"),
    providerHealthCriticalUnresolvedThreshold: plainBoundedField("providerHealthCriticalUnresolvedThreshold"),
    providerOperationStaleHeartbeatMinutes: plainBoundedField("providerOperationStaleHeartbeatMinutes"),
    providerOperationSummaryRetentionDays: plainBoundedField("providerOperationSummaryRetentionDays"),
    providerOperationLogRetentionDays: plainBoundedField("providerOperationLogRetentionDays"),
    providerIncidentRetentionDays: plainBoundedField("providerIncidentRetentionDays"),
    providerResolvedItemRetentionDays: plainBoundedField("providerResolvedItemRetentionDays"),
    finmindProviderRateLimitPerHour: plainBoundedField("finmindProviderRateLimitPerHour"),
    twelveDataProviderRateLimitPerMinute: plainBoundedField("twelveDataProviderRateLimitPerMinute"),
    yahooAuProviderRateLimitPerMinute: plainBoundedField("yahooAuProviderRateLimitPerMinute"),
    yahooKrProviderRateLimitPerMinute: plainBoundedField("yahooKrProviderRateLimitPerMinute"),
    frankfurterProviderRateLimitPerMinute: plainBoundedField("frankfurterProviderRateLimitPerMinute"),
    asxGicsProviderRateLimitPerHour: plainBoundedField("asxGicsProviderRateLimitPerHour"),

    // ── KZO-198 Tier 1/2 — backfill ─────────────────────────────────────
    backfillRetryLimit: plainBoundedField("backfillRetryLimit"),
    backfillRetryDelaySeconds: plainBoundedField("backfillRetryDelaySeconds"),
    backfillFinmind402RetryMs: plainBoundedField("backfillFinmind402RetryMs"),

    // Tier 2 (`dailyRefreshLookbackDays`, `dailyRefreshPriority`,
    // `sseHeartbeatIntervalMs`, `sseMaxConnectionsPerUser`,
    // `sseBufferDefaultTtlMs`) is DB+SQL only per scope-todo — operators
    // override via direct SQL. `.strict()` below rejects them with a 400.

    // ── KZO-198 Tier 0 — encrypted secrets (rotation flow) ──────────────
    finmindApiToken: tier0SecretField,
    twelveDataApiKey: tier0SecretField,

    // ── KZO-195 Tier 2 — absence-based delisting detection ─────────────
    catalogAbsenceThreshold: plainBoundedField("catalogAbsenceThreshold"),
    catalogAbsenceGuardPercent: plainBoundedDecimalField("catalogAbsenceGuardPercent"),
    catalogAbsenceGuardFloor: plainBoundedField("catalogAbsenceGuardFloor"),

    // ── KZO-199 Tier 1 — sharing knobs ──────────────────────────────────
    anonymousShareTokenCap: plainBoundedField("anonymousShareTokenCap"),
    anonymousShareRateLimitMax: plainBoundedField("anonymousShareRateLimitMax"),
    anonymousShareRateLimitWindowMs: plainBoundedField("anonymousShareRateLimitWindowMs"),

    // ── ui-enhancement Tier B — account lifecycle ───────────────────────
    accountHardPurgeDays: plainBoundedField("accountHardPurgeDays"),

    // KZO-199 Tier 2 fields (anonymousShareTokenRetentionMs,
    // userPreferencesMaxBytes) are deliberately NOT in this PATCH schema —
    // DB+SQL only. `.strict()` rejects them with a 400.
  })
  .strict();

/**
 * KZO-198 — list of plain camelCase fields handled by the generic per-field
 * setter `setAppConfigField`. Order does not matter; the PATCH handler walks
 * this list and only writes when the request body has a defined value that
 * differs from the current state.
 */
/**
 * KZO-198 — Tier 1 plain camelCase fields handled by the PATCH route. Tier 2
 * (daily refresh + SSE) fields are deliberately absent — DB+SQL only. The
 * literal tuple type is keyed off the PATCH schema so indexing `body[field]`
 * type-checks without `any` casts.
 */
const TIER1_PLAIN_FIELDS = [
  "marketDataPriceWindowMs",
  "marketDataPriceLimit",
  "marketDataSearchWindowMs",
  "marketDataSearchLimit",
  "inviteStatusWindowMs",
  "inviteStatusLimit",
  "providerDownNotificationSuppressionMs",
  "providerErrorTrailRetentionDays",
  "providerRerunCooldownMs",
  // KZO-197 (surfaced in KZO-199 Phase 4): yahoo-finance-au-specific override.
  "yahooAuRerunCooldownMs",
  "providerFixerDangerousMatchThreshold",
  "providerFixerPreviewSampleLimit",
  "providerFixerUiPageSize",
  "providerFixerAutoPauseFailuresPerMinute",
  "providerFixerPreviewTokenTtlMinutes",
  "providerOperationAutoRenewIntervalMinutes",
  "providerIncidentRecurrenceWindowMinutes",
  "providerHealthWarningUnresolvedThreshold",
  "providerHealthCriticalUnresolvedThreshold",
  "providerOperationStaleHeartbeatMinutes",
  "providerOperationSummaryRetentionDays",
  "providerOperationLogRetentionDays",
  "providerIncidentRetentionDays",
  "providerResolvedItemRetentionDays",
  "finmindProviderRateLimitPerHour",
  "twelveDataProviderRateLimitPerMinute",
  "yahooAuProviderRateLimitPerMinute",
  "yahooKrProviderRateLimitPerMinute",
  "frankfurterProviderRateLimitPerMinute",
  "asxGicsProviderRateLimitPerHour",
  "backfillRetryLimit",
  "backfillRetryDelaySeconds",
  "backfillFinmind402RetryMs",
  // KZO-195 — Tier 2 absence detection fields (admin-tunable via PATCH).
  "catalogAbsenceThreshold",
  "catalogAbsenceGuardPercent",
  "catalogAbsenceGuardFloor",
  // KZO-199 — Tier 1 sharing knobs (admin-tunable via PATCH).
  "anonymousShareTokenCap",
  "anonymousShareRateLimitMax",
  "anonymousShareRateLimitWindowMs",
  // ui-enhancement — Tier B account-soft-delete grace period.
  "accountHardPurgeDays",
] as const satisfies ReadonlyArray<AppConfigPlainField>;

function resolveAdminContext(req: FastifyRequest, _app: FastifyInstance) {
  const sessionUserId = requireSessionUserId(req);
  return {
    sessionUserId,
    ipAddress: req.ip,
    email: req.authContext?.email ?? null,
  };
}

function assertNotSelf(sessionUserId: string, targetUserId: string): void {
  if (targetUserId === sessionUserId) {
    throw routeError(403, "self_operation_blocked", "Cannot perform this action on your own account");
  }
}

function resolveEffectiveDashboardPerformanceRanges(
  override: string[] | null,
): string[] {
  if (Array.isArray(override) && override.length > 0) {
    return [...override];
  }
  return [...DEFAULT_DASHBOARD_PERFORMANCE_RANGES];
}

function appConfigBoundsForEnv(): AppConfigDto["bounds"] {
  const strictOverrideMax = (ceiling: number): number => Math.max(1, ceiling - 1);
  return {
    ...APP_CONFIG_BOUNDS,
    finmindProviderRateLimitPerHour: {
      min: APP_CONFIG_BOUNDS.finmindProviderRateLimitPerHour.min,
      max: strictOverrideMax(Env.FINMIND_RATE_LIMIT_PER_HOUR),
    },
    twelveDataProviderRateLimitPerMinute: {
      min: APP_CONFIG_BOUNDS.twelveDataProviderRateLimitPerMinute.min,
      max: strictOverrideMax(Env.TWELVE_DATA_RATE_LIMIT_PER_MINUTE),
    },
    yahooAuProviderRateLimitPerMinute: {
      min: APP_CONFIG_BOUNDS.yahooAuProviderRateLimitPerMinute.min,
      max: strictOverrideMax(Env.YAHOO_AU_RATE_LIMIT_PER_MINUTE),
    },
    yahooKrProviderRateLimitPerMinute: {
      min: APP_CONFIG_BOUNDS.yahooKrProviderRateLimitPerMinute.min,
      max: strictOverrideMax(Env.YAHOO_KR_RATE_LIMIT_PER_MINUTE),
    },
    frankfurterProviderRateLimitPerMinute: {
      min: APP_CONFIG_BOUNDS.frankfurterProviderRateLimitPerMinute.min,
      max: strictOverrideMax(Env.FRANKFURTER_RATE_LIMIT_PER_MINUTE),
    },
    asxGicsProviderRateLimitPerHour: {
      min: APP_CONFIG_BOUNDS.asxGicsProviderRateLimitPerHour.min,
      max: strictOverrideMax(Env.ASX_GICS_RATE_LIMIT_PER_HOUR),
    },
  };
}

function assertProviderRateBudgetOverrides(body: z.infer<typeof patchAdminSettingsSchema>): void {
  const checks: Array<{ field: keyof typeof body; value: unknown; max: number }> = [
    { field: "finmindProviderRateLimitPerHour", value: body.finmindProviderRateLimitPerHour, max: Env.FINMIND_RATE_LIMIT_PER_HOUR },
    { field: "twelveDataProviderRateLimitPerMinute", value: body.twelveDataProviderRateLimitPerMinute, max: Env.TWELVE_DATA_RATE_LIMIT_PER_MINUTE },
    { field: "yahooAuProviderRateLimitPerMinute", value: body.yahooAuProviderRateLimitPerMinute, max: Env.YAHOO_AU_RATE_LIMIT_PER_MINUTE },
    { field: "yahooKrProviderRateLimitPerMinute", value: body.yahooKrProviderRateLimitPerMinute, max: Env.YAHOO_KR_RATE_LIMIT_PER_MINUTE },
    { field: "frankfurterProviderRateLimitPerMinute", value: body.frankfurterProviderRateLimitPerMinute, max: Env.FRANKFURTER_RATE_LIMIT_PER_MINUTE },
    { field: "asxGicsProviderRateLimitPerHour", value: body.asxGicsProviderRateLimitPerHour, max: Env.ASX_GICS_RATE_LIMIT_PER_HOUR },
  ];
  for (const check of checks) {
    if (typeof check.value === "number" && check.value >= check.max) {
      throw routeError(
        400,
        "provider_rate_budget_exceeded",
        `${String(check.field)} must be greater than 0 and below the configured provider budget (${check.max}).`,
      );
    }
  }
}

function hourlyBudgetToPerMinute(value: number): number {
  return Math.max(0.01, Math.round((value / 60) * 100) / 100);
}

function providerOperationRateCapPerMinute(providerId: string, config: AppConfigDto): number {
  if (providerId === "finmind-tw" || providerId === "finmind-us") {
    return hourlyBudgetToPerMinute(config.effectiveFinmindProviderRateLimitPerHour);
  }
  if (providerId === "twelve-data-au" || providerId === "twelve-data-kr") {
    return config.effectiveTwelveDataProviderRateLimitPerMinute;
  }
  if (providerId === "yahoo-finance-au") {
    return config.effectiveYahooAuProviderRateLimitPerMinute;
  }
  if (providerId === "yahoo-finance-kr") {
    return config.effectiveYahooKrProviderRateLimitPerMinute;
  }
  if (providerId === "frankfurter") {
    return config.effectiveFrankfurterProviderRateLimitPerMinute;
  }
  if (providerId === "asx-gics-csv") {
    return hourlyBudgetToPerMinute(config.effectiveAsxGicsProviderRateLimitPerHour);
  }
  return 250;
}

function assertProviderHealthThresholdOverrides(
  body: z.infer<typeof patchAdminSettingsSchema>,
  current: Awaited<ReturnType<FastifyInstance["persistence"]["getAppConfig"]>>,
): void {
  const hasWarningPatch = Object.prototype.hasOwnProperty.call(body, "providerHealthWarningUnresolvedThreshold");
  const hasCriticalPatch = Object.prototype.hasOwnProperty.call(body, "providerHealthCriticalUnresolvedThreshold");
  const nextWarning = hasWarningPatch
    ? body.providerHealthWarningUnresolvedThreshold ?? PROVIDER_FIXER_DEFAULTS.healthWarningUnresolvedThreshold
    : current.providerHealthWarningUnresolvedThreshold ?? PROVIDER_FIXER_DEFAULTS.healthWarningUnresolvedThreshold;
  const nextCritical = hasCriticalPatch
    ? body.providerHealthCriticalUnresolvedThreshold ?? PROVIDER_FIXER_DEFAULTS.healthCriticalUnresolvedThreshold
    : current.providerHealthCriticalUnresolvedThreshold ?? PROVIDER_FIXER_DEFAULTS.healthCriticalUnresolvedThreshold;
  if (nextWarning >= nextCritical) {
    throw routeError(
      400,
      "provider_health_threshold_order_invalid",
      "providerHealthWarningUnresolvedThreshold must be below providerHealthCriticalUnresolvedThreshold.",
    );
  }
}

/**
 * KZO-198 Fix 3 — derive `AppConfigDto` directly from the freshly-fetched
 * row + env, NOT from `getEffective*()` resolvers (which read from the TTL
 * cache and may return env-fallback values immediately after `invalidate()`
 * before the background refresh completes).
 *
 * This bypasses the cache for the response path so a PATCH always returns
 * the post-write effective values. Cache invalidation stays fire-and-forget
 * for subsequent reads — the response itself does not depend on it.
 */
function buildAppConfigDtoFromRow(
  row: Awaited<ReturnType<FastifyInstance["persistence"]["getAppConfig"]>>,
): AppConfigDto {
  return {
    repairCooldownMinutes: row.repairCooldownMinutes,
    effectiveRepairCooldownMinutes: row.repairCooldownMinutes ?? Env.REPAIR_COOLDOWN_MINUTES,
    dashboardPerformanceRanges: row.dashboardPerformanceRanges,
    effectiveDashboardPerformanceRanges: resolveEffectiveDashboardPerformanceRanges(
      row.dashboardPerformanceRanges,
    ),
    metadataEnrichmentMode: row.metadataEnrichmentMode,
    effectiveMetadataEnrichmentMode: row.metadataEnrichmentMode ?? Env.METADATA_ENRICHMENT_MODE,

    // KZO-198 Tier 1 — rate limits
    marketDataPriceWindowMs: row.marketDataPriceWindowMs,
    effectiveMarketDataPriceWindowMs: row.marketDataPriceWindowMs ?? Env.MARKET_DATA_PRICE_WINDOW_MS,
    marketDataPriceLimit: row.marketDataPriceLimit,
    effectiveMarketDataPriceLimit: row.marketDataPriceLimit ?? Env.MARKET_DATA_PRICE_LIMIT,
    marketDataSearchWindowMs: row.marketDataSearchWindowMs,
    effectiveMarketDataSearchWindowMs: row.marketDataSearchWindowMs ?? Env.MARKET_DATA_SEARCH_WINDOW_MS,
    marketDataSearchLimit: row.marketDataSearchLimit,
    effectiveMarketDataSearchLimit: row.marketDataSearchLimit ?? Env.MARKET_DATA_SEARCH_RATE_LIMIT_PER_MINUTE,
    inviteStatusWindowMs: row.inviteStatusWindowMs,
    effectiveInviteStatusWindowMs: row.inviteStatusWindowMs ?? Env.INVITE_STATUS_WINDOW_MS,
    inviteStatusLimit: row.inviteStatusLimit,
    effectiveInviteStatusLimit: row.inviteStatusLimit ?? Env.INVITE_STATUS_LIMIT,

    // KZO-198 Tier 1 — provider health
    providerDownNotificationSuppressionMs: row.providerDownNotificationSuppressionMs,
    effectiveProviderDownNotificationSuppressionMs:
      row.providerDownNotificationSuppressionMs ?? Env.PROVIDER_DOWN_NOTIFICATION_SUPPRESSION_MS,
    providerErrorTrailRetentionDays: row.providerErrorTrailRetentionDays,
    effectiveProviderErrorTrailRetentionDays:
      row.providerErrorTrailRetentionDays ?? Env.PROVIDER_ERROR_TRAIL_RETENTION_DAYS,
    providerRerunCooldownMs: row.providerRerunCooldownMs,
    effectiveProviderRerunCooldownMs: row.providerRerunCooldownMs ?? Env.PROVIDER_RERUN_COOLDOWN_MS,
    // KZO-197 (surfaced in KZO-199 Phase 4): yahoo-finance-au-specific override.
    yahooAuRerunCooldownMs: row.yahooAuRerunCooldownMs,
    effectiveYahooAuRerunCooldownMs: row.yahooAuRerunCooldownMs ?? Env.YAHOO_AU_RERUN_COOLDOWN_MS,
    providerFixerDangerousMatchThreshold: row.providerFixerDangerousMatchThreshold,
    effectiveProviderFixerDangerousMatchThreshold:
      row.providerFixerDangerousMatchThreshold ?? PROVIDER_FIXER_DEFAULTS.dangerousMatchThreshold,
    providerFixerPreviewSampleLimit: row.providerFixerPreviewSampleLimit,
    effectiveProviderFixerPreviewSampleLimit:
      row.providerFixerPreviewSampleLimit ?? PROVIDER_FIXER_DEFAULTS.previewSampleLimit,
    providerFixerUiPageSize: row.providerFixerUiPageSize,
    effectiveProviderFixerUiPageSize: row.providerFixerUiPageSize ?? PROVIDER_FIXER_DEFAULTS.uiPageSize,
    providerFixerAutoPauseFailuresPerMinute: row.providerFixerAutoPauseFailuresPerMinute,
    effectiveProviderFixerAutoPauseFailuresPerMinute:
      row.providerFixerAutoPauseFailuresPerMinute ?? PROVIDER_FIXER_DEFAULTS.autoPauseFailuresPerMinute,
    providerFixerPreviewTokenTtlMinutes: row.providerFixerPreviewTokenTtlMinutes,
    effectiveProviderFixerPreviewTokenTtlMinutes:
      row.providerFixerPreviewTokenTtlMinutes ?? PROVIDER_FIXER_DEFAULTS.previewTokenTtlMinutes,
    providerOperationAutoRenewIntervalMinutes: row.providerOperationAutoRenewIntervalMinutes,
    effectiveProviderOperationAutoRenewIntervalMinutes:
      row.providerOperationAutoRenewIntervalMinutes ?? PROVIDER_FIXER_DEFAULTS.autoRenewIntervalMinutes,
    providerIncidentRecurrenceWindowMinutes: row.providerIncidentRecurrenceWindowMinutes,
    effectiveProviderIncidentRecurrenceWindowMinutes:
      row.providerIncidentRecurrenceWindowMinutes ?? PROVIDER_FIXER_DEFAULTS.incidentRecurrenceWindowMinutes,
    providerHealthWarningUnresolvedThreshold: row.providerHealthWarningUnresolvedThreshold,
    effectiveProviderHealthWarningUnresolvedThreshold:
      row.providerHealthWarningUnresolvedThreshold ?? PROVIDER_FIXER_DEFAULTS.healthWarningUnresolvedThreshold,
    providerHealthCriticalUnresolvedThreshold: row.providerHealthCriticalUnresolvedThreshold,
    effectiveProviderHealthCriticalUnresolvedThreshold:
      row.providerHealthCriticalUnresolvedThreshold ?? PROVIDER_FIXER_DEFAULTS.healthCriticalUnresolvedThreshold,
    providerOperationStaleHeartbeatMinutes: row.providerOperationStaleHeartbeatMinutes,
    effectiveProviderOperationStaleHeartbeatMinutes:
      row.providerOperationStaleHeartbeatMinutes ?? PROVIDER_FIXER_DEFAULTS.staleHeartbeatMinutes,
    providerOperationSummaryRetentionDays: row.providerOperationSummaryRetentionDays,
    effectiveProviderOperationSummaryRetentionDays:
      row.providerOperationSummaryRetentionDays ?? PROVIDER_FIXER_DEFAULTS.operationSummaryRetentionDays,
    providerOperationLogRetentionDays: row.providerOperationLogRetentionDays,
    effectiveProviderOperationLogRetentionDays:
      row.providerOperationLogRetentionDays ?? PROVIDER_FIXER_DEFAULTS.operationLogRetentionDays,
    providerIncidentRetentionDays: row.providerIncidentRetentionDays,
    effectiveProviderIncidentRetentionDays:
      row.providerIncidentRetentionDays ?? PROVIDER_FIXER_DEFAULTS.incidentRetentionDays,
    providerResolvedItemRetentionDays: row.providerResolvedItemRetentionDays,
    effectiveProviderResolvedItemRetentionDays:
      row.providerResolvedItemRetentionDays ?? PROVIDER_FIXER_DEFAULTS.resolvedItemRetentionDays,
    finmindProviderRateLimitPerHour: row.finmindProviderRateLimitPerHour,
    effectiveFinmindProviderRateLimitPerHour:
      row.finmindProviderRateLimitPerHour ?? Env.FINMIND_RATE_LIMIT_PER_HOUR,
    twelveDataProviderRateLimitPerMinute: row.twelveDataProviderRateLimitPerMinute,
    effectiveTwelveDataProviderRateLimitPerMinute:
      row.twelveDataProviderRateLimitPerMinute ?? Env.TWELVE_DATA_RATE_LIMIT_PER_MINUTE,
    yahooAuProviderRateLimitPerMinute: row.yahooAuProviderRateLimitPerMinute,
    effectiveYahooAuProviderRateLimitPerMinute:
      row.yahooAuProviderRateLimitPerMinute ?? Env.YAHOO_AU_RATE_LIMIT_PER_MINUTE,
    yahooKrProviderRateLimitPerMinute: row.yahooKrProviderRateLimitPerMinute,
    effectiveYahooKrProviderRateLimitPerMinute:
      row.yahooKrProviderRateLimitPerMinute ?? Env.YAHOO_KR_RATE_LIMIT_PER_MINUTE,
    frankfurterProviderRateLimitPerMinute: row.frankfurterProviderRateLimitPerMinute,
    effectiveFrankfurterProviderRateLimitPerMinute:
      row.frankfurterProviderRateLimitPerMinute ?? Env.FRANKFURTER_RATE_LIMIT_PER_MINUTE,
    asxGicsProviderRateLimitPerHour: row.asxGicsProviderRateLimitPerHour,
    effectiveAsxGicsProviderRateLimitPerHour:
      row.asxGicsProviderRateLimitPerHour ?? Env.ASX_GICS_RATE_LIMIT_PER_HOUR,

    // KZO-198 Tier 1 — backfill
    backfillRetryLimit: row.backfillRetryLimit,
    effectiveBackfillRetryLimit: row.backfillRetryLimit ?? Env.BACKFILL_RETRY_LIMIT,
    backfillRetryDelaySeconds: row.backfillRetryDelaySeconds,
    effectiveBackfillRetryDelaySeconds: row.backfillRetryDelaySeconds ?? Env.BACKFILL_RETRY_DELAY_SECONDS,
    backfillFinmind402RetryMs: row.backfillFinmind402RetryMs,
    effectiveBackfillFinmind402RetryMs: row.backfillFinmind402RetryMs ?? Env.BACKFILL_FINMIND_402_RETRY_MS,

    // KZO-195 Tier 2 — absence-based delisting detection (UI-editable)
    catalogAbsenceThreshold: row.catalogAbsenceThreshold,
    effectiveCatalogAbsenceThreshold:
      row.catalogAbsenceThreshold ?? Env.CATALOG_ABSENCE_THRESHOLD,
    catalogAbsenceGuardPercent: row.catalogAbsenceGuardPercent,
    effectiveCatalogAbsenceGuardPercent:
      row.catalogAbsenceGuardPercent ?? Env.CATALOG_ABSENCE_GUARD_PERCENT,
    catalogAbsenceGuardFloor: row.catalogAbsenceGuardFloor,
    effectiveCatalogAbsenceGuardFloor:
      row.catalogAbsenceGuardFloor ?? Env.CATALOG_ABSENCE_GUARD_FLOOR,

    // KZO-199 Tier 1 — sharing knobs (UI-editable)
    anonymousShareTokenCap: row.anonymousShareTokenCap,
    effectiveAnonymousShareTokenCap:
      row.anonymousShareTokenCap ?? Env.ANONYMOUS_SHARE_TOKEN_CAP,
    anonymousShareRateLimitMax: row.anonymousShareRateLimitMax,
    effectiveAnonymousShareRateLimitMax:
      row.anonymousShareRateLimitMax ?? Env.ANONYMOUS_SHARE_RATE_LIMIT_MAX,
    anonymousShareRateLimitWindowMs: row.anonymousShareRateLimitWindowMs,
    effectiveAnonymousShareRateLimitWindowMs:
      row.anonymousShareRateLimitWindowMs ?? Env.ANONYMOUS_SHARE_RATE_LIMIT_WINDOW_MS,

    // ui-enhancement — Tier B account-soft-delete grace period (UI-editable)
    accountHardPurgeDays: row.accountHardPurgeDays,
    effectiveAccountHardPurgeDays: row.accountHardPurgeDays ?? Env.ACCOUNT_HARD_PURGE_DAYS,

    // KZO-198 Tier 2 fields are intentionally absent (DB+SQL only — see DTO type)

    // KZO-198 Tier 0 — encrypted secret presence sentinels (NEVER ciphertext or plaintext)
    finmindApiTokenSet: row.finmindApiTokenEncrypted !== null,
    twelveDataApiKeySet: row.twelveDataApiKeyEncrypted !== null,

    // KZO-198 — bounds (single source of truth for UI form constraints)
    bounds: appConfigBoundsForEnv(),
    secretLengthBounds: APP_CONFIG_SECRET_LENGTH,

    updatedAt: row.updatedAt,
  };
}

async function loadAppConfigDto(app: FastifyInstance): Promise<AppConfigDto> {
  // Fetch the post-write row directly. The DTO is derived from this row
  // (Fix 3) so the response always reflects the latest persisted state,
  // independent of cache TTL or in-flight refresh state.
  const row = await app.persistence.getAppConfig();
  return buildAppConfigDtoFromRow(row);
}

const providerFixerResolverModeSchema = z.enum(["quote_first", "chart_probe_v1"]);
const providerFixerPhaseSchema = z.enum([
  "diagnose",
  "preview",
  "staged",
  "queued",
  "running",
  "paused",
  "completed",
  "failed",
  "cancelled",
]);
const providerFixerProviderSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9-]+$/);
const providerFixerErrorCodeSchema = z.string().trim().min(1).max(160);
const providerFixerMarketCodeSchema = z.enum(MARKET_CODES);
const providerFixerPreviewBodySchema = z
  .object({
    providerId: providerFixerProviderSchema,
    marketCode: providerFixerMarketCodeSchema.optional(),
    resolverMode: providerFixerResolverModeSchema.default("quote_first"),
    errorCode: providerFixerErrorCodeSchema.default("symbol_unresolved"),
  })
  .strict();
const providerFixerOperationBodySchema = z
  .object({
    operationId: z.string().trim().min(1).max(120),
    previewToken: z.string().trim().min(1).max(160).optional(),
    acknowledged: z.boolean().optional(),
    typedConfirmation: z.string().trim().max(160).optional(),
  })
  .strict();

const PROVIDER_FIXER_DEFAULT_PROVIDER_IDS = [
  "yahoo-finance-kr",
  "finmind-tw",
  "finmind-us",
] as const;

function providerFixerMarketCode(providerId: string, requested?: MarketCode): MarketCode {
  if (requested) return requested;
  if (providerId.endsWith("-kr")) return "KR";
  if (providerId.endsWith("-tw")) return "TW";
  if (providerId.endsWith("-us")) return "US";
  if (providerId.endsWith("-au")) return "AU";
  return "KR";
}

function providerFixerMarketLabel(marketCode: MarketCode): string {
  if (marketCode === "KR") return "KRX";
  if (marketCode === "TW") return "TWSE";
  if (marketCode === "US") return "NYSE/NASDAQ";
  return "ASX";
}

function providerFixerGuardrailsFromConfig(config: AppConfigDto): ProviderFixerDashboardGuardrailSettingsDto {
  return {
    dangerousMatchThreshold: config.effectiveProviderFixerDangerousMatchThreshold,
    previewSampleLimit: config.effectiveProviderFixerPreviewSampleLimit,
    uiPageSize: config.effectiveProviderFixerUiPageSize,
    autoPauseFailureThresholdPerMinute: config.effectiveProviderFixerAutoPauseFailuresPerMinute,
    previewTokenTtlSeconds: config.effectiveProviderFixerPreviewTokenTtlMinutes * 60,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function numberField(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function reserveProviderOperationBudget(
  app: FastifyInstance,
  operation: ProviderOperationRecord,
  requestCount = 1,
): Promise<void> {
  const latest = await app.persistence.getProviderOperation(operation.id);
  const metadata = asRecord(latest?.metadata) ?? asRecord(operation.metadata) ?? {};
  const capPerMinute = numberField(metadata.effectiveRateCapPerMinute) ?? 250;
  const safeCapPerMinute = Math.max(0.01, capPerMinute);
  const windowMs = safeCapPerMinute >= 1 ? 60_000 : Math.ceil(60_000 / safeCapPerMinute);
  const capPerWindow = Math.max(1, Math.floor(safeCapPerMinute >= 1 ? safeCapPerMinute : 1));
  const now = Date.now();
  const startedAtRaw = stringField(metadata.operationBudgetWindowStartedAt);
  const startedAtMs = startedAtRaw ? Date.parse(startedAtRaw) : NaN;
  const windowStartedAt = Number.isFinite(startedAtMs) && now - startedAtMs < windowMs ? startedAtMs : now;
  const consumed = windowStartedAt === startedAtMs ? Math.max(0, Math.floor(numberField(metadata.operationBudgetConsumed) ?? 0)) : 0;

  if (consumed + requestCount > capPerWindow) {
    const msUntilAvailable = Math.max(1, windowStartedAt + windowMs - now);
    await app.persistence.updateProviderOperation({
      id: operation.id,
      metadata: {
        ...metadata,
        operationBudgetConsumed: consumed,
        operationBudgetWindowStartedAt: new Date(windowStartedAt).toISOString(),
        operationBudgetWindowMs: windowMs,
        operationBudgetCapPerWindow: capPerWindow,
        operationBudgetPausedUntil: new Date(now + msUntilAvailable).toISOString(),
      },
    });
    throw new RateLimitedError({ msUntilAvailable });
  }

  await app.persistence.updateProviderOperation({
    id: operation.id,
    metadata: {
      ...metadata,
      operationBudgetConsumed: consumed + requestCount,
      operationBudgetWindowStartedAt: new Date(windowStartedAt).toISOString(),
      operationBudgetWindowMs: windowMs,
      operationBudgetCapPerWindow: capPerWindow,
      operationBudgetPausedUntil: null,
    },
  });
}

function hashProviderFixerToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function newProviderFixerToken(): string {
  return `PF-${randomBytes(9).toString("base64url").toUpperCase()}`;
}

function extractProviderFixerTicker(row: ProviderErrorTrailRow): string | null {
  const context = asRecord(row.context);
  const contextTicker =
    stringField(context?.ticker) ??
    stringField(context?.symbol) ??
    stringField(context?.providerSymbol) ??
    stringField(context?.sourceSymbol);
  if (contextTicker) return contextTicker.toUpperCase();
  const match = row.errorMessage?.match(/\b([0-9]{6})(?:\.(?:KS|KQ))?\b/i);
  return match?.[1]?.toUpperCase() ?? null;
}

async function buildProviderFixerEvidenceRow(
  app: FastifyInstance,
  providerId: string,
  marketCode: MarketCode,
  row: ProviderErrorTrailRow,
  options: { resolverMode?: MarketDataResolverMode; verifyCandidate?: boolean; operationBudget?: ProviderOperationRecord } = {},
): Promise<ProviderFixerDashboardEvidenceSampleDto | null> {
  const ticker = extractProviderFixerTicker(row);
  if (!ticker) return null;
  let candidateSymbol: string | null = null;
  let exchangeHint: string | null = null;
  let verificationStatus: ProviderFixerDashboardEvidenceSampleDto["verificationStatus"] = "pending";

  if (providerId === "yahoo-finance-kr" && marketCode === "KR") {
    const bareTicker = ticker.replace(/\.(KS|KQ)$/i, "");
    const existing = await app.persistence.getProviderResolutionMapping(providerId, "KR", bareTicker);
    if (existing) {
      candidateSymbol = existing.resolvedSymbol;
      exchangeHint = "durable provider_resolution_mappings row";
      verificationStatus = "verified";
    } else {
      const instrument = await app.persistence.getInstrument(bareTicker, "KR");
      const suffix = yahooSuffixHintFromKrCatalogEvidence(
        instrument?.catalogExchangeRaw ?? instrument?.typeRaw ?? null,
        instrument?.catalogMicCode ?? null,
      );
      if (suffix) {
        candidateSymbol = `${bareTicker}${suffix}`;
        exchangeHint = [
          instrument?.catalogExchangeRaw ? `Twelve Data exchange=${instrument.catalogExchangeRaw}` : null,
          instrument?.catalogMicCode ? `mic=${instrument.catalogMicCode}` : null,
        ].filter(Boolean).join(" / ") || "Twelve Data catalog hint";
        verificationStatus = "pending";
      }
    }
  }

  let verificationNote: string | null = null;
  if (candidateSymbol && options.verifyCandidate) {
    if (options.operationBudget) {
      await reserveProviderOperationBudget(app, options.operationBudget, 1);
    }
    const verification = await verifyProviderFixerCandidate(
      app,
      providerId,
      marketCode,
      ticker,
      candidateSymbol,
      options.resolverMode ?? "quote_first",
    );
    verificationStatus = verification.verified ? "verified" : "rejected";
    verificationNote = verification.verified
      ? `Yahoo ${verification.resolverMode} verification passed for ${verification.checkedSymbol}.`
      : `Yahoo ${verification.resolverMode} verification failed for ${verification.checkedSymbol}: ${verification.reason ?? "unknown"}.`;
  }

  return {
    symbol: ticker.replace(/\.(KS|KQ)$/i, ""),
    providerSymbol: ticker,
    candidateSymbol,
    exchangeHint,
    verificationStatus,
    note: candidateSymbol
      ? verificationNote ?? "Candidate requires Yahoo verification before durable provider binding."
      : "No catalog exchange/MIC hint was available; leave unresolved for manual review.",
  };
}

async function verifyProviderFixerCandidate(
  app: FastifyInstance,
  providerId: string,
  marketCode: MarketCode,
  ticker: string,
  candidateSymbol: string,
  resolverMode: MarketDataResolverMode,
): Promise<ProviderSymbolVerificationResult> {
  const provider = app.marketDataRegistry.marketData.get(marketCode);
  if (provider?.providerId !== providerId || !provider.verifyResolvedSymbol) {
    return {
      verified: false,
      checkedSymbol: candidateSymbol,
      resolverMode,
      reason: "provider_symbol_verifier_unavailable",
    };
  }
  return provider.verifyResolvedSymbol(ticker, candidateSymbol, { resolverMode });
}

async function buildProviderFixerEvidenceSample(
  app: FastifyInstance,
  providerId: string,
  marketCode: MarketCode,
  errorCode: string,
  resolverMode: MarketDataResolverMode,
  limit: number,
): Promise<{ sample: ProviderFixerDashboardEvidenceSampleDto[]; total: number }> {
  const page = await app.persistence.listProviderErrorTrailPage({
    providerId,
    marketCode,
    errorMessageLike: errorCode,
    excludeResolvedMappings: providerId === "yahoo-finance-kr" && marketCode === "KR",
    page: 1,
    limit,
  });
  const rows = await Promise.all(
    page.items.map((row) => buildProviderFixerEvidenceRow(app, providerId, marketCode, row, {
      resolverMode: providerId === "yahoo-finance-kr" ? resolverMode : undefined,
      verifyCandidate: providerId === "yahoo-finance-kr" && marketCode === "KR",
    })),
  );
  return {
    sample: rows.filter((row): row is ProviderFixerDashboardEvidenceSampleDto => row !== null),
    total: page.total,
  };
}

function shouldExcludeResolvedProviderMappings(providerId: string, marketCode: MarketCode): boolean {
  return providerId === "yahoo-finance-kr" && marketCode === "KR";
}

async function listProviderFixerScopeRows(
  app: FastifyInstance,
  providerId: string,
  marketCode: MarketCode,
  errorCode: string,
): Promise<{ rows: ProviderErrorTrailRow[]; total: number }> {
  const limit = 500;
  let page = 1;
  let total = 0;
  const collected: ProviderErrorTrailRow[] = [];
  while (true) {
    const rows = await app.persistence.listProviderErrorTrailPage({
      providerId,
      marketCode,
      errorMessageLike: errorCode,
      excludeResolvedMappings: shouldExcludeResolvedProviderMappings(providerId, marketCode),
      page,
      limit,
    });
    total = rows.total;
    collected.push(...rows.items);
    if (page * limit >= rows.total || rows.items.length === 0) break;
    page += 1;
  }
  return { rows: collected, total };
}

async function buildProviderFixerScopeSnapshot(
  app: FastifyInstance,
  providerId: string,
  marketCode: MarketCode,
  errorCode: string,
): Promise<{ matchCount: number; snapshotHash: string }> {
  const scope = await listProviderFixerScopeRows(app, providerId, marketCode, errorCode);
  const entries = scope.rows.map((row) => {
    const sourceSymbol = extractProviderFixerTicker(row)?.replace(/\.(KS|KQ)$/i, "").toUpperCase() ?? "";
    return `${row.id}:${sourceSymbol}:${row.occurredAt}`;
  });
  entries.sort();
  return {
    matchCount: scope.total,
    snapshotHash: hashProviderFixerToken(JSON.stringify({ providerId, marketCode, errorCode, matchCount: scope.total, entries })).slice(0, 12),
  };
}

function evidenceSampleFromOperation(operation: ProviderOperationRecord): ProviderFixerDashboardEvidenceSampleDto[] {
  const sample = Array.isArray(operation.sample) ? operation.sample : [];
  return sample
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => item !== null)
    .map((item): ProviderFixerDashboardEvidenceSampleDto => ({
      symbol: stringField(item.symbol) ?? "",
      providerSymbol: stringField(item.providerSymbol) ?? "",
      candidateSymbol: stringField(item.candidateSymbol),
      exchangeHint: stringField(item.exchangeHint),
      verificationStatus:
        item.verificationStatus === "verified" || item.verificationStatus === "rejected"
          ? item.verificationStatus
          : "pending",
      note: stringField(item.note) ?? "",
    }))
    .filter((item) => item.symbol.length > 0 && item.providerSymbol.length > 0);
}

function providerFixerOperationToDto(
  operation: ProviderOperationRecord,
  guardrails: ProviderFixerDashboardGuardrailSettingsDto,
): ProviderFixerDashboardOperationDto {
  const metadata = asRecord(operation.metadata) ?? {};
  const matchCount = operation.matchCount ?? 0;
  const dangerous = matchCount >= guardrails.dangerousMatchThreshold;
  const token = stringField(metadata.previewTokenDisplay) ?? operation.id;
  const previewExpired = operation.previewExpiresAt
    ? new Date(operation.previewExpiresAt).getTime() <= Date.now()
    : false;
  const confirmationText =
    stringField(metadata.confirmationText) ?? (dangerous ? `EXECUTE ${matchCount}` : null);
  const sample = evidenceSampleFromOperation(operation);
  const pageSize = guardrails.uiPageSize;
  return {
    id: operation.id,
    providerId: operation.providerId,
    market: providerFixerMarketLabel(operation.marketCode),
    phase: operation.phase,
    matchCount,
    preview: {
      scopeLabel: operation.scopeQuery ?? `${operation.providerId}:${operation.errorCode ?? "all"}`,
      queryBacked: matchCount > sample.length,
      page: 1,
      totalPages: Math.max(1, Math.ceil(Math.max(matchCount, sample.length) / Math.max(pageSize, 1))),
      token,
      tokenExpiresAt: operation.previewExpiresAt ?? operation.createdAt,
      snapshotHash: operation.snapshotHash ?? "unavailable",
      matchCount,
      sampleCount: sample.length,
      confirmationMode: dangerous ? "typed" : "standard",
      confirmationText: dangerous ? confirmationText : null,
      acknowledgementLabel: "I understand this can write provider rows",
      evidenceSample: sample,
    },
    canExecute: (operation.phase === "preview" || operation.phase === "staged") && !previewExpired,
    canPause: operation.phase === "running",
    canResume: operation.phase === "paused",
    canCancel:
      operation.phase === "preview"
      || operation.phase === "staged"
      || operation.phase === "queued"
      || operation.phase === "running"
      || operation.phase === "paused",
    canRetry: operation.phase === "paused" || operation.phase === "failed" || operation.phase === "cancelled" || operation.phase === "completed",
    dangerous,
    progressPercent: numberField(metadata.progressPercent),
    autoPauseFailureCount: numberField(metadata.autoPauseFailureCount),
    autoPauseFailureThresholdPerMinute: guardrails.autoPauseFailureThresholdPerMinute,
    effectiveRateCapPerMinute: numberField(metadata.effectiveRateCapPerMinute) ?? 250,
  };
}

function providerOperationOutcomeToDto(record: ProviderOperationOutcomeRecord): ProviderOperationOutcomeDto {
  return {
    operationId: record.operationId,
    providerId: record.providerId,
    marketCode: record.marketCode as ProviderOperationOutcomeDto["marketCode"],
    sourceSymbol: record.sourceSymbol,
    providerSymbol: record.providerSymbol,
    action: record.action,
    state: record.state,
    message: record.message,
    errorCode: record.errorCode,
    jobId: record.jobId,
    evidence: record.evidence,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    updatedAt: record.updatedAt,
  };
}

async function refreshProviderOperationProgressFromOutcomes(
  app: FastifyInstance,
  operationId: string,
): Promise<ProviderOperationRecord | null> {
  const operation = await app.persistence.getProviderOperation(operationId);
  if (!operation) return null;
  const outcomes = await app.persistence.listProviderOperationOutcomes({ operationId, page: 1, limit: 1 });
  const expectedTotal = Math.max(operation.matchCount ?? 0, outcomes.summary.total);
  const progressPercent = expectedTotal > 0
    ? Math.min(100, Math.round((outcomes.summary.processed / expectedTotal) * 100))
    : outcomes.summary.progressPercent;
  return app.persistence.updateProviderOperation({
    id: operation.id,
    metadata: {
      ...(asRecord(operation.metadata) ?? {}),
      progressPercent,
      outcomeTotalCount: expectedTotal,
      outcomeRecordedCount: outcomes.summary.total,
      outcomeProcessedCount: outcomes.summary.processed,
      outcomeSucceededCount: outcomes.summary.succeeded,
      outcomeFailedCount: outcomes.summary.failed,
      outcomeSkippedCount: outcomes.summary.skipped,
      outcomeRateLimitedCount: outcomes.summary.rateLimited,
      outcomeCancelledCount: outcomes.summary.cancelled,
    },
  });
}

async function returnCancelledProviderOperationIfCancelled(
  app: FastifyInstance,
  operation: ProviderOperationRecord,
  context: {
    actorUserId: string;
    guardrails: ProviderFixerDashboardGuardrailSettingsDto;
  },
  message: string,
  result: Record<string, unknown>,
): Promise<{ operation: ProviderFixerDashboardOperationDto; result: Record<string, unknown> } | null> {
  const current = await app.persistence.getProviderOperation(operation.id);
  if (current?.phase !== "cancelled") return null;
  const refreshed = await refreshProviderOperationProgressFromOutcomes(app, current.id) ?? current;
  await app.persistence.createProviderOperationLog({
    operationId: refreshed.id,
    phase: "cancelled",
    level: "warning",
    message,
    context: {
      providerId: refreshed.providerId,
      marketCode: refreshed.marketCode,
      ...result,
    },
  });
  await app.eventBus.publishEvent(context.actorUserId, "provider_operation_phase_changed", {
    operationId: refreshed.id,
    providerId: refreshed.providerId,
    phase: refreshed.phase,
  });
  return {
    operation: providerFixerOperationToDto(refreshed, context.guardrails),
    result: { status: "cancelled", ...result },
  };
}

function assertProviderFixerPreviewToken(operation: ProviderOperationRecord, previewToken: string | undefined): void {
  if (operation.previewExpiresAt && new Date(operation.previewExpiresAt).getTime() <= Date.now()) {
    throw routeError(400, "provider_fixer_preview_token_expired", "Preview token has expired; run preview again");
  }
  if (operation.previewTokenHash && (!previewToken || hashProviderFixerToken(previewToken) !== operation.previewTokenHash)) {
    throw routeError(400, "provider_fixer_preview_token_mismatch", "Preview token does not match the selected operation");
  }
}

async function findOtherActiveProviderOperationExecution(
  app: FastifyInstance,
  scope: { providerId: string; marketCode: MarketCode; operationId?: string | null },
): Promise<ProviderOperationRecord | null> {
  const active = await app.persistence.listProviderOperations({
    providerId: scope.providerId,
    marketCode: scope.marketCode,
    phases: ["running", "paused"],
    page: 1,
    limit: 50,
  });
  return active.items.find((row) => row.id !== scope.operationId) ?? null;
}

async function assertNoOtherProviderOperationExecution(
  app: FastifyInstance,
  scope: { providerId: string; marketCode: MarketCode; operationId?: string | null },
): Promise<void> {
  const other = await findOtherActiveProviderOperationExecution(app, scope);
  if (other) {
    throw routeError(
      409,
      "provider_fixer_active_execution_exists",
      "Another provider operation is already active for this provider and market",
    );
  }
}

async function pauseStaleProviderOperations(
  app: FastifyInstance,
  staleHeartbeatMinutes: number,
  context?: { actorUserId: string; ipAddress?: string },
): Promise<number> {
  const running = await app.persistence.listProviderOperations({
    phases: ["running"],
    page: 1,
    limit: 500,
  });
  const nowMs = Date.now();
  const staleAfterMs = Math.max(1, staleHeartbeatMinutes) * 60_000;
  let paused = 0;
  for (const operation of running.items) {
    const heartbeatAt = new Date(operation.updatedAt).getTime();
    if (!Number.isFinite(heartbeatAt) || nowMs - heartbeatAt <= staleAfterMs) continue;
    const staleDetectedAt = new Date(nowMs).toISOString();
    const updated = await app.persistence.updateProviderOperation({
      id: operation.id,
      phase: "paused",
      metadata: {
        ...(asRecord(operation.metadata) ?? {}),
        pauseReason: "stale_operation",
        staleDetectedAt,
        staleHeartbeatMinutes,
      },
    });
    await app.persistence.createProviderOperationLog({
      operationId: operation.id,
      phase: "paused",
      level: "warning",
      message: `auto_paused_stale_operation provider=${operation.providerId} market=${operation.marketCode} stale_minutes=${staleHeartbeatMinutes}`,
      context: {
        providerId: operation.providerId,
        marketCode: operation.marketCode,
        previousUpdatedAt: operation.updatedAt,
        staleDetectedAt,
        staleHeartbeatMinutes,
      },
    });
    if (context) {
      await app.persistence.appendAuditLog({
        actorUserId: context.actorUserId,
        action: "provider_fixer_operation",
        ipAddress: context.ipAddress,
        metadata: {
          operationId: operation.id,
          action: "auto_pause_stale",
          providerId: operation.providerId,
          marketCode: operation.marketCode,
          previousUpdatedAt: operation.updatedAt,
          staleDetectedAt,
          staleHeartbeatMinutes,
        },
      });
      await app.eventBus.publishEvent(context.actorUserId, "provider_operation_phase_changed", {
        operationId: operation.id,
        providerId: operation.providerId,
        phase: updated.phase,
        pauseReason: "stale_operation",
      });
    }
    paused += 1;
  }
  return paused;
}

async function providerFixerDiagnostics(
  app: FastifyInstance,
  guardrails: ProviderFixerDashboardGuardrailSettingsDto,
  providerId: string,
  marketCode: MarketCode,
  resolverMode: "quote_first" | "chart_probe_v1",
  errorCode: string,
): Promise<ProviderFixerDashboardDiagnosticsResponse> {
  const healthRows = await app.persistence.getAllProviderHealthStatuses();
  const providerIds = [...new Set([
    providerId,
    ...PROVIDER_FIXER_DEFAULT_PROVIDER_IDS,
    ...healthRows.map((row) => row.providerId),
  ])];
  const rows = await Promise.all(providerIds.map(async (id) => {
    const inferredMarketCode = providerFixerMarketCode(id, id === providerId ? marketCode : undefined);
    const code =
      id === "yahoo-finance-kr"
        ? "yahoo_finance_kr_symbol_unresolved"
        : id === "finmind-us" || id === "finmind-tw"
          ? "provider_symbol_unresolved"
          : errorCode;
    const page = await app.persistence.listProviderErrorTrailPage({
      providerId: id,
      marketCode: inferredMarketCode,
      errorMessageLike: code,
      excludeResolvedMappings: id === "yahoo-finance-kr" && inferredMarketCode === "KR",
      page: 1,
      limit: 1,
    });
    return {
      providerId: id,
      market: providerFixerMarketLabel(inferredMarketCode),
      unresolvedCount: page.total,
      resolverStatus:
        id === "yahoo-finance-kr" ? "enabled" as const : page.total > 0 ? "disabled" as const : "auto" as const,
      severity:
        page.total >= guardrails.dangerousMatchThreshold ? "critical" as const : page.total > 0 ? "warning" as const : "ok" as const,
      errorCode: code,
    };
  }));
  return {
    diagnostics: {
      resolverMode,
      providerId,
      errorCode,
      recommendation:
        "Run preview first; execute remains disabled until the preview token and confirmation match the selected operation.",
      rows: rows.filter((row) => row.unresolvedCount > 0 || PROVIDER_FIXER_DEFAULT_PROVIDER_IDS.includes(row.providerId as typeof PROVIDER_FIXER_DEFAULT_PROVIDER_IDS[number])),
      guardrails,
    },
  };
}

async function providerFixerSummary(
  app: FastifyInstance,
  guardrails: ProviderFixerDashboardGuardrailSettingsDto,
  config: AppConfigDto,
): Promise<ProviderFixerDashboardSummaryResponse> {
  const diagnostics = await providerFixerDiagnostics(
    app,
    guardrails,
    "yahoo-finance-kr",
    "KR",
    "quote_first",
    "yahoo_finance_kr_symbol_unresolved",
  );
  const operations = await app.persistence.listProviderOperations({
    page: 1,
    limit: 1,
    phases: ["preview", "staged", "queued", "running", "paused"],
  });
  const running = await app.persistence.listProviderOperations({
    page: 1,
    limit: 1,
    phases: ["running"],
  });
  const staged = await app.persistence.listProviderOperations({
    page: 1,
    limit: 1,
    phases: ["preview", "staged", "queued"],
  });
  const unresolvedRows = diagnostics.diagnostics.rows.filter((row) => row.unresolvedCount > 0);
  return {
    summary: {
      criticalUnresolvedCount: unresolvedRows.reduce((sum, row) => sum + row.unresolvedCount, 0),
      affectedProviders: unresolvedRows.map((row) => row.providerId),
      activeOperationsCount: operations.total,
      queuedOperationsCount: staged.total,
      runningOperationsCount: running.total,
      guardrailsEnabled: true,
      effectiveRateCapPerMinute: providerOperationRateCapPerMinute("yahoo-finance-kr", config),
    },
    guardrails,
  };
}

async function executeProviderFixerMappings(
  app: FastifyInstance,
  operation: ProviderOperationRecord,
  actorUserId: string,
): Promise<{ applied: number; skipped: number; scanned: number; mappedTickers: string[] }> {
  if (operation.providerId !== "yahoo-finance-kr" || operation.marketCode !== "KR") {
    return { applied: 0, skipped: 0, scanned: 0, mappedTickers: [] };
  }
  let applied = 0;
  let skipped = 0;
  let scanned = 0;
  const mappedTickers: string[] = [];
  const scope = await listProviderFixerScopeRows(
    app,
    operation.providerId,
    operation.marketCode,
    operation.errorCode ?? "symbol_unresolved",
  );
  for (const row of scope.rows) {
    scanned += 1;
    const extractedTicker = extractProviderFixerTicker(row);
    const sourceSymbol = (extractedTicker ?? `error-trail-${row.id}`).replace(/\.(KS|KQ)$/i, "").toUpperCase();
    await app.persistence.upsertProviderOperationOutcome({
      operationId: operation.id,
      providerId: operation.providerId,
      marketCode: operation.marketCode,
      sourceSymbol,
      providerSymbol: extractedTicker ?? null,
      action: "repair_mapping",
      state: "running",
      message: "Verifying provider symbol candidate.",
      evidence: { errorTrailId: row.id },
    });
    let evidence: ProviderFixerDashboardEvidenceSampleDto | null = null;
    try {
      evidence = await buildProviderFixerEvidenceRow(app, operation.providerId, operation.marketCode, row, {
        resolverMode: operation.resolverMode ?? "quote_first",
        verifyCandidate: true,
        operationBudget: operation,
      });
    } catch (err) {
      const isRateLimited = err instanceof RateLimitedError;
      await app.persistence.upsertProviderOperationOutcome({
        operationId: operation.id,
        providerId: operation.providerId,
        marketCode: operation.marketCode,
        sourceSymbol,
        providerSymbol: extractedTicker ?? null,
        action: "repair_mapping",
        state: isRateLimited ? "rate_limited" : "failed",
        message: err instanceof Error ? err.message : "Provider verification failed.",
        errorCode: isRateLimited ? "provider_rate_limited" : "provider_verification_failed",
        evidence: { errorTrailId: row.id },
      });
      await refreshProviderOperationProgressFromOutcomes(app, operation.id);
      throw err;
    }
    if (!evidence?.candidateSymbol || evidence.verificationStatus !== "verified") {
      skipped += 1;
      await app.persistence.upsertProviderOperationOutcome({
        operationId: operation.id,
        providerId: operation.providerId,
        marketCode: operation.marketCode,
        sourceSymbol,
        providerSymbol: evidence?.providerSymbol ?? extractedTicker ?? null,
        action: "repair_mapping",
        state: "skipped",
        message: evidence?.note ?? "No verified provider symbol candidate.",
        errorCode: evidence?.verificationStatus === "rejected" ? "candidate_rejected" : "candidate_missing",
        evidence: evidence ? { candidateSymbol: evidence.candidateSymbol, exchangeHint: evidence.exchangeHint } : { errorTrailId: row.id },
      });
      await refreshProviderOperationProgressFromOutcomes(app, operation.id);
      continue;
    }
    await app.persistence.upsertProviderResolutionMapping({
      providerId: operation.providerId,
      marketCode: "KR",
      sourceSymbol: evidence.symbol,
      resolvedSymbol: evidence.candidateSymbol,
      resolverMode: operation.resolverMode ?? "quote_first",
      evidence: {
        exchangeHint: evidence.exchangeHint,
        note: evidence.note,
        operationId: operation.id,
      },
      verifiedByUserId: actorUserId,
    });
    applied += 1;
    mappedTickers.push(evidence.symbol);
    await app.persistence.upsertProviderOperationOutcome({
      operationId: operation.id,
      providerId: operation.providerId,
      marketCode: operation.marketCode,
      sourceSymbol: evidence.symbol,
      providerSymbol: evidence.providerSymbol,
      action: "repair_mapping",
      state: "succeeded",
      message: `Resolved ${evidence.symbol} to ${evidence.candidateSymbol}.`,
      evidence: {
        candidateSymbol: evidence.candidateSymbol,
        exchangeHint: evidence.exchangeHint,
        note: evidence.note,
      },
    });
    await refreshProviderOperationProgressFromOutcomes(app, operation.id);
  }
  if (mappedTickers.length > 0) {
    await app.persistence.resolveProviderUnresolvedItems({
      providerId: operation.providerId,
      marketCode: operation.marketCode,
      sourceSymbols: mappedTickers,
      operationId: operation.id,
    });
  }
  return { applied, skipped, scanned, mappedTickers };
}

async function enqueueProviderFixerBackfills(
  app: FastifyInstance,
  operation: ProviderOperationRecord,
  tickers: string[],
): Promise<{ enqueued: number; skippedExisting: number }> {
  if (!app.boss || operation.marketCode !== "KR" || tickers.length === 0) {
    return { enqueued: 0, skippedExisting: 0 };
  }
  let enqueued = 0;
  let skippedExisting = 0;
  for (const ticker of [...new Set(tickers)]) {
    const payload = {
      ticker,
      marketCode: "KR",
      trigger: "admin_rerun",
      resolverMode: operation.resolverMode ?? "quote_first",
      providerOperationId: operation.id,
    } satisfies BackfillJobData;
    const jobId = await app.boss.send(
      BACKFILL_QUEUE,
      payload,
      {
        singletonKey: getBackfillSingletonKey(ticker, "KR", payload.resolverMode),
        priority: 10,
      },
    );
    if (jobId === null) {
      skippedExisting += 1;
    } else {
      enqueued += 1;
    }
  }
  return { enqueued, skippedExisting };
}

async function completeProviderFixerOperation(
  app: FastifyInstance,
  operation: ProviderOperationRecord,
  context: {
    actorUserId: string;
    ipAddress?: string;
    guardrails: ProviderFixerDashboardGuardrailSettingsDto;
    dangerous: boolean;
    throwOnFailure: boolean;
  },
): Promise<{ operation: ProviderFixerDashboardOperationDto; result: Record<string, unknown> }> {
  let result: Awaited<ReturnType<typeof executeProviderFixerMappings>>;
  let backfills: Awaited<ReturnType<typeof enqueueProviderFixerBackfills>>;
  try {
    result = await executeProviderFixerMappings(app, operation, context.actorUserId);
    const cancelled = await returnCancelledProviderOperationIfCancelled(
      app,
      operation,
      context,
      `execute_cancelled provider=${operation.providerId} market=${operation.marketCode} applied=${result.applied} skipped=${result.skipped} scanned=${result.scanned}`,
      { ...result, backfills: { enqueued: 0, skippedExisting: 0 } },
    );
    if (cancelled) return cancelled;
    backfills = await enqueueProviderFixerBackfills(app, operation, result.mappedTickers);
    const cancelledAfterBackfills = await returnCancelledProviderOperationIfCancelled(
      app,
      operation,
      context,
      `execute_cancelled provider=${operation.providerId} market=${operation.marketCode} applied=${result.applied} skipped=${result.skipped} scanned=${result.scanned} enqueued_backfills=${backfills.enqueued}`,
      { ...result, backfills },
    );
    if (cancelledAfterBackfills) return cancelledAfterBackfills;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Provider fixer execution failed";
    const isRateLimited = err instanceof RateLimitedError;
    const latestMetadata = asRecord((await app.persistence.getProviderOperation(operation.id))?.metadata) ?? asRecord(operation.metadata) ?? {};
    const interrupted = await app.persistence.updateProviderOperation({
      id: operation.id,
      phase: isRateLimited ? "paused" : "failed",
      completedAt: isRateLimited ? null : new Date().toISOString(),
      metadata: {
        ...latestMetadata,
        progressPercent: 0,
        pauseReason: isRateLimited ? "paused_rate_limit" : undefined,
        autoPauseFailureCount: isRateLimited ? 1 : undefined,
        failureReason: message,
        failureName: err instanceof Error ? err.name : "UnknownError",
        msUntilAvailable: isRateLimited ? err.msUntilAvailable : undefined,
      },
    });
    await app.persistence.createProviderOperationLog({
      operationId: interrupted.id,
      phase: interrupted.phase,
      level: isRateLimited ? "warning" : "error",
      message: `${isRateLimited ? "execute_auto_paused_rate_limited" : "execute_failed"} provider=${interrupted.providerId} market=${interrupted.marketCode} reason=${message}`,
      context: {
        providerId: interrupted.providerId,
        marketCode: interrupted.marketCode,
        errorCode: interrupted.errorCode,
        errorName: err instanceof Error ? err.name : "UnknownError",
        errorMessage: message,
        msUntilAvailable: isRateLimited ? err.msUntilAvailable : null,
      },
    });
    await app.persistence.appendAuditLog({
      actorUserId: context.actorUserId,
      action: "provider_fixer_operation",
      ipAddress: context.ipAddress,
      metadata: {
        operationId: interrupted.id,
        action: isRateLimited ? "execute_auto_pause" : "execute_failed",
        providerId: interrupted.providerId,
        marketCode: interrupted.marketCode,
        dangerous: context.dangerous,
        errorName: err instanceof Error ? err.name : "UnknownError",
        errorMessage: message,
        msUntilAvailable: isRateLimited ? err.msUntilAvailable : null,
      },
    });
    await refreshProviderOperationProgressFromOutcomes(app, interrupted.id);
    await app.eventBus.publishEvent(context.actorUserId, "provider_operation_phase_changed", {
      operationId: interrupted.id,
      providerId: interrupted.providerId,
      phase: interrupted.phase,
      pauseReason: isRateLimited ? "paused_rate_limit" : null,
    });
    if (!isRateLimited) {
      await maybeStartNextQueuedProviderOperation(app, interrupted.providerId, interrupted.marketCode, {
        actorUserId: context.actorUserId,
        ipAddress: context.ipAddress,
        guardrails: context.guardrails,
      });
    }
    if (context.throwOnFailure) {
      if (isRateLimited) {
        throw routeError(503, "provider_rate_limited", message);
      }
      throw err;
    }
    return {
      operation: providerFixerOperationToDto(interrupted, context.guardrails),
      result: { status: interrupted.phase, errorMessage: message },
    };
  }
  const outcomeProgress = await refreshProviderOperationProgressFromOutcomes(app, operation.id);
  const completed = await app.persistence.updateProviderOperation({
    id: operation.id,
    phase: "completed",
    completedAt: new Date().toISOString(),
    metadata: {
      ...(asRecord(outcomeProgress?.metadata) ?? asRecord(operation.metadata) ?? {}),
      progressPercent: 100,
      appliedMappingCount: result.applied,
      skippedMappingCount: result.skipped,
      scannedRowCount: result.scanned,
      enqueuedBackfillCount: backfills.enqueued,
      skippedExistingBackfillCount: backfills.skippedExisting,
    },
  });
  await app.persistence.createProviderOperationLog({
    operationId: completed.id,
    phase: "completed",
    level: result.skipped > 0 ? "warning" : "info",
    message: `execute_completed provider=${completed.providerId} market=${completed.marketCode} applied=${result.applied} skipped=${result.skipped} scanned=${result.scanned} enqueued_backfills=${backfills.enqueued}`,
    context: { providerId: completed.providerId, marketCode: completed.marketCode, ...result, backfills },
  });
  await app.persistence.appendAuditLog({
    actorUserId: context.actorUserId,
    action: "provider_fixer_operation",
    ipAddress: context.ipAddress,
    metadata: {
      operationId: completed.id,
      action: "execute",
      providerId: completed.providerId,
      marketCode: completed.marketCode,
      dangerous: context.dangerous,
      ...result,
      backfills,
    },
  });
  await app.eventBus.publishEvent(context.actorUserId, "provider_operation_phase_changed", {
    operationId: completed.id,
    providerId: completed.providerId,
    phase: completed.phase,
  });
  await app.eventBus.publishEvent(context.actorUserId, "provider_operation_progress", {
    operationId: completed.id,
    providerId: completed.providerId,
    processed: result.applied + result.skipped,
    total: result.scanned,
    progressPercent: 100,
  });
  await maybeStartNextQueuedProviderOperation(app, completed.providerId, completed.marketCode, {
    actorUserId: context.actorUserId,
    ipAddress: context.ipAddress,
    guardrails: context.guardrails,
  });
  return { operation: providerFixerOperationToDto(completed, context.guardrails), result: { ...result, backfills } };
}

async function renewProviderFixerEvidence(
  app: FastifyInstance,
  operation: ProviderOperationRecord,
): Promise<{ succeeded: number; skipped: number; scanned: number }> {
  let succeeded = 0;
  let skipped = 0;
  let scanned = 0;
  let page = 1;
  const limit = 200;
  while (true) {
    const rows = await app.persistence.listProviderErrorTrailPage({
      providerId: operation.providerId,
      marketCode: operation.marketCode,
      errorMessageLike: operation.errorCode ?? "symbol_unresolved",
      page,
      limit,
    });
    for (const row of rows.items) {
      scanned += 1;
      const extractedTicker = extractProviderFixerTicker(row);
      const sourceSymbol = (extractedTicker ?? `error-trail-${row.id}`).replace(/\.(KS|KQ)$/i, "").toUpperCase();
      await app.persistence.upsertProviderOperationOutcome({
        operationId: operation.id,
        providerId: operation.providerId,
        marketCode: operation.marketCode,
        sourceSymbol,
        providerSymbol: extractedTicker ?? null,
        action: "renew_evidence",
        state: "running",
        message: "Renewing provider evidence.",
        evidence: { errorTrailId: row.id },
      });
      let evidence: ProviderFixerDashboardEvidenceSampleDto | null = null;
      try {
        evidence = await buildProviderFixerEvidenceRow(app, operation.providerId, operation.marketCode, row, {
          resolverMode: operation.resolverMode ?? "quote_first",
          verifyCandidate: true,
          operationBudget: operation,
        });
      } catch (err) {
        const isRateLimited = err instanceof RateLimitedError;
        await app.persistence.upsertProviderOperationOutcome({
          operationId: operation.id,
          providerId: operation.providerId,
          marketCode: operation.marketCode,
          sourceSymbol,
          providerSymbol: extractedTicker ?? null,
          action: "renew_evidence",
          state: isRateLimited ? "rate_limited" : "failed",
          message: err instanceof Error ? err.message : "Provider evidence renewal failed.",
          errorCode: isRateLimited ? "provider_rate_limited" : "provider_evidence_renewal_failed",
          evidence: { errorTrailId: row.id },
        });
        await refreshProviderOperationProgressFromOutcomes(app, operation.id);
        throw err;
      }
      if (evidence?.candidateSymbol && evidence.verificationStatus === "verified") {
        succeeded += 1;
        await app.persistence.upsertProviderOperationOutcome({
          operationId: operation.id,
          providerId: operation.providerId,
          marketCode: operation.marketCode,
          sourceSymbol: evidence.symbol,
          providerSymbol: evidence.providerSymbol,
          action: "renew_evidence",
          state: "succeeded",
          message: `Renewed evidence for ${evidence.symbol}: ${evidence.candidateSymbol}.`,
          evidence: {
            candidateSymbol: evidence.candidateSymbol,
            exchangeHint: evidence.exchangeHint,
            note: evidence.note,
          },
        });
      } else {
        skipped += 1;
        await app.persistence.upsertProviderOperationOutcome({
          operationId: operation.id,
          providerId: operation.providerId,
          marketCode: operation.marketCode,
          sourceSymbol,
          providerSymbol: evidence?.providerSymbol ?? extractedTicker ?? null,
          action: "renew_evidence",
          state: "skipped",
          message: evidence?.note ?? "No verified provider evidence candidate.",
          errorCode: evidence?.verificationStatus === "rejected" ? "candidate_rejected" : "candidate_missing",
          evidence: evidence ? { candidateSymbol: evidence.candidateSymbol, exchangeHint: evidence.exchangeHint } : { errorTrailId: row.id },
        });
      }
      await refreshProviderOperationProgressFromOutcomes(app, operation.id);
    }
    if (page * limit >= rows.total || rows.items.length === 0) break;
    page += 1;
  }
  return { succeeded, skipped, scanned };
}

async function completeProviderRenewEvidenceOperation(
  app: FastifyInstance,
  operation: ProviderOperationRecord,
  context: {
    actorUserId: string;
    ipAddress?: string;
    guardrails: ProviderFixerDashboardGuardrailSettingsDto;
    throwOnFailure: boolean;
  },
): Promise<{ operation: ProviderFixerDashboardOperationDto; result: Record<string, unknown> }> {
  let result: Awaited<ReturnType<typeof renewProviderFixerEvidence>>;
  try {
    result = await renewProviderFixerEvidence(app, operation);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Provider evidence renewal failed.";
    const isRateLimited = err instanceof RateLimitedError;
    const latestMetadata = asRecord((await app.persistence.getProviderOperation(operation.id))?.metadata) ?? asRecord(operation.metadata) ?? {};
    const interrupted = await app.persistence.updateProviderOperation({
      id: operation.id,
      phase: isRateLimited ? "paused" : "failed",
      completedAt: isRateLimited ? null : new Date().toISOString(),
      metadata: {
        ...latestMetadata,
        progressPercent: 0,
        pauseReason: isRateLimited ? "paused_rate_limit" : undefined,
        failureReason: message,
        failureName: err instanceof Error ? err.name : "UnknownError",
        msUntilAvailable: isRateLimited ? err.msUntilAvailable : undefined,
      },
    });
    await app.persistence.createProviderOperationLog({
      operationId: interrupted.id,
      phase: interrupted.phase,
      level: isRateLimited ? "warning" : "error",
      message: `${isRateLimited ? "renew_auto_paused_rate_limited" : "renew_failed"} provider=${interrupted.providerId} market=${interrupted.marketCode} reason=${message}`,
      context: {
        providerId: interrupted.providerId,
        marketCode: interrupted.marketCode,
        errorCode: interrupted.errorCode,
        errorName: err instanceof Error ? err.name : "UnknownError",
        errorMessage: message,
        msUntilAvailable: isRateLimited ? err.msUntilAvailable : null,
      },
    });
    await app.persistence.appendAuditLog({
      actorUserId: context.actorUserId,
      action: "provider_fixer_operation",
      ipAddress: context.ipAddress,
      metadata: {
        operationId: interrupted.id,
        action: isRateLimited ? "renew_auto_pause" : "renew_failed",
        providerId: interrupted.providerId,
        marketCode: interrupted.marketCode,
        errorName: err instanceof Error ? err.name : "UnknownError",
        errorMessage: message,
        msUntilAvailable: isRateLimited ? err.msUntilAvailable : null,
      },
    });
    await refreshProviderOperationProgressFromOutcomes(app, interrupted.id);
    await app.eventBus.publishEvent(context.actorUserId, "provider_operation_phase_changed", {
      operationId: interrupted.id,
      providerId: interrupted.providerId,
      phase: interrupted.phase,
      pauseReason: isRateLimited ? "paused_rate_limit" : null,
    });
    if (!isRateLimited) {
      await maybeStartNextQueuedProviderOperation(app, interrupted.providerId, interrupted.marketCode, {
        actorUserId: context.actorUserId,
        ipAddress: context.ipAddress,
        guardrails: context.guardrails,
      });
    }
    if (context.throwOnFailure) {
      if (isRateLimited) {
        throw routeError(503, "provider_rate_limited", message);
      }
      throw err;
    }
    return {
      operation: providerFixerOperationToDto(interrupted, context.guardrails),
      result: { status: interrupted.phase, errorMessage: message },
    };
  }
  const outcomeProgress = await refreshProviderOperationProgressFromOutcomes(app, operation.id);
  const completed = await app.persistence.updateProviderOperation({
    id: operation.id,
    phase: "completed",
    completedAt: new Date().toISOString(),
    metadata: {
      ...(asRecord(outcomeProgress?.metadata) ?? asRecord(operation.metadata) ?? {}),
      progressPercent: 100,
      renewedEvidenceCount: result.succeeded,
      skippedEvidenceCount: result.skipped,
      scannedRowCount: result.scanned,
    },
  });
  await app.persistence.createProviderOperationLog({
    operationId: completed.id,
    phase: "completed",
    level: result.skipped > 0 ? "warning" : "info",
    message: `renew_completed provider=${completed.providerId} market=${completed.marketCode} renewed=${result.succeeded} skipped=${result.skipped} scanned=${result.scanned}`,
    context: { providerId: completed.providerId, marketCode: completed.marketCode, ...result },
  });
  await app.persistence.appendAuditLog({
    actorUserId: context.actorUserId,
    action: "provider_fixer_operation",
    ipAddress: context.ipAddress,
    metadata: {
      operationId: completed.id,
      action: "renew_evidence",
      providerId: completed.providerId,
      marketCode: completed.marketCode,
      ...result,
    },
  });
  await app.eventBus.publishEvent(context.actorUserId, "provider_operation_phase_changed", {
    operationId: completed.id,
    providerId: completed.providerId,
    phase: completed.phase,
  });
  await app.eventBus.publishEvent(context.actorUserId, "provider_operation_progress", {
    operationId: completed.id,
    providerId: completed.providerId,
    processed: result.succeeded + result.skipped,
    total: result.scanned,
    progressPercent: 100,
  });
  await maybeStartNextQueuedProviderOperation(app, completed.providerId, completed.marketCode, {
    actorUserId: context.actorUserId,
    ipAddress: context.ipAddress,
    guardrails: context.guardrails,
  });
  return { operation: providerFixerOperationToDto(completed, context.guardrails), result };
}

async function completeProviderRerunBackfillOperation(
  app: FastifyInstance,
  operation: ProviderOperationRecord,
  context: {
    actorUserId: string;
    ipAddress?: string;
    guardrails: ProviderFixerDashboardGuardrailSettingsDto;
    throwOnFailure: boolean;
  },
): Promise<{ operation: ProviderFixerDashboardOperationDto; result: Record<string, unknown> }> {
  const metadata = asRecord(operation.metadata) ?? {};
  const sourceSymbol = stringField(metadata.mappingSourceSymbol);
  const resolvedSymbol = stringField(metadata.mappingResolvedSymbol);
  if (!sourceSymbol || !resolvedSymbol) {
    const message = "Provider rerun operation is missing mapping metadata.";
    const failed = await app.persistence.updateProviderOperation({
      id: operation.id,
      phase: "failed",
      completedAt: new Date().toISOString(),
      metadata: { ...metadata, progressPercent: 100, failureReason: message },
    });
    await app.persistence.createProviderOperationLog({
      operationId: operation.id,
      phase: "failed",
      level: "error",
      message: `rerun_failed provider=${operation.providerId} market=${operation.marketCode} reason=${message}`,
      context: { providerId: operation.providerId, marketCode: operation.marketCode, errorMessage: message },
    });
    await app.eventBus.publishEvent(context.actorUserId, "provider_operation_phase_changed", {
      operationId: operation.id,
      providerId: operation.providerId,
      phase: failed.phase,
    });
    await maybeStartNextQueuedProviderOperation(app, failed.providerId, failed.marketCode, {
      actorUserId: context.actorUserId,
      ipAddress: context.ipAddress,
      guardrails: context.guardrails,
    });
    if (context.throwOnFailure) {
      throw routeError(400, "provider_rerun_metadata_missing", message);
    }
    return { operation: providerFixerOperationToDto(failed, context.guardrails), result: { status: "failed", errorMessage: message } };
  }

  await app.persistence.upsertProviderOperationOutcome({
    operationId: operation.id,
    providerId: operation.providerId,
    marketCode: operation.marketCode,
    sourceSymbol,
    providerSymbol: resolvedSymbol,
    action: "rerun_backfill",
    state: "running",
    message: "Enqueuing provider backfill rerun.",
    evidence: {
      resolvedSymbol,
      resolverMode: operation.resolverMode ?? null,
    },
  });

  try {
    const backfills = await enqueueProviderFixerBackfills(app, operation, [sourceSymbol]);
    const succeeded = backfills.enqueued > 0;
    const state = succeeded ? "succeeded" : "skipped";
    await app.persistence.upsertProviderOperationOutcome({
      operationId: operation.id,
      providerId: operation.providerId,
      marketCode: operation.marketCode,
      sourceSymbol,
      providerSymbol: resolvedSymbol,
      action: "rerun_backfill",
      state,
      message: succeeded
        ? `Queued backfill rerun for ${sourceSymbol}.`
        : `Backfill rerun for ${sourceSymbol} was skipped because a matching job already exists or the queue is unavailable.`,
      errorCode: succeeded ? null : "backfill_rerun_skipped_existing_or_unavailable",
      evidence: backfills,
    });
    const completedAt = new Date().toISOString();
    const completed = await app.persistence.updateProviderOperation({
      id: operation.id,
      phase: "completed",
      completedAt,
      metadata: {
        ...metadata,
        progressPercent: 100,
        enqueuedBackfillCount: backfills.enqueued,
        skippedExistingBackfillCount: backfills.skippedExisting,
      },
    });
    await app.persistence.createProviderOperationLog({
      operationId: operation.id,
      phase: "completed",
      level: succeeded ? "info" : "warning",
      message: `rerun_completed provider=${operation.providerId} market=${operation.marketCode} source_symbol=${sourceSymbol} enqueued_backfills=${backfills.enqueued} skipped_existing=${backfills.skippedExisting}`,
      context: { providerId: operation.providerId, marketCode: operation.marketCode, sourceSymbol, resolvedSymbol, backfills },
    });
    await app.persistence.appendAuditLog({
      actorUserId: context.actorUserId,
      action: "provider_fixer_operation",
      ipAddress: context.ipAddress,
      metadata: {
        operationId: operation.id,
        action: "rerun_backfill",
        providerId: operation.providerId,
        marketCode: operation.marketCode,
        sourceSymbol,
        resolvedSymbol,
        backfills,
      },
    });
    await app.eventBus.publishEvent(context.actorUserId, "provider_operation_phase_changed", {
      operationId: operation.id,
      providerId: operation.providerId,
      phase: completed.phase,
    });
    await app.eventBus.publishEvent(context.actorUserId, "provider_operation_progress", {
      operationId: operation.id,
      providerId: operation.providerId,
      processed: 1,
      total: 1,
      progressPercent: 100,
    });
    await maybeStartNextQueuedProviderOperation(app, completed.providerId, completed.marketCode, {
      actorUserId: context.actorUserId,
      ipAddress: context.ipAddress,
      guardrails: context.guardrails,
    });
    return { operation: providerFixerOperationToDto(completed, context.guardrails), result: { status: "completed", backfills } };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Provider backfill rerun failed.";
    const failed = await app.persistence.updateProviderOperation({
      id: operation.id,
      phase: "failed",
      completedAt: new Date().toISOString(),
      metadata: {
        ...metadata,
        progressPercent: 100,
        failureReason: message,
        failureName: err instanceof Error ? err.name : "UnknownError",
      },
    });
    await app.persistence.upsertProviderOperationOutcome({
      operationId: operation.id,
      providerId: operation.providerId,
      marketCode: operation.marketCode,
      sourceSymbol,
      providerSymbol: resolvedSymbol,
      action: "rerun_backfill",
      state: "failed",
      message,
      errorCode: "provider_rerun_backfill_failed",
    });
    await app.persistence.createProviderOperationLog({
      operationId: operation.id,
      phase: "failed",
      level: "error",
      message: `rerun_failed provider=${operation.providerId} market=${operation.marketCode} source_symbol=${sourceSymbol} reason=${message}`,
      context: { providerId: operation.providerId, marketCode: operation.marketCode, sourceSymbol, errorMessage: message },
    });
    await app.eventBus.publishEvent(context.actorUserId, "provider_operation_phase_changed", {
      operationId: operation.id,
      providerId: operation.providerId,
      phase: failed.phase,
    });
    await maybeStartNextQueuedProviderOperation(app, failed.providerId, failed.marketCode, {
      actorUserId: context.actorUserId,
      ipAddress: context.ipAddress,
      guardrails: context.guardrails,
    });
    if (context.throwOnFailure) throw err;
    return { operation: providerFixerOperationToDto(failed, context.guardrails), result: { status: "failed", errorMessage: message } };
  }
}

function runProviderFixerOperationInBackground(
  app: FastifyInstance,
  operation: ProviderOperationRecord,
  context: Omit<Parameters<typeof completeProviderFixerOperation>[2], "throwOnFailure">,
): void {
  setImmediate(() => {
    void completeProviderFixerOperation(app, operation, { ...context, throwOnFailure: false }).catch((err) => {
      app.log.error(
        {
          operationId: operation.id,
          providerId: operation.providerId,
          err,
        },
        "provider_operation_background_execution_failed",
      );
    });
  });
}

function runProviderRenewEvidenceOperationInBackground(
  app: FastifyInstance,
  operation: ProviderOperationRecord,
  context: Omit<Parameters<typeof completeProviderRenewEvidenceOperation>[2], "throwOnFailure">,
): void {
  setImmediate(() => {
    void completeProviderRenewEvidenceOperation(app, operation, { ...context, throwOnFailure: false }).catch((err) => {
      app.log.error(
        {
          operationId: operation.id,
          providerId: operation.providerId,
          err,
        },
        "provider_renew_evidence_background_failed",
      );
    });
  });
}

function runProviderRerunBackfillOperationInBackground(
  app: FastifyInstance,
  operation: ProviderOperationRecord,
  context: Omit<Parameters<typeof completeProviderRerunBackfillOperation>[2], "throwOnFailure">,
): void {
  setImmediate(() => {
    void completeProviderRerunBackfillOperation(app, operation, { ...context, throwOnFailure: false }).catch((err) => {
      app.log.error(
        {
          operationId: operation.id,
          providerId: operation.providerId,
          err,
        },
        "provider_rerun_backfill_background_failed",
      );
    });
  });
}

async function completeProviderMappingReverifyOperation(
  app: FastifyInstance,
  operation: ProviderOperationRecord,
  context: {
    actorUserId: string;
    ipAddress?: string;
    guardrails: ProviderFixerDashboardGuardrailSettingsDto;
    throwOnFailure: boolean;
  },
): Promise<{ operation: ProviderFixerDashboardOperationDto; result: Record<string, unknown> }> {
  const metadata = asRecord(operation.metadata) ?? {};
  const sourceSymbol = stringField(metadata.mappingSourceSymbol);
  const resolvedSymbol = stringField(metadata.mappingResolvedSymbol);
  const resolverMode = operation.resolverMode ?? "quote_first";
  if (!sourceSymbol || !resolvedSymbol) {
    const message = "Provider mapping reverify operation is missing mapping metadata.";
    const failed = await app.persistence.updateProviderOperation({
      id: operation.id,
      phase: "failed",
      completedAt: new Date().toISOString(),
      metadata: {
        ...metadata,
        progressPercent: 100,
        failureReason: message,
      },
    });
    await app.persistence.createProviderOperationLog({
      operationId: operation.id,
      phase: "failed",
      level: "error",
      message: `reverify_failed provider=${operation.providerId} market=${operation.marketCode} reason=${message}`,
      context: { providerId: operation.providerId, marketCode: operation.marketCode, errorMessage: message },
    });
    await app.persistence.appendAuditLog({
      actorUserId: context.actorUserId,
      action: "provider_fixer_operation",
      ipAddress: context.ipAddress,
      metadata: {
        operationId: operation.id,
        action: "reverify_failed",
        providerId: operation.providerId,
        marketCode: operation.marketCode,
        errorMessage: message,
      },
    });
    await app.eventBus.publishEvent(context.actorUserId, "provider_operation_phase_changed", {
      operationId: operation.id,
      providerId: operation.providerId,
      phase: failed.phase,
    });
    await maybeStartNextQueuedProviderOperation(app, failed.providerId, failed.marketCode, {
      actorUserId: context.actorUserId,
      ipAddress: context.ipAddress,
      guardrails: context.guardrails,
    });
    if (context.throwOnFailure) {
      throw routeError(400, "provider_mapping_reverify_metadata_missing", message);
    }
    return { operation: providerFixerOperationToDto(failed, context.guardrails), result: { status: "failed", errorMessage: message } };
  }

  await app.persistence.upsertProviderOperationOutcome({
    operationId: operation.id,
    providerId: operation.providerId,
    marketCode: operation.marketCode,
    sourceSymbol,
    providerSymbol: resolvedSymbol,
    action: "reverify_mapping",
    state: "running",
    message: "Reverifying durable provider mapping.",
    evidence: { previousVerifiedAt: metadata.mappingPreviousVerifiedAt ?? null },
  });

  try {
    const mapping = await app.persistence.getProviderResolutionMapping(operation.providerId, operation.marketCode, sourceSymbol);
    await reserveProviderOperationBudget(app, operation, 1);
    const verification = await verifyProviderFixerCandidate(
      app,
      operation.providerId,
      operation.marketCode,
      sourceSymbol,
      resolvedSymbol,
      resolverMode,
    );
    if (!verification.verified) {
      await app.persistence.upsertProviderOperationOutcome({
        operationId: operation.id,
        providerId: operation.providerId,
        marketCode: operation.marketCode,
        sourceSymbol,
        providerSymbol: resolvedSymbol,
        action: "reverify_mapping",
        state: "failed",
        message: `Mapping verification failed for ${resolvedSymbol}: ${verification.reason ?? "unknown"}.`,
        errorCode: verification.reason ?? "provider_mapping_reverify_failed",
        evidence: { checkedSymbol: verification.checkedSymbol, resolverMode: verification.resolverMode },
      });
      const failed = await app.persistence.updateProviderOperation({
        id: operation.id,
        phase: "failed",
        completedAt: new Date().toISOString(),
        metadata: {
          ...metadata,
          progressPercent: 100,
          failureReason: verification.reason ?? "provider_mapping_reverify_failed",
        },
      });
      await app.persistence.createProviderOperationLog({
        operationId: operation.id,
        phase: "failed",
        level: "warning",
        message: `reverify_failed provider=${operation.providerId} market=${operation.marketCode} source_symbol=${sourceSymbol} reason=${verification.reason ?? "unknown"}`,
        context: { providerId: operation.providerId, marketCode: operation.marketCode, sourceSymbol, verification },
      });
      await app.persistence.appendAuditLog({
        actorUserId: context.actorUserId,
        action: "provider_fixer_operation",
        ipAddress: context.ipAddress,
        metadata: {
          operationId: operation.id,
          action: "reverify_failed",
          providerId: operation.providerId,
          marketCode: operation.marketCode,
          sourceSymbol,
          resolvedSymbol,
          reason: verification.reason ?? "provider_mapping_reverify_failed",
        },
      });
      await app.eventBus.publishEvent(context.actorUserId, "provider_operation_phase_changed", {
        operationId: operation.id,
        providerId: operation.providerId,
        phase: failed.phase,
      });
      await maybeStartNextQueuedProviderOperation(app, failed.providerId, failed.marketCode, {
        actorUserId: context.actorUserId,
        ipAddress: context.ipAddress,
        guardrails: context.guardrails,
      });
      if (context.throwOnFailure) {
        throw routeError(502, "provider_mapping_reverify_failed", verification.reason ?? "Provider mapping verification failed");
      }
      return { operation: providerFixerOperationToDto(failed, context.guardrails), result: { status: "failed", verification } };
    }

    const verifiedAt = new Date().toISOString();
    await app.persistence.upsertProviderResolutionMapping({
      providerId: operation.providerId,
      marketCode: operation.marketCode,
      sourceSymbol,
      resolvedSymbol,
      resolverMode,
      evidence: {
        ...(mapping?.evidence ?? {}),
        reverifiedAt: verifiedAt,
        reverifiedByOperationId: operation.id,
        checkedSymbol: verification.checkedSymbol,
        resolverMode: verification.resolverMode,
      },
      verifiedAt,
      verifiedByUserId: context.actorUserId,
    });
    await app.persistence.upsertProviderOperationOutcome({
      operationId: operation.id,
      providerId: operation.providerId,
      marketCode: operation.marketCode,
      sourceSymbol,
      providerSymbol: resolvedSymbol,
      action: "reverify_mapping",
      state: "succeeded",
      message: `Reverified ${sourceSymbol} -> ${resolvedSymbol}.`,
      evidence: { checkedSymbol: verification.checkedSymbol, resolverMode: verification.resolverMode },
    });
    const completed = await app.persistence.updateProviderOperation({
      id: operation.id,
      phase: "completed",
      completedAt: verifiedAt,
      metadata: { ...metadata, progressPercent: 100 },
    });
    await app.persistence.createProviderOperationLog({
      operationId: operation.id,
      phase: "completed",
      level: "info",
      message: `reverify_completed provider=${operation.providerId} market=${operation.marketCode} source_symbol=${sourceSymbol} resolved_symbol=${resolvedSymbol}`,
      context: { providerId: operation.providerId, marketCode: operation.marketCode, sourceSymbol, resolvedSymbol },
    });
    await app.persistence.appendAuditLog({
      actorUserId: context.actorUserId,
      action: "provider_fixer_operation",
      ipAddress: context.ipAddress,
      metadata: {
        operationId: operation.id,
        action: "reverify_completed",
        providerId: operation.providerId,
        marketCode: operation.marketCode,
        sourceSymbol,
        resolvedSymbol,
      },
    });
    await app.eventBus.publishEvent(context.actorUserId, "provider_operation_phase_changed", {
      operationId: operation.id,
      providerId: operation.providerId,
      phase: completed.phase,
    });
    await app.eventBus.publishEvent(context.actorUserId, "provider_operation_progress", {
      operationId: operation.id,
      providerId: operation.providerId,
      processed: 1,
      total: 1,
      progressPercent: 100,
    });
    await maybeStartNextQueuedProviderOperation(app, completed.providerId, completed.marketCode, {
      actorUserId: context.actorUserId,
      ipAddress: context.ipAddress,
      guardrails: context.guardrails,
    });
    return { operation: providerFixerOperationToDto(completed, context.guardrails), result: { status: "completed", verification } };
  } catch (err) {
    const isRateLimited = err instanceof RateLimitedError;
    const message = err instanceof Error ? err.message : "Provider mapping reverify failed.";
    const latestMetadata = asRecord((await app.persistence.getProviderOperation(operation.id))?.metadata) ?? metadata;
    await app.persistence.upsertProviderOperationOutcome({
      operationId: operation.id,
      providerId: operation.providerId,
      marketCode: operation.marketCode,
      sourceSymbol,
      providerSymbol: resolvedSymbol,
      action: "reverify_mapping",
      state: isRateLimited ? "rate_limited" : "failed",
      message,
      errorCode: isRateLimited ? "provider_rate_limited" : "provider_mapping_reverify_failed",
    });
    const interrupted = await app.persistence.updateProviderOperation({
      id: operation.id,
      phase: isRateLimited ? "paused" : "failed",
      completedAt: isRateLimited ? null : new Date().toISOString(),
      metadata: {
        ...latestMetadata,
        progressPercent: 100,
        pauseReason: isRateLimited ? "paused_rate_limit" : undefined,
        failureReason: message,
        failureName: err instanceof Error ? err.name : "UnknownError",
        msUntilAvailable: isRateLimited ? err.msUntilAvailable : undefined,
      },
    });
    await app.persistence.createProviderOperationLog({
      operationId: operation.id,
      phase: interrupted.phase,
      level: isRateLimited ? "warning" : "error",
      message: `${isRateLimited ? "reverify_auto_paused_rate_limited" : "reverify_failed"} provider=${operation.providerId} market=${operation.marketCode} source_symbol=${sourceSymbol} reason=${message}`,
      context: { providerId: operation.providerId, marketCode: operation.marketCode, sourceSymbol, errorMessage: message },
    });
    await app.persistence.appendAuditLog({
      actorUserId: context.actorUserId,
      action: "provider_fixer_operation",
      ipAddress: context.ipAddress,
      metadata: {
        operationId: operation.id,
        action: isRateLimited ? "reverify_auto_pause" : "reverify_failed",
        providerId: operation.providerId,
        marketCode: operation.marketCode,
        sourceSymbol,
        resolvedSymbol,
        errorName: err instanceof Error ? err.name : "UnknownError",
        errorMessage: message,
        msUntilAvailable: isRateLimited ? err.msUntilAvailable : null,
      },
    });
    await app.eventBus.publishEvent(context.actorUserId, "provider_operation_phase_changed", {
      operationId: operation.id,
      providerId: operation.providerId,
      phase: interrupted.phase,
      pauseReason: isRateLimited ? "paused_rate_limit" : null,
    });
    if (!isRateLimited) {
      await maybeStartNextQueuedProviderOperation(app, interrupted.providerId, interrupted.marketCode, {
        actorUserId: context.actorUserId,
        ipAddress: context.ipAddress,
        guardrails: context.guardrails,
      });
    }
    if (context.throwOnFailure) {
      if (isRateLimited) {
        throw routeError(503, "provider_rate_limited", message);
      }
      throw err;
    }
    return {
      operation: providerFixerOperationToDto(interrupted, context.guardrails),
      result: { status: interrupted.phase, errorMessage: message },
    };
  }
}

function runProviderMappingReverifyOperationInBackground(
  app: FastifyInstance,
  operation: ProviderOperationRecord,
  context: Omit<Parameters<typeof completeProviderMappingReverifyOperation>[2], "throwOnFailure">,
): void {
  setImmediate(() => {
    void completeProviderMappingReverifyOperation(app, operation, { ...context, throwOnFailure: false }).catch((err) => {
      app.log.error(
        {
          operationId: operation.id,
          providerId: operation.providerId,
          err,
        },
        "provider_mapping_reverify_background_failed",
      );
    });
  });
}

function providerMappingRevertConfirmationText(sourceSymbol: string): string {
  return `REVERT ${sourceSymbol.trim().toUpperCase()}`;
}

async function completeProviderMappingRevertOperation(
  app: FastifyInstance,
  operation: ProviderOperationRecord,
  context: {
    actorUserId: string;
    ipAddress?: string;
    guardrails: ProviderFixerDashboardGuardrailSettingsDto;
    throwOnFailure: boolean;
  },
): Promise<{ operation: ProviderFixerDashboardOperationDto; result: Record<string, unknown> }> {
  const metadata = asRecord(operation.metadata) ?? {};
  const sourceSymbol = stringField(metadata.mappingSourceSymbol);
  const resolvedSymbol = stringField(metadata.mappingResolvedSymbol);
  if (!sourceSymbol || !resolvedSymbol) {
    const message = "Provider mapping revert operation is missing mapping metadata.";
    const failed = await app.persistence.updateProviderOperation({
      id: operation.id,
      phase: "failed",
      completedAt: new Date().toISOString(),
      metadata: { ...metadata, progressPercent: 100, failureReason: message },
    });
    await app.persistence.createProviderOperationLog({
      operationId: operation.id,
      phase: "failed",
      level: "error",
      message: `revert_failed provider=${operation.providerId} market=${operation.marketCode} reason=${message}`,
      context: { providerId: operation.providerId, marketCode: operation.marketCode, errorMessage: message },
    });
    await app.eventBus.publishEvent(context.actorUserId, "provider_operation_phase_changed", {
      operationId: operation.id,
      providerId: operation.providerId,
      phase: failed.phase,
    });
    await maybeStartNextQueuedProviderOperation(app, failed.providerId, failed.marketCode, {
      actorUserId: context.actorUserId,
      ipAddress: context.ipAddress,
      guardrails: context.guardrails,
    });
    if (context.throwOnFailure) {
      throw routeError(400, "provider_mapping_revert_metadata_missing", message);
    }
    return { operation: providerFixerOperationToDto(failed, context.guardrails), result: { status: "failed", errorMessage: message } };
  }

  await app.persistence.upsertProviderOperationOutcome({
    operationId: operation.id,
    providerId: operation.providerId,
    marketCode: operation.marketCode,
    sourceSymbol,
    providerSymbol: resolvedSymbol,
    action: "revert_mapping",
    state: "running",
    message: "Removing durable provider mapping.",
    evidence: { previousEvidence: metadata.mappingPreviousEvidence ?? null },
  });

  try {
    const deleted = await app.persistence.deleteProviderResolutionMapping({
      providerId: operation.providerId,
      marketCode: operation.marketCode,
      sourceSymbol,
    });
    const state = deleted ? "succeeded" : "skipped";
    const message = deleted
      ? `Reverted ${sourceSymbol} -> ${resolvedSymbol}.`
      : `Mapping ${sourceSymbol} -> ${resolvedSymbol} was already absent.`;
    await app.persistence.upsertProviderOperationOutcome({
      operationId: operation.id,
      providerId: operation.providerId,
      marketCode: operation.marketCode,
      sourceSymbol,
      providerSymbol: resolvedSymbol,
      action: "revert_mapping",
      state,
      message,
      evidence: {
        deletedMapping: deleted
          ? {
              resolvedSymbol: deleted.resolvedSymbol,
              resolverMode: deleted.resolverMode,
              verifiedAt: deleted.verifiedAt,
              evidence: deleted.evidence,
            }
          : null,
      },
    });
    const completedAt = new Date().toISOString();
    const completed = await app.persistence.updateProviderOperation({
      id: operation.id,
      phase: "completed",
      completedAt,
      metadata: {
        ...metadata,
        progressPercent: 100,
        revertedMappingCount: deleted ? 1 : 0,
        skippedMappingCount: deleted ? 0 : 1,
      },
    });
    await app.persistence.createProviderOperationLog({
      operationId: operation.id,
      phase: "completed",
      level: deleted ? "warning" : "info",
      message: `revert_completed provider=${operation.providerId} market=${operation.marketCode} source_symbol=${sourceSymbol} resolved_symbol=${resolvedSymbol} deleted=${deleted ? 1 : 0}`,
      context: { providerId: operation.providerId, marketCode: operation.marketCode, sourceSymbol, resolvedSymbol, deleted: Boolean(deleted) },
    });
    await app.persistence.appendAuditLog({
      actorUserId: context.actorUserId,
      action: "provider_fixer_operation",
      ipAddress: context.ipAddress,
      metadata: {
        operationId: operation.id,
        action: "revert_mapping",
        providerId: operation.providerId,
        marketCode: operation.marketCode,
        sourceSymbol,
        resolvedSymbol,
        deleted: Boolean(deleted),
      },
    });
    await app.eventBus.publishEvent(context.actorUserId, "provider_operation_phase_changed", {
      operationId: operation.id,
      providerId: operation.providerId,
      phase: completed.phase,
    });
    await app.eventBus.publishEvent(context.actorUserId, "provider_mapping_changed", {
      operationId: operation.id,
      providerId: operation.providerId,
      marketCode: operation.marketCode,
      sourceSymbol,
      resolvedSymbol,
      action: "revert_mapping",
    });
    await app.eventBus.publishEvent(context.actorUserId, "provider_operation_progress", {
      operationId: operation.id,
      providerId: operation.providerId,
      processed: 1,
      total: 1,
      progressPercent: 100,
    });
    await maybeStartNextQueuedProviderOperation(app, completed.providerId, completed.marketCode, {
      actorUserId: context.actorUserId,
      ipAddress: context.ipAddress,
      guardrails: context.guardrails,
    });
    return {
      operation: providerFixerOperationToDto(completed, context.guardrails),
      result: { status: "completed", deleted: Boolean(deleted) },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Provider mapping revert failed.";
    const failed = await app.persistence.updateProviderOperation({
      id: operation.id,
      phase: "failed",
      completedAt: new Date().toISOString(),
      metadata: {
        ...metadata,
        progressPercent: 100,
        failureReason: message,
        failureName: err instanceof Error ? err.name : "UnknownError",
      },
    });
    await app.persistence.upsertProviderOperationOutcome({
      operationId: operation.id,
      providerId: operation.providerId,
      marketCode: operation.marketCode,
      sourceSymbol,
      providerSymbol: resolvedSymbol,
      action: "revert_mapping",
      state: "failed",
      message,
      errorCode: "provider_mapping_revert_failed",
    });
    await app.persistence.createProviderOperationLog({
      operationId: operation.id,
      phase: "failed",
      level: "error",
      message: `revert_failed provider=${operation.providerId} market=${operation.marketCode} source_symbol=${sourceSymbol} reason=${message}`,
      context: { providerId: operation.providerId, marketCode: operation.marketCode, sourceSymbol, errorMessage: message },
    });
    await app.persistence.appendAuditLog({
      actorUserId: context.actorUserId,
      action: "provider_fixer_operation",
      ipAddress: context.ipAddress,
      metadata: {
        operationId: operation.id,
        action: "revert_mapping_failed",
        providerId: operation.providerId,
        marketCode: operation.marketCode,
        sourceSymbol,
        resolvedSymbol,
        errorName: err instanceof Error ? err.name : "UnknownError",
        errorMessage: message,
      },
    });
    await app.eventBus.publishEvent(context.actorUserId, "provider_operation_phase_changed", {
      operationId: operation.id,
      providerId: operation.providerId,
      phase: failed.phase,
    });
    await maybeStartNextQueuedProviderOperation(app, failed.providerId, failed.marketCode, {
      actorUserId: context.actorUserId,
      ipAddress: context.ipAddress,
      guardrails: context.guardrails,
    });
    if (context.throwOnFailure) throw err;
    return { operation: providerFixerOperationToDto(failed, context.guardrails), result: { status: "failed", errorMessage: message } };
  }
}

function runProviderMappingRevertOperationInBackground(
  app: FastifyInstance,
  operation: ProviderOperationRecord,
  context: Omit<Parameters<typeof completeProviderMappingRevertOperation>[2], "throwOnFailure">,
): void {
  setImmediate(() => {
    void completeProviderMappingRevertOperation(app, operation, { ...context, throwOnFailure: false }).catch((err) => {
      app.log.error(
        {
          operationId: operation.id,
          providerId: operation.providerId,
          err,
        },
        "provider_mapping_revert_background_failed",
      );
    });
  });
}

function runProviderOperationInBackground(
  app: FastifyInstance,
  operation: ProviderOperationRecord,
  context: {
    actorUserId: string;
    ipAddress?: string;
    guardrails: ProviderFixerDashboardGuardrailSettingsDto;
  },
): void {
  if (operation.operationType === "renew_evidence") {
    runProviderRenewEvidenceOperationInBackground(app, operation, context);
    return;
  }
  if (operation.operationType === "rerun_backfill") {
    runProviderRerunBackfillOperationInBackground(app, operation, context);
    return;
  }
  if (operation.operationType === "reverify_mapping") {
    runProviderMappingReverifyOperationInBackground(app, operation, context);
    return;
  }
  if (operation.operationType === "revert_mapping") {
    runProviderMappingRevertOperationInBackground(app, operation, context);
    return;
  }
  if (operation.operationType === "resolver_repair" || operation.operationType === "repair_mapping") {
    runProviderFixerOperationInBackground(app, operation, {
      ...context,
      dangerous: providerFixerOperationToDto(operation, context.guardrails).dangerous,
    });
  }
}

async function maybeStartNextQueuedProviderOperation(
  app: FastifyInstance,
  providerId: string,
  marketCode: MarketCode,
  context: {
    actorUserId: string;
    ipAddress?: string;
    guardrails: ProviderFixerDashboardGuardrailSettingsDto;
  },
): Promise<ProviderOperationRecord | null> {
  const active = await findOtherActiveProviderOperationExecution(app, { providerId, marketCode });
  if (active) return null;
  const queued = await app.persistence.listProviderOperations({
    providerId,
    marketCode,
    phases: ["queued"],
    page: 1,
    limit: 50,
  });
  const next = queued.items.sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  if (!next) return null;
  const startedAt = new Date().toISOString();
  const actorUserId = next.actorUserId ?? context.actorUserId;
  const running = await app.persistence.updateProviderOperation({
    id: next.id,
    phase: "running",
    startedAt,
    metadata: {
      ...(asRecord(next.metadata) ?? {}),
      progressPercent: 0,
      queuedUntilStart: startedAt,
    },
  });
  await app.persistence.createProviderOperationLog({
    operationId: running.id,
    phase: "running",
    level: "info",
    message: `queued_operation_started provider=${running.providerId} market=${running.marketCode} operation_type=${running.operationType}`,
    context: {
      providerId: running.providerId,
      marketCode: running.marketCode,
      operationType: running.operationType,
    },
  });
  await app.persistence.appendAuditLog({
    actorUserId,
    action: "provider_fixer_operation",
    ipAddress: context.ipAddress,
    metadata: {
      operationId: running.id,
      action: "queued_operation_started",
      providerId: running.providerId,
      marketCode: running.marketCode,
      operationType: running.operationType,
    },
  });
  await app.eventBus.publishEvent(actorUserId, "provider_operation_phase_changed", {
    operationId: running.id,
    providerId: running.providerId,
    phase: running.phase,
  });
  runProviderOperationInBackground(app, running, { ...context, actorUserId });
  return running;
}

function registerProviderFixerAdminRoutes(app: FastifyInstance): void {
  const providerConsoleParamsSchema = z.object({
    providerId: providerFixerProviderSchema,
  });
  const providerConsoleOperationParamsSchema = providerConsoleParamsSchema.extend({
    operationId: z.string().trim().min(1).max(120),
  });

  async function loadProviderOperationSummary(req: FastifyRequest): Promise<ProviderFixerDashboardSummaryResponse> {
    requireAdminRole(req);
    const { sessionUserId, ipAddress } = resolveAdminContext(req, app);
    const config = await loadAppConfigDto(app);
    await pauseStaleProviderOperations(app, config.effectiveProviderOperationStaleHeartbeatMinutes, { actorUserId: sessionUserId, ipAddress });
    const guardrails = providerFixerGuardrailsFromConfig(config);
    return providerFixerSummary(app, guardrails, config);
  }

  async function loadProviderDiagnostics(
    req: FastifyRequest,
    providerIdOverride?: string,
  ): Promise<ProviderFixerDashboardDiagnosticsResponse> {
    requireAdminRole(req);
    const query = z
      .object({
        providerId: providerIdOverride
          ? providerFixerProviderSchema.optional()
          : providerFixerProviderSchema.default("yahoo-finance-kr"),
        marketCode: providerFixerMarketCodeSchema.optional(),
        resolverMode: providerFixerResolverModeSchema.default("quote_first"),
        errorCode: providerFixerErrorCodeSchema.default("yahoo_finance_kr_symbol_unresolved"),
      })
      .parse(req.query ?? {});
    const providerId = providerIdOverride ?? query.providerId ?? "yahoo-finance-kr";
    const config = await loadAppConfigDto(app);
    const guardrails = providerFixerGuardrailsFromConfig(config);
    return providerFixerDiagnostics(
      app,
      guardrails,
      providerId,
      providerFixerMarketCode(providerId, query.marketCode),
      query.resolverMode,
      query.errorCode,
    );
  }

  async function createProviderOperationPreview(
    req: FastifyRequest,
    reply: FastifyReply,
    providerIdOverride?: string,
  ) {
    requireAdminRole(req);
    const { sessionUserId, ipAddress } = resolveAdminContext(req, app);
    const body = providerIdOverride
      ? providerFixerPreviewBodySchema.partial({ providerId: true }).parse(req.body ?? {})
      : providerFixerPreviewBodySchema.parse(req.body ?? {});
    const providerId = providerIdOverride ?? body.providerId ?? "yahoo-finance-kr";
    const config = await loadAppConfigDto(app);
    const guardrails = providerFixerGuardrailsFromConfig(config);
    const marketCode = providerFixerMarketCode(providerId, body.marketCode);
    const effectiveRateCapPerMinute = providerOperationRateCapPerMinute(providerId, config);
    const { sample } = await buildProviderFixerEvidenceSample(
      app,
      providerId,
      marketCode,
      body.errorCode,
      body.resolverMode,
      guardrails.previewSampleLimit,
    );
    const scopeSnapshot = await buildProviderFixerScopeSnapshot(app, providerId, marketCode, body.errorCode);
    const token = newProviderFixerToken();
    const dangerous = scopeSnapshot.matchCount >= guardrails.dangerousMatchThreshold;
    const confirmationText = dangerous ? `EXECUTE ${scopeSnapshot.matchCount}` : null;
    const now = Date.now();
    const operation = await app.persistence.createProviderOperation({
      providerId,
      marketCode,
      operationType: "resolver_repair",
      phase: "preview",
      errorCode: body.errorCode,
      resolverMode: body.resolverMode,
      scopeQuery: `${providerId}:${marketCode}:${body.errorCode}`,
      snapshotHash: scopeSnapshot.snapshotHash,
      previewTokenHash: hashProviderFixerToken(token),
      previewExpiresAt: new Date(now + guardrails.previewTokenTtlSeconds * 1000).toISOString(),
      matchCount: scopeSnapshot.matchCount,
      sample,
      metadata: {
        previewTokenDisplay: token,
        confirmationText,
        effectiveRateCapPerMinute,
        autoPauseFailureThresholdPerMinute: guardrails.autoPauseFailureThresholdPerMinute,
      },
      actorUserId: sessionUserId,
    });
    await app.persistence.createProviderOperationLog({
      operationId: operation.id,
      phase: "preview",
      level: scopeSnapshot.matchCount > 0 ? "info" : "warning",
      message: `preview provider=${providerId} market=${marketCode} error_code=${body.errorCode} matched=${scopeSnapshot.matchCount} sample=${sample.length}`,
      context: {
        providerId,
        marketCode,
        errorCode: body.errorCode,
        resolverMode: body.resolverMode,
        dangerous,
      },
    });
    await app.persistence.appendAuditLog({
      actorUserId: sessionUserId,
      action: "provider_fixer_operation",
      ipAddress,
      metadata: {
        operationId: operation.id,
        action: "preview",
        providerId,
        marketCode,
        errorCode: body.errorCode,
        resolverMode: body.resolverMode,
        matchCount: scopeSnapshot.matchCount,
        dangerous,
      },
    });
    reply.code(201);
    return { operation: providerFixerOperationToDto(operation, guardrails) };
  }

  app.get("/providers/:providerId/operations/summary", async (req) => {
    providerConsoleParamsSchema.parse(req.params);
    return loadProviderOperationSummary(req);
  });

  app.get("/providers/:providerId/diagnostics", (req) => {
    const { providerId } = providerConsoleParamsSchema.parse(req.params);
    return loadProviderDiagnostics(req, providerId);
  });

  app.post("/providers/:providerId/operations/renew", async (req, reply) => {
    requireAdminRole(req);
    const { sessionUserId, ipAddress } = resolveAdminContext(req, app);
    const { providerId } = providerConsoleParamsSchema.parse(req.params);
    const body = z
      .object({
        marketCode: providerFixerMarketCodeSchema.optional(),
        resolverMode: providerFixerResolverModeSchema.default("quote_first"),
        errorCode: providerFixerErrorCodeSchema.default("symbol_unresolved"),
      })
      .strict()
      .parse(req.body ?? {});
    const capability = listProviderOperationCapabilities([providerId])[0];
    if (!capability?.actions.some((action) => action.action === "renew_evidence" && action.supported)) {
      throw routeError(400, "provider_operation_not_supported", "Renew evidence is not supported for this provider");
    }
    const config = await loadAppConfigDto(app);
    const guardrails = providerFixerGuardrailsFromConfig(config);
    const marketCode = providerFixerMarketCode(providerId, body.marketCode);
    const effectiveRateCapPerMinute = providerOperationRateCapPerMinute(providerId, config);
    const activeOperation = await findOtherActiveProviderOperationExecution(app, { providerId, marketCode });
    const initialPhase: ProviderOperationPhase = activeOperation ? "queued" : "running";
    const startedAt = activeOperation ? null : new Date().toISOString();
    const firstPage = await app.persistence.listProviderErrorTrailPage({
      providerId,
      marketCode,
      errorMessageLike: body.errorCode,
      page: 1,
      limit: guardrails.previewSampleLimit,
    });
    const sample = firstPage.items.map((row): ProviderFixerDashboardEvidenceSampleDto => {
      const extractedTicker = extractProviderFixerTicker(row);
      const symbol = (extractedTicker ?? `error-trail-${row.id}`).replace(/\.(KS|KQ)$/i, "").toUpperCase();
      return {
        symbol,
        providerSymbol: extractedTicker ?? symbol,
        candidateSymbol: null,
        exchangeHint: null,
        verificationStatus: "pending",
        note: "Renew evidence pending.",
      };
    });
    const operation = await app.persistence.createProviderOperation({
      providerId,
      marketCode,
      operationType: "renew_evidence",
      phase: initialPhase,
      errorCode: body.errorCode,
      resolverMode: body.resolverMode,
      scopeQuery: `${providerId}:${marketCode}:${body.errorCode}`,
      snapshotHash: hashProviderFixerToken(`${providerId}:${marketCode}:${body.errorCode}:renew:${firstPage.total}:${Date.now()}`).slice(0, 12),
      matchCount: firstPage.total,
      sample,
      metadata: {
        progressPercent: 0,
        previewSampleLimit: guardrails.previewSampleLimit,
        effectiveRateCapPerMinute,
        queuedBehindOperationId: activeOperation?.id ?? null,
      },
      actorUserId: sessionUserId,
      startedAt,
    });
    await app.persistence.createProviderOperationLog({
      operationId: operation.id,
      phase: initialPhase,
      level: "info",
      message: `${activeOperation ? "renew_queued" : "renew_started"} provider=${providerId} market=${marketCode} error_code=${body.errorCode} matched=${firstPage.total}`,
      context: { providerId, marketCode, errorCode: body.errorCode, resolverMode: body.resolverMode, queuedBehindOperationId: activeOperation?.id ?? null },
    });
    await app.persistence.appendAuditLog({
      actorUserId: sessionUserId,
      action: "provider_fixer_operation",
      ipAddress,
      metadata: {
        operationId: operation.id,
        action: activeOperation ? "renew_evidence_queued" : "renew_evidence_started",
        providerId,
        marketCode,
        errorCode: body.errorCode,
        resolverMode: body.resolverMode,
        matchCount: firstPage.total,
        queuedBehindOperationId: activeOperation?.id ?? null,
      },
    });
    await app.eventBus.publishEvent(sessionUserId, "provider_operation_phase_changed", {
      operationId: operation.id,
      providerId,
      phase: operation.phase,
    });
    if (!activeOperation) {
      runProviderRenewEvidenceOperationInBackground(app, operation, {
        actorUserId: sessionUserId,
        ipAddress,
        guardrails,
      });
    }
    reply.code(202);
    return { operation: providerFixerOperationToDto(operation, guardrails), result: { status: activeOperation ? "queued" : "started" } };
  });

  app.get("/providers/:providerId/unresolved", async (req): Promise<ProviderUnresolvedItemsResponse> => {
    requireAdminRole(req);
    const { providerId } = providerConsoleParamsSchema.parse(req.params);
    const query = z
      .object({
        marketCode: providerFixerMarketCodeSchema.optional(),
        state: z.enum(["active", "resolved", "unsupported", "ignored"]).default("active"),
        errorCode: providerFixerErrorCodeSchema.optional(),
        search: z.string().trim().max(120).optional(),
        sort: z.enum(["last_seen_desc", "updated_desc", "source_symbol_asc", "occurrence_count_desc"]).default("last_seen_desc"),
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(200).default(25),
      })
      .parse(req.query ?? {});
    const result = await app.persistence.listProviderUnresolvedItems({
      providerId,
      marketCode: query.marketCode,
      state: query.state,
      errorCode: query.errorCode,
      search: query.search,
      sort: query.sort,
      page: query.page,
      limit: query.limit,
    });
    return {
      items: result.items.map((item) => ({
        providerId: item.providerId,
        marketCode: item.marketCode as ProviderUnresolvedItemDto["marketCode"],
        errorCode: item.errorCode,
        sourceSymbol: item.sourceSymbol,
        providerSymbol: item.providerSymbol,
        state: item.state,
        severity: item.severity,
        occurrenceCount: item.occurrenceCount,
        firstSeenAt: item.firstSeenAt,
        lastSeenAt: item.lastSeenAt,
        lastErrorTrailId: item.lastErrorTrailId,
        evidence: item.evidence,
        resolvedAt: item.resolvedAt,
        resolvedByOperationId: item.resolvedByOperationId,
        updatedAt: item.updatedAt,
      })),
      total: result.total,
      page: result.page,
      limit: result.limit,
    };
  });

  app.post("/providers/:providerId/unresolved/state", async (req): Promise<ProviderUnresolvedItemUpdateResponse> => {
    requireAdminRole(req);
    const { sessionUserId, ipAddress } = resolveAdminContext(req, app);
    const { providerId } = providerConsoleParamsSchema.parse(req.params);
    const body = z
      .object({
        marketCode: providerFixerMarketCodeSchema,
        errorCode: providerFixerErrorCodeSchema,
        sourceSymbol: z.string().trim().min(1).max(80),
        state: z.enum(["active", "unsupported", "ignored"]),
        reason: z.string().trim().max(240).optional(),
      })
      .strict()
      .parse(req.body ?? {});
    const action = body.state === "active" ? "reopen_unresolved" : body.state === "ignored" ? "ignore_unresolved" : "mark_unsupported";
    const startedAt = new Date().toISOString();
    const operation = await app.persistence.createProviderOperation({
      providerId,
      marketCode: body.marketCode,
      operationType: action,
      phase: "running",
      errorCode: body.errorCode,
      scopeQuery: `${providerId}:unresolved:${action}:${body.sourceSymbol}`,
      snapshotHash: hashProviderFixerToken(`${providerId}:${body.marketCode}:${body.errorCode}:${body.sourceSymbol}:${body.state}`).slice(0, 12),
      previewTokenHash: null,
      previewExpiresAt: null,
      matchCount: 1,
      sample: [],
      metadata: {
        sourceSymbol: body.sourceSymbol,
        targetState: body.state,
        reason: body.reason ?? null,
        progressPercent: 0,
      },
      actorUserId: sessionUserId,
      startedAt,
    });
    let item: Awaited<ReturnType<typeof app.persistence.updateProviderUnresolvedItemState>>;
    try {
      item = await app.persistence.updateProviderUnresolvedItemState({
        providerId,
        marketCode: body.marketCode,
        errorCode: body.errorCode,
        sourceSymbol: body.sourceSymbol,
        state: body.state,
        actorUserId: sessionUserId,
        reason: body.reason ?? null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Provider unresolved lifecycle update failed.";
      const failed = await app.persistence.updateProviderOperation({
        id: operation.id,
        phase: "failed",
        completedAt: new Date().toISOString(),
        metadata: {
          ...(asRecord(operation.metadata) ?? {}),
          progressPercent: 100,
          failureReason: message,
          failureName: err instanceof Error ? err.name : "UnknownError",
        },
      });
      await app.persistence.upsertProviderOperationOutcome({
        operationId: operation.id,
        providerId,
        marketCode: body.marketCode,
        sourceSymbol: body.sourceSymbol,
        providerSymbol: body.sourceSymbol,
        action,
        state: "failed",
        message,
        errorCode: "provider_unresolved_state_update_failed",
        evidence: { targetState: body.state, reason: body.reason ?? null },
      });
      await app.persistence.createProviderOperationLog({
        operationId: operation.id,
        phase: failed.phase,
        level: "error",
        message: `${action}_failed provider=${providerId} market=${body.marketCode} source_symbol=${body.sourceSymbol} reason=${message}`,
        context: { providerId, marketCode: body.marketCode, errorCode: body.errorCode, sourceSymbol: body.sourceSymbol, errorMessage: message },
      });
      await app.eventBus.publishEvent(sessionUserId, "provider_operation_phase_changed", {
        operationId: operation.id,
        providerId,
        phase: failed.phase,
      });
      throw err;
    }
    await app.persistence.upsertProviderOperationOutcome({
      operationId: operation.id,
      providerId,
      marketCode: item.marketCode,
      sourceSymbol: item.sourceSymbol,
      providerSymbol: item.providerSymbol,
      action,
      state: "succeeded",
      message: `Set unresolved item ${item.sourceSymbol} to ${item.state}.`,
      evidence: { targetState: item.state, reason: body.reason ?? null },
    });
    const completed = await app.persistence.updateProviderOperation({
      id: operation.id,
      phase: "completed",
      completedAt: new Date().toISOString(),
      metadata: {
        ...(asRecord(operation.metadata) ?? {}),
        progressPercent: 100,
        completedState: item.state,
      },
    });
    await app.persistence.createProviderOperationLog({
      operationId: operation.id,
      phase: completed.phase,
      level: item.state === "unsupported" ? "warning" : "info",
      message: `${action}_completed provider=${providerId} market=${item.marketCode} source_symbol=${item.sourceSymbol} state=${item.state}`,
      context: { providerId, marketCode: item.marketCode, errorCode: item.errorCode, sourceSymbol: item.sourceSymbol, state: item.state, reason: body.reason ?? null },
    });
    await app.eventBus.publishEvent(sessionUserId, "provider_operation_phase_changed", {
      operationId: operation.id,
      providerId,
      phase: completed.phase,
    });
    await app.eventBus.publishEvent(sessionUserId, "provider_operation_progress", {
      operationId: operation.id,
      providerId,
      processed: 1,
      total: 1,
      progressPercent: 100,
    });
    await app.persistence.appendAuditLog({
      actorUserId: sessionUserId,
      action: "provider_fixer_operation",
      ipAddress,
      metadata: {
        operationId: operation.id,
        action,
        providerId,
        marketCode: item.marketCode,
        errorCode: item.errorCode,
        sourceSymbol: item.sourceSymbol,
        state: item.state,
        reason: body.reason ?? null,
      },
    });
    await app.eventBus.publishEvent(sessionUserId, "provider_unresolved_item_changed", {
      providerId,
      marketCode: item.marketCode,
      errorCode: item.errorCode,
      sourceSymbol: item.sourceSymbol,
      state: item.state,
    });
    return {
      item: {
        providerId: item.providerId,
        marketCode: item.marketCode as ProviderUnresolvedItemDto["marketCode"],
        errorCode: item.errorCode,
        sourceSymbol: item.sourceSymbol,
        providerSymbol: item.providerSymbol,
        state: item.state,
        severity: item.severity,
        occurrenceCount: item.occurrenceCount,
        firstSeenAt: item.firstSeenAt,
        lastSeenAt: item.lastSeenAt,
        lastErrorTrailId: item.lastErrorTrailId,
        evidence: item.evidence,
        resolvedAt: item.resolvedAt,
        resolvedByOperationId: item.resolvedByOperationId,
        updatedAt: item.updatedAt,
      },
    };
  });

  app.get("/providers/:providerId/incidents", async (req): Promise<ProviderIncidentsResponse> => {
    requireAdminRole(req);
    const { providerId } = providerConsoleParamsSchema.parse(req.params);
    const query = z
      .object({
        marketCode: providerFixerMarketCodeSchema.optional(),
        status: z.enum(["open", "acknowledged", "resolved", "ignored"]).optional(),
        search: z.string().trim().max(120).optional(),
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(200).default(25),
      })
      .parse(req.query ?? {});
    const result = await app.persistence.listProviderIncidents({
      providerId,
      marketCode: query.marketCode,
      status: query.status,
      search: query.search,
      page: query.page,
      limit: query.limit,
    });
    return {
      items: result.items.map((incident): ProviderIncidentDto => ({
        id: incident.id,
        providerId: incident.providerId,
        marketCode: incident.marketCode as ProviderIncidentDto["marketCode"],
        incidentKey: incident.incidentKey,
        status: incident.status,
        severity: incident.severity,
        title: incident.title,
        summary: incident.summary,
        errorClass: incident.errorClass,
        errorCode: incident.errorCode,
        occurrenceCount: incident.occurrenceCount,
        firstSeenAt: incident.firstSeenAt,
        lastSeenAt: incident.lastSeenAt,
        lastErrorTrailId: incident.lastErrorTrailId,
        linkedOperationId: incident.linkedOperationId,
        metadata: incident.metadata,
        acknowledgedAt: incident.acknowledgedAt,
        acknowledgedByUserId: incident.acknowledgedByUserId,
        resolvedAt: incident.resolvedAt,
        resolvedByUserId: incident.resolvedByUserId,
        ignoredAt: incident.ignoredAt,
        ignoredByUserId: incident.ignoredByUserId,
        createdAt: incident.createdAt,
        updatedAt: incident.updatedAt,
      })),
      total: result.total,
      page: result.page,
      limit: result.limit,
    };
  });

  app.patch("/providers/:providerId/incidents/:incidentId", async (req): Promise<{ incident: ProviderIncidentDto }> => {
    requireAdminRole(req);
    const { sessionUserId, ipAddress } = resolveAdminContext(req, app);
    const { providerId } = providerConsoleParamsSchema.parse(req.params);
    const { incidentId } = z.object({ incidentId: z.string().trim().min(1).max(120) }).parse(req.params);
    const body = z
      .object({
        status: z.enum(["open", "acknowledged", "resolved", "ignored"]),
      })
      .parse(req.body);
    const incident = await app.persistence.updateProviderIncidentStatus({
      providerId,
      incidentId,
      status: body.status,
      actorUserId: sessionUserId,
    });
    await app.persistence.appendAuditLog({
      actorUserId: sessionUserId,
      action: "provider_fixer_operation",
      metadata: {
        targetType: "provider_incident",
        targetId: incident.id,
        providerId,
        incidentId: incident.id,
        incidentKey: incident.incidentKey,
        status: body.status,
      },
      ipAddress,
    });
    await app.eventBus.publishEvent(sessionUserId, "provider_incident_changed", {
      providerId,
      incidentId: incident.id,
      status: incident.status,
    });
    return {
      incident: {
        id: incident.id,
        providerId: incident.providerId,
        marketCode: incident.marketCode as ProviderIncidentDto["marketCode"],
        incidentKey: incident.incidentKey,
        status: incident.status,
        severity: incident.severity,
        title: incident.title,
        summary: incident.summary,
        errorClass: incident.errorClass,
        errorCode: incident.errorCode,
        occurrenceCount: incident.occurrenceCount,
        firstSeenAt: incident.firstSeenAt,
        lastSeenAt: incident.lastSeenAt,
        lastErrorTrailId: incident.lastErrorTrailId,
        linkedOperationId: incident.linkedOperationId,
        metadata: incident.metadata,
        acknowledgedAt: incident.acknowledgedAt,
        acknowledgedByUserId: incident.acknowledgedByUserId,
        resolvedAt: incident.resolvedAt,
        resolvedByUserId: incident.resolvedByUserId,
        ignoredAt: incident.ignoredAt,
        ignoredByUserId: incident.ignoredByUserId,
        createdAt: incident.createdAt,
        updatedAt: incident.updatedAt,
      },
    };
  });

  app.get("/providers/:providerId/mappings", async (req): Promise<ProviderResolutionMappingsResponse> => {
    requireAdminRole(req);
    const { providerId } = providerConsoleParamsSchema.parse(req.params);
    const query = z
      .object({
        marketCode: providerFixerMarketCodeSchema.optional(),
        search: z.string().trim().max(120).optional(),
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(200).default(25),
      })
      .parse(req.query ?? {});
    const result = await app.persistence.listProviderResolutionMappings({
      providerId,
      marketCode: query.marketCode,
      search: query.search,
      page: query.page,
      limit: query.limit,
    });
    return {
      items: result.items.map((mapping): ProviderResolutionMappingDto => ({
        providerId: mapping.providerId,
        marketCode: mapping.marketCode as ProviderResolutionMappingDto["marketCode"],
        sourceSymbol: mapping.sourceSymbol,
        resolvedSymbol: mapping.resolvedSymbol,
        resolverMode: mapping.resolverMode as ProviderResolutionMappingDto["resolverMode"],
        evidence: mapping.evidence,
        verifiedAt: mapping.verifiedAt,
        verifiedByUserId: mapping.verifiedByUserId,
        createdAt: mapping.createdAt,
        updatedAt: mapping.updatedAt,
      })),
      total: result.total,
      page: result.page,
      limit: result.limit,
    };
  });

  app.post("/providers/:providerId/mappings/reverify", async (req, reply) => {
    requireAdminRole(req);
    const { sessionUserId, ipAddress } = resolveAdminContext(req, app);
    const { providerId } = providerConsoleParamsSchema.parse(req.params);
    const body = z
      .object({
        marketCode: providerFixerMarketCodeSchema,
        sourceSymbol: z.string().trim().min(1).max(80),
        resolverMode: providerFixerResolverModeSchema.default("quote_first"),
      })
      .strict()
      .parse(req.body ?? {});
    const sourceSymbol = body.sourceSymbol.trim().toUpperCase();
    const mapping = await app.persistence.getProviderResolutionMapping(providerId, body.marketCode, sourceSymbol);
    if (!mapping) {
      throw routeError(404, "provider_resolution_mapping_not_found", "Provider resolution mapping not found");
    }
    const config = await loadAppConfigDto(app);
    const guardrails = providerFixerGuardrailsFromConfig(config);
    const effectiveRateCapPerMinute = providerOperationRateCapPerMinute(providerId, config);
    const activeOperation = await findOtherActiveProviderOperationExecution(app, { providerId, marketCode: body.marketCode });
    const initialPhase: ProviderOperationPhase = activeOperation ? "queued" : "running";
    const startedAt = activeOperation ? null : new Date().toISOString();
    const operation = await app.persistence.createProviderOperation({
      providerId,
      marketCode: body.marketCode,
      operationType: "reverify_mapping",
      phase: initialPhase,
      resolverMode: body.resolverMode,
      scopeQuery: `${providerId}:${body.marketCode}:${sourceSymbol}`,
      snapshotHash: hashProviderFixerToken(`${providerId}:${body.marketCode}:${sourceSymbol}:${mapping.resolvedSymbol}:${Date.now()}`).slice(0, 12),
      matchCount: 1,
      sample: [{
        symbol: mapping.sourceSymbol,
        providerSymbol: mapping.sourceSymbol,
        candidateSymbol: mapping.resolvedSymbol,
        exchangeHint: "durable provider_resolution_mappings row",
        verificationStatus: "pending",
        note: "Reverify existing durable provider mapping.",
      }],
      metadata: {
        progressPercent: 0,
        mappingSourceSymbol: mapping.sourceSymbol,
        mappingResolvedSymbol: mapping.resolvedSymbol,
        mappingPreviousVerifiedAt: mapping.verifiedAt,
        effectiveRateCapPerMinute,
        queuedBehindOperationId: activeOperation?.id ?? null,
      },
      actorUserId: sessionUserId,
      startedAt,
    });
    await app.persistence.createProviderOperationLog({
      operationId: operation.id,
      phase: initialPhase,
      level: "info",
      message: `${activeOperation ? "reverify_queued" : "reverify_started"} provider=${providerId} market=${body.marketCode} source_symbol=${sourceSymbol} resolved_symbol=${mapping.resolvedSymbol}`,
      context: { providerId, marketCode: body.marketCode, sourceSymbol, resolvedSymbol: mapping.resolvedSymbol, queuedBehindOperationId: activeOperation?.id ?? null },
    });
    await app.persistence.appendAuditLog({
      actorUserId: sessionUserId,
      action: "provider_fixer_operation",
      ipAddress,
      metadata: {
        operationId: operation.id,
        action: activeOperation ? "reverify_mapping_queued" : "reverify_mapping",
        providerId,
        marketCode: body.marketCode,
        sourceSymbol,
        resolvedSymbol: mapping.resolvedSymbol,
        queuedBehindOperationId: activeOperation?.id ?? null,
      },
    });
    await app.eventBus.publishEvent(sessionUserId, "provider_operation_phase_changed", {
      operationId: operation.id,
      providerId,
      phase: operation.phase,
    });
    if (!activeOperation) {
      runProviderMappingReverifyOperationInBackground(app, operation, {
        actorUserId: sessionUserId,
        ipAddress,
        guardrails,
      });
    }
    reply.code(202);
    return { operation: providerFixerOperationToDto(operation, guardrails) };
  });

  app.post("/providers/:providerId/mappings/revert", async (req, reply) => {
    requireAdminRole(req);
    const { sessionUserId, ipAddress } = resolveAdminContext(req, app);
    const { providerId } = providerConsoleParamsSchema.parse(req.params);
    const body = z
      .object({
        marketCode: providerFixerMarketCodeSchema,
        sourceSymbol: z.string().trim().min(1).max(80),
        typedConfirmation: z.string().trim().min(1).max(120),
      })
      .strict()
      .parse(req.body ?? {});
    const sourceSymbol = body.sourceSymbol.trim().toUpperCase();
    const confirmationText = providerMappingRevertConfirmationText(sourceSymbol);
    if (body.typedConfirmation.trim() !== confirmationText) {
      throw routeError(400, "provider_mapping_revert_confirmation_required", "Revert requires the exact typed confirmation phrase");
    }
    const mapping = await app.persistence.getProviderResolutionMapping(providerId, body.marketCode, sourceSymbol);
    if (!mapping) {
      throw routeError(404, "provider_resolution_mapping_not_found", "Provider resolution mapping not found");
    }
    const config = await loadAppConfigDto(app);
    const guardrails = providerFixerGuardrailsFromConfig(config);
    const effectiveRateCapPerMinute = providerOperationRateCapPerMinute(providerId, config);
    const activeOperation = await findOtherActiveProviderOperationExecution(app, { providerId, marketCode: body.marketCode });
    const initialPhase: ProviderOperationPhase = activeOperation ? "queued" : "running";
    const startedAt = activeOperation ? null : new Date().toISOString();
    const operation = await app.persistence.createProviderOperation({
      providerId,
      marketCode: body.marketCode,
      operationType: "revert_mapping",
      phase: initialPhase,
      resolverMode: mapping.resolverMode,
      scopeQuery: `${providerId}:${body.marketCode}:${sourceSymbol}`,
      snapshotHash: hashProviderFixerToken(`${providerId}:${body.marketCode}:${sourceSymbol}:${mapping.resolvedSymbol}:${Date.now()}`).slice(0, 12),
      matchCount: 1,
      sample: [{
        symbol: mapping.sourceSymbol,
        providerSymbol: mapping.resolvedSymbol,
        candidateSymbol: null,
        exchangeHint: "durable provider_resolution_mappings row",
        verificationStatus: "pending",
        note: "Revert existing durable provider mapping.",
      }],
      metadata: {
        progressPercent: 0,
        confirmationText,
        mappingSourceSymbol: mapping.sourceSymbol,
        mappingResolvedSymbol: mapping.resolvedSymbol,
        mappingPreviousVerifiedAt: mapping.verifiedAt,
        mappingPreviousEvidence: mapping.evidence,
        effectiveRateCapPerMinute,
        queuedBehindOperationId: activeOperation?.id ?? null,
      },
      actorUserId: sessionUserId,
      startedAt,
    });
    await app.persistence.createProviderOperationLog({
      operationId: operation.id,
      phase: initialPhase,
      level: "warning",
      message: `${activeOperation ? "revert_queued" : "revert_started"} provider=${providerId} market=${body.marketCode} source_symbol=${sourceSymbol} resolved_symbol=${mapping.resolvedSymbol}`,
      context: { providerId, marketCode: body.marketCode, sourceSymbol, resolvedSymbol: mapping.resolvedSymbol, queuedBehindOperationId: activeOperation?.id ?? null },
    });
    await app.persistence.appendAuditLog({
      actorUserId: sessionUserId,
      action: "provider_fixer_operation",
      ipAddress,
      metadata: {
        operationId: operation.id,
        action: activeOperation ? "revert_mapping_queued" : "revert_mapping_started",
        providerId,
        marketCode: body.marketCode,
        sourceSymbol,
        resolvedSymbol: mapping.resolvedSymbol,
        queuedBehindOperationId: activeOperation?.id ?? null,
      },
    });
    await app.eventBus.publishEvent(sessionUserId, "provider_operation_phase_changed", {
      operationId: operation.id,
      providerId,
      phase: operation.phase,
    });
    if (!activeOperation) {
      runProviderMappingRevertOperationInBackground(app, operation, {
        actorUserId: sessionUserId,
        ipAddress,
        guardrails,
      });
    }
    reply.code(202);
    return { operation: providerFixerOperationToDto(operation, guardrails) };
  });

  app.post("/providers/:providerId/mappings/rerun", async (req, reply) => {
    requireAdminRole(req);
    const { sessionUserId, ipAddress } = resolveAdminContext(req, app);
    const { providerId } = providerConsoleParamsSchema.parse(req.params);
    const body = z
      .object({
        marketCode: providerFixerMarketCodeSchema,
        sourceSymbol: z.string().trim().min(1).max(80),
        resolverMode: providerFixerResolverModeSchema.default("quote_first"),
        acknowledged: z.literal(true),
      })
      .strict()
      .parse(req.body ?? {});
    const sourceSymbol = body.sourceSymbol.trim().toUpperCase();
    const mapping = await app.persistence.getProviderResolutionMapping(providerId, body.marketCode, sourceSymbol);
    if (!mapping) {
      throw routeError(404, "provider_resolution_mapping_not_found", "Provider resolution mapping not found");
    }
    const config = await loadAppConfigDto(app);
    const guardrails = providerFixerGuardrailsFromConfig(config);
    const effectiveRateCapPerMinute = providerOperationRateCapPerMinute(providerId, config);
    const activeOperation = await findOtherActiveProviderOperationExecution(app, { providerId, marketCode: body.marketCode });
    const initialPhase: ProviderOperationPhase = activeOperation ? "queued" : "running";
    const startedAt = activeOperation ? null : new Date().toISOString();
    const operation = await app.persistence.createProviderOperation({
      providerId,
      marketCode: body.marketCode,
      operationType: "rerun_backfill",
      phase: initialPhase,
      resolverMode: body.resolverMode,
      scopeQuery: `${providerId}:${body.marketCode}:${sourceSymbol}`,
      snapshotHash: hashProviderFixerToken(`${providerId}:${body.marketCode}:${sourceSymbol}:${mapping.resolvedSymbol}:rerun:${Date.now()}`).slice(0, 12),
      matchCount: 1,
      sample: [{
        symbol: mapping.sourceSymbol,
        providerSymbol: mapping.resolvedSymbol,
        candidateSymbol: mapping.resolvedSymbol,
        exchangeHint: "durable provider_resolution_mappings row",
        verificationStatus: "verified",
        note: "Rerun mapped provider backfill.",
      }],
      metadata: {
        progressPercent: 0,
        mappingSourceSymbol: mapping.sourceSymbol,
        mappingResolvedSymbol: mapping.resolvedSymbol,
        mappingPreviousVerifiedAt: mapping.verifiedAt,
        effectiveRateCapPerMinute,
        queuedBehindOperationId: activeOperation?.id ?? null,
      },
      actorUserId: sessionUserId,
      startedAt,
    });
    await app.persistence.createProviderOperationLog({
      operationId: operation.id,
      phase: initialPhase,
      level: "info",
      message: `${activeOperation ? "rerun_queued" : "rerun_started"} provider=${providerId} market=${body.marketCode} source_symbol=${sourceSymbol} resolved_symbol=${mapping.resolvedSymbol}`,
      context: { providerId, marketCode: body.marketCode, sourceSymbol, resolvedSymbol: mapping.resolvedSymbol, queuedBehindOperationId: activeOperation?.id ?? null },
    });
    await app.persistence.appendAuditLog({
      actorUserId: sessionUserId,
      action: "provider_fixer_operation",
      ipAddress,
      metadata: {
        operationId: operation.id,
        action: activeOperation ? "rerun_backfill_queued" : "rerun_backfill_started",
        providerId,
        marketCode: body.marketCode,
        sourceSymbol,
        resolvedSymbol: mapping.resolvedSymbol,
        queuedBehindOperationId: activeOperation?.id ?? null,
      },
    });
    await app.eventBus.publishEvent(sessionUserId, "provider_operation_phase_changed", {
      operationId: operation.id,
      providerId,
      phase: operation.phase,
    });
    if (!activeOperation) {
      runProviderRerunBackfillOperationInBackground(app, operation, {
        actorUserId: sessionUserId,
        ipAddress,
        guardrails,
      });
    }
    reply.code(202);
    return { operation: providerFixerOperationToDto(operation, guardrails), result: { status: activeOperation ? "queued" : "started" } };
  });

  app.get("/providers/:providerId/activity", async (req): Promise<ProviderActivityResponse> => {
    requireAdminRole(req);
    const { providerId } = providerConsoleParamsSchema.parse(req.params);
    const query = z
      .object({
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(200).default(25),
      })
      .parse(req.query ?? {});
    const fetchLimit = Math.max(query.limit, 50);
    const [incidents, operations, unresolved, mappings] = await Promise.all([
      app.persistence.listProviderIncidents({ providerId, page: 1, limit: fetchLimit }),
      app.persistence.listProviderOperations({ providerId, page: 1, limit: fetchLimit }),
      app.persistence.listProviderUnresolvedItems({ providerId, page: 1, limit: fetchLimit }),
      app.persistence.listProviderResolutionMappings({ providerId, page: 1, limit: fetchLimit }),
    ]);
    const operationLogs = (
      await Promise.all(
        operations.items.map((operation) =>
          app.persistence.listProviderOperationLogs({ operationId: operation.id, page: 1, limit: 10 }),
        ),
      )
    ).flatMap((result) => result.items);
    const items: ProviderActivityItemDto[] = [
      ...incidents.items.map((incident): ProviderActivityItemDto => ({
        id: `incident:${incident.id}`,
        providerId: incident.providerId,
        kind: "incident",
        occurredAt: incident.updatedAt,
        title: `Incident ${incident.status}`,
        detail: incident.title,
        refId: incident.id,
      })),
      ...operations.items.map((operation): ProviderActivityItemDto => ({
        id: `operation:${operation.id}`,
        providerId: operation.providerId,
        kind: "operation",
        occurredAt: operation.updatedAt,
        title: `Operation ${operation.phase}`,
        detail: operation.operationType,
        refId: operation.id,
      })),
      ...operationLogs.map((log): ProviderActivityItemDto => ({
        id: `log:${log.id}`,
        providerId,
        kind: "log",
        occurredAt: log.createdAt,
        title: `Log ${log.phase}`,
        detail: log.message,
        refId: log.operationId,
      })),
      ...unresolved.items.map((item): ProviderActivityItemDto => ({
        id: `unresolved:${item.providerId}:${item.marketCode}:${item.errorCode}:${item.sourceSymbol}`,
        providerId: item.providerId,
        kind: "unresolved",
        occurredAt: item.updatedAt,
        title: `Unresolved ${item.state}`,
        detail: `${item.sourceSymbol} ${item.errorCode}`,
        refId: item.lastErrorTrailId == null ? null : String(item.lastErrorTrailId),
      })),
      ...mappings.items.map((mapping): ProviderActivityItemDto => ({
        id: `mapping:${mapping.providerId}:${mapping.marketCode}:${mapping.sourceSymbol}`,
        providerId: mapping.providerId,
        kind: "mapping",
        occurredAt: mapping.updatedAt,
        title: "Mapping verified",
        detail: `${mapping.sourceSymbol} -> ${mapping.resolvedSymbol}`,
        refId: mapping.sourceSymbol,
      })),
    ].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
    const offset = (query.page - 1) * query.limit;
    return {
      items: items.slice(offset, offset + query.limit),
      total: items.length,
      page: query.page,
      limit: query.limit,
    };
  });

  app.post("/providers/:providerId/operations/preview", (req, reply) => {
    const { providerId } = providerConsoleParamsSchema.parse(req.params);
    return createProviderOperationPreview(req, reply, providerId);
  });

  async function executeProviderFixerOperation(
    req: FastifyRequest,
    operationId: string,
    body: z.infer<typeof providerFixerOperationBodySchema>,
    providerIdOverride?: string,
    options: { background?: boolean } = {},
  ) {
    requireAdminRole(req);
    const { sessionUserId, ipAddress } = resolveAdminContext(req, app);
    const existing = await app.persistence.getProviderOperation(operationId);
    if (!existing) throw routeError(404, "provider_operation_not_found", "Provider operation not found");
    if (providerIdOverride && existing.providerId !== providerIdOverride) {
      throw routeError(404, "provider_operation_not_found", "Provider operation not found for this provider");
    }
    const guardrails = providerFixerGuardrailsFromConfig(await loadAppConfigDto(app));
    const operationDto = providerFixerOperationToDto(existing, guardrails);
    if (existing.phase !== "preview" && existing.phase !== "staged") {
      throw routeError(400, "provider_operation_not_executable", "Selected operation cannot be executed");
    }
    assertProviderFixerPreviewToken(existing, body.previewToken);
    if (body.acknowledged !== true) {
      throw routeError(400, "provider_fixer_acknowledgement_required", "Execution requires explicit acknowledgement");
    }
    if (operationDto.dangerous && body.typedConfirmation !== operationDto.preview.confirmationText) {
      throw routeError(400, "provider_fixer_typed_confirmation_required", "Dangerous operation requires matching typed confirmation");
    }
    const currentScope = await buildProviderFixerScopeSnapshot(
      app,
      existing.providerId,
      existing.marketCode,
      existing.errorCode ?? "symbol_unresolved",
    );
    if (currentScope.matchCount !== (existing.matchCount ?? 0) || currentScope.snapshotHash !== existing.snapshotHash) {
      throw routeError(409, "snapshot_changed", "Provider fixer scope changed; run preview again");
    }
    const activeOperation = await findOtherActiveProviderOperationExecution(app, {
      providerId: existing.providerId,
      marketCode: existing.marketCode,
      operationId: existing.id,
    });
    const initialPhase: ProviderOperationPhase = activeOperation ? "queued" : "running";

    const running = await app.persistence.updateProviderOperation({
      id: existing.id,
      phase: initialPhase,
      actorUserId: sessionUserId,
      startedAt: activeOperation ? null : new Date().toISOString(),
      metadata: {
        ...(asRecord(existing.metadata) ?? {}),
        progressPercent: 0,
        queuedBehindOperationId: activeOperation?.id ?? null,
      },
    });
    await app.persistence.createProviderOperationLog({
      operationId: running.id,
      phase: initialPhase,
      level: "info",
      message: `${activeOperation ? "execute_queued" : "execute_started"} provider=${running.providerId} market=${running.marketCode} matched=${running.matchCount ?? 0}`,
      context: {
        providerId: running.providerId,
        marketCode: running.marketCode,
        errorCode: running.errorCode,
        queuedBehindOperationId: activeOperation?.id ?? null,
      },
    });
    await app.eventBus.publishEvent(sessionUserId, "provider_operation_phase_changed", {
      operationId: running.id,
      providerId: running.providerId,
      phase: running.phase,
    });

    if (options.background) {
      if (!activeOperation) {
        runProviderFixerOperationInBackground(app, running, {
          actorUserId: sessionUserId,
          ipAddress,
          guardrails,
          dangerous: operationDto.dangerous,
        });
      }
      return {
        operation: providerFixerOperationToDto(running, guardrails),
        result: {
          status: activeOperation ? "queued" : "started",
          applied: 0,
          skipped: 0,
          scanned: 0,
          mappedTickers: [],
          backfills: { enqueued: 0, skippedExisting: 0 },
        },
      };
    }

    if (activeOperation) {
      return {
        operation: providerFixerOperationToDto(running, guardrails),
        result: {
          status: "queued",
          applied: 0,
          skipped: 0,
          scanned: 0,
          mappedTickers: [],
          backfills: { enqueued: 0, skippedExisting: 0 },
        },
      };
    }

    return completeProviderFixerOperation(app, running, {
      actorUserId: sessionUserId,
      ipAddress,
      guardrails,
      dangerous: operationDto.dangerous,
      throwOnFailure: true,
    });
  }

  app.post("/providers/:providerId/operations/:operationId/execute", async (req, reply) => {
    const params = providerConsoleOperationParamsSchema.parse(req.params);
    const body = providerFixerOperationBodySchema.partial({ operationId: true }).parse(req.body ?? {});
    const response = await executeProviderFixerOperation(
      req,
      params.operationId,
      { ...body, operationId: params.operationId },
      params.providerId,
      { background: true },
    );
    reply.code(202);
    return response;
  });

  for (const [action, from, to] of [
    ["pause", "running", "paused"],
    ["resume", "paused", "running"],
    ["cancel", null, "cancelled"],
  ] as const) {
    app.post(`/providers/:providerId/operations/:operationId/${action}`, async (req) => {
      requireAdminRole(req);
      const { sessionUserId, ipAddress } = resolveAdminContext(req, app);
      const { providerId, operationId } = providerConsoleOperationParamsSchema.parse(req.params);
      const existing = await app.persistence.getProviderOperation(operationId);
      if (!existing || existing.providerId !== providerId) {
        throw routeError(404, "provider_operation_not_found", "Provider operation not found for this provider");
      }
      if (from && existing.phase !== from) {
        throw routeError(400, `provider_operation_not_${action}able`, `Selected operation cannot be ${action}d`);
      }
      if (action === "cancel" && !["preview", "staged", "queued", "running", "paused"].includes(existing.phase)) {
        throw routeError(400, "provider_operation_not_cancellable", "Selected operation cannot be cancelled");
      }
      if (
        action === "resume" &&
        existing.operationType !== "renew_evidence" &&
        existing.operationType !== "rerun_backfill" &&
        existing.operationType !== "reverify_mapping" &&
        existing.operationType !== "revert_mapping" &&
        existing.operationType !== "resolver_repair" &&
        existing.operationType !== "repair_mapping"
      ) {
        throw routeError(400, "provider_operation_resume_not_supported", "Resume is not supported for this provider operation type");
      }
      if (action === "resume") {
        await assertNoOtherProviderOperationExecution(app, {
          providerId: existing.providerId,
          marketCode: existing.marketCode,
          operationId: existing.id,
        });
      }
      const updated = await app.persistence.updateProviderOperation({
        id: operationId,
        phase: to,
        ...(action === "cancel" ? { cancelledAt: new Date().toISOString() } : {}),
      });
      await app.persistence.createProviderOperationLog({
        operationId,
        phase: to,
        level: action === "resume" ? "info" : "warning",
        message: `${action}d provider=${updated.providerId} market=${updated.marketCode}`,
        context: { providerId: updated.providerId, marketCode: updated.marketCode },
      });
      await app.persistence.appendAuditLog({
        actorUserId: sessionUserId,
        action: "provider_fixer_operation",
        ipAddress,
        metadata: { operationId, action, providerId: updated.providerId, marketCode: updated.marketCode },
      });
      const guardrails = providerFixerGuardrailsFromConfig(await loadAppConfigDto(app));
      const operationDto = providerFixerOperationToDto(updated, guardrails);
      await app.eventBus.publishEvent(sessionUserId, "provider_operation_phase_changed", {
        operationId,
        providerId: updated.providerId,
        phase: updated.phase,
      });
      if (action === "cancel") {
        await maybeStartNextQueuedProviderOperation(app, updated.providerId, updated.marketCode, {
          actorUserId: sessionUserId,
          ipAddress,
          guardrails,
        });
      }
      if (action === "resume") {
        if (updated.operationType === "renew_evidence") {
          runProviderRenewEvidenceOperationInBackground(app, updated, {
            actorUserId: sessionUserId,
            ipAddress,
            guardrails,
          });
        } else if (updated.operationType === "rerun_backfill") {
          runProviderRerunBackfillOperationInBackground(app, updated, {
            actorUserId: sessionUserId,
            ipAddress,
            guardrails,
          });
        } else if (updated.operationType === "reverify_mapping") {
          runProviderMappingReverifyOperationInBackground(app, updated, {
            actorUserId: sessionUserId,
            ipAddress,
            guardrails,
          });
        } else if (updated.operationType === "revert_mapping") {
          runProviderMappingRevertOperationInBackground(app, updated, {
            actorUserId: sessionUserId,
            ipAddress,
            guardrails,
          });
        } else if (updated.operationType === "resolver_repair" || updated.operationType === "repair_mapping") {
          runProviderFixerOperationInBackground(app, updated, {
            actorUserId: sessionUserId,
            ipAddress,
            guardrails,
            dangerous: operationDto.dangerous,
          });
        }
      }
      return { operation: operationDto };
    });
  }

  app.post("/providers/:providerId/operations/:operationId/retry", async (req, reply) => {
    requireAdminRole(req);
    const { sessionUserId, ipAddress } = resolveAdminContext(req, app);
    const { providerId, operationId } = providerConsoleOperationParamsSchema.parse(req.params);
    const existing = await app.persistence.getProviderOperation(operationId);
    if (!existing || existing.providerId !== providerId) {
      throw routeError(404, "provider_operation_not_found", "Provider operation not found for this provider");
    }
    if (!["paused", "failed", "cancelled", "completed"].includes(existing.phase)) {
      throw routeError(400, "provider_operation_not_retryable", "Selected operation cannot be retried yet");
    }
    const config = await loadAppConfigDto(app);
    const guardrails = providerFixerGuardrailsFromConfig(config);
    const effectiveRateCapPerMinute = providerOperationRateCapPerMinute(existing.providerId, config);
    const matchCount = existing.matchCount ?? 0;
    const dangerous = matchCount >= guardrails.dangerousMatchThreshold;
    const token = newProviderFixerToken();
    const retryAttempt = (numberField(asRecord(existing.metadata)?.retryAttempt) ?? 0) + 1;
    const operation = await app.persistence.createProviderOperation({
      providerId: existing.providerId,
      marketCode: existing.marketCode,
      operationType: existing.operationType,
      phase: "preview",
      errorCode: existing.errorCode,
      resolverMode: existing.resolverMode,
      scopeQuery: existing.scopeQuery,
      snapshotHash: hashProviderFixerToken(`${existing.id}:retry:${retryAttempt}:${Date.now()}`).slice(0, 12),
      previewTokenHash: hashProviderFixerToken(token),
      previewExpiresAt: new Date(Date.now() + guardrails.previewTokenTtlSeconds * 1000).toISOString(),
      matchCount,
      sample: existing.sample,
      metadata: {
        previewTokenDisplay: token,
        confirmationText: dangerous ? `EXECUTE ${matchCount}` : null,
        retryOfOperationId: existing.id,
        retryAttempt,
        effectiveRateCapPerMinute,
        autoPauseFailureThresholdPerMinute: guardrails.autoPauseFailureThresholdPerMinute,
      },
      actorUserId: sessionUserId,
    });
    await app.persistence.createProviderOperationLog({
      operationId: operation.id,
      phase: "preview",
      level: "info",
      message: `retry_created provider=${operation.providerId} market=${operation.marketCode} retry_of=${existing.id}`,
      context: {
        providerId: operation.providerId,
        marketCode: operation.marketCode,
        retryOfOperationId: existing.id,
        retryAttempt,
      },
    });
    await app.persistence.appendAuditLog({
      actorUserId: sessionUserId,
      action: "provider_fixer_operation",
      ipAddress,
      metadata: {
        operationId: operation.id,
        action: "retry",
        providerId: operation.providerId,
        marketCode: operation.marketCode,
        retryOfOperationId: existing.id,
        retryAttempt,
      },
    });
    await app.eventBus.publishEvent(sessionUserId, "provider_operation_phase_changed", {
      operationId: operation.id,
      providerId: operation.providerId,
      phase: operation.phase,
      retryOfOperationId: existing.id,
    });
    reply.code(201);
    return { operation: providerFixerOperationToDto(operation, guardrails), retryOfOperationId: existing.id };
  });

  async function listProviderOperations(
    req: FastifyRequest,
    providerIdOverride?: string,
  ): Promise<ProviderFixerDashboardOperationsResponse> {
    requireAdminRole(req);
    const query = z
      .object({
        providerId: providerFixerProviderSchema.optional(),
        marketCode: providerFixerMarketCodeSchema.optional(),
        phase: providerFixerPhaseSchema.optional(),
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(200).default(25),
      })
      .parse(req.query ?? {});
    const providerId = providerIdOverride ?? query.providerId;
    const { sessionUserId, ipAddress } = resolveAdminContext(req, app);
    const config = await loadAppConfigDto(app);
    await pauseStaleProviderOperations(app, config.effectiveProviderOperationStaleHeartbeatMinutes, { actorUserId: sessionUserId, ipAddress });
    const result = await app.persistence.listProviderOperations({
      providerId,
      marketCode: query.marketCode,
      phases: query.phase ? [query.phase as ProviderOperationPhase] : undefined,
      page: query.page,
      limit: query.limit,
    });
    const guardrails = providerFixerGuardrailsFromConfig(config);
    const operations = result.items.map((operation) => providerFixerOperationToDto(operation, guardrails));
    return {
      stagedOperation:
        operations.find((operation) => operation.phase === "preview" || operation.phase === "staged") ?? null,
      operations,
      total: result.total,
      page: result.page,
      limit: result.limit,
    };
  }

  app.get("/providers/:providerId/operations", (req) => {
    const { providerId } = providerConsoleParamsSchema.parse(req.params);
    return listProviderOperations(req, providerId);
  });

  app.get("/providers/:providerId/operations/:operationId/outcomes", async (req): Promise<ProviderOperationOutcomesResponse> => {
    requireAdminRole(req);
    const { providerId, operationId } = providerConsoleOperationParamsSchema.parse(req.params);
    const operation = await app.persistence.getProviderOperation(operationId);
    if (!operation || operation.providerId !== providerId) {
      throw routeError(404, "provider_operation_not_found", "Provider operation not found for this provider");
    }
    const query = z
      .object({
        state: z.enum(["pending", "running", "succeeded", "failed", "skipped", "rate_limited", "cancelled"]).optional(),
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(200).default(25),
      })
      .parse(req.query ?? {});
    const result = await app.persistence.listProviderOperationOutcomes({
      operationId,
      state: query.state,
      page: query.page,
      limit: query.limit,
    });
    return {
      items: result.items.map(providerOperationOutcomeToDto),
      summary: result.summary,
      total: result.total,
      page: result.page,
      limit: result.limit,
    };
  });

  async function listProviderLogs(
    req: FastifyRequest,
    providerIdOverride?: string,
  ): Promise<ProviderFixerDashboardLogsResponse> {
    requireAdminRole(req);
    const query = z
      .object({
        providerId: providerFixerProviderSchema.optional(),
        marketCode: providerFixerMarketCodeSchema.optional(),
        operationId: z.string().trim().min(1).max(120).optional(),
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(200).default(25),
      })
      .parse(req.query ?? {});
    const providerId = providerIdOverride ?? query.providerId;
    const operationIds = query.operationId
      ? [query.operationId]
      : (await app.persistence.listProviderOperations({
          providerId,
          marketCode: query.marketCode,
          page: 1,
          limit: Math.max(query.limit, 25),
        })).items.map((operation) => operation.id);
    const entries = (
      await Promise.all(operationIds.map(async (operationId) => {
        const logs = await app.persistence.listProviderOperationLogs({ operationId, page: 1, limit: query.limit });
        return logs.items.map((log): ProviderFixerDashboardLogEntryDto => ({
          id: String(log.id),
          occurredAt: log.createdAt,
          phase: log.phase,
          message: log.message,
          operationId: log.operationId,
        }));
      }))
    ).flat().sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
    const offset = (query.page - 1) * query.limit;
    return {
      items: entries.slice(offset, offset + query.limit),
      total: entries.length,
      page: query.page,
      limit: query.limit,
    };
  }

  app.get("/providers/:providerId/logs", (req) => {
    const { providerId } = providerConsoleParamsSchema.parse(req.params);
    return listProviderLogs(req, providerId);
  });

  app.post("/providers/:providerId/logs/purge/preview", async (req, reply): Promise<ProviderLogPurgePreviewResponse> => {
    requireAdminRole(req);
    const { sessionUserId, ipAddress } = resolveAdminContext(req, app);
    const { providerId } = providerConsoleParamsSchema.parse(req.params);
    const config = await loadAppConfigDto(app);
    const guardrails = providerFixerGuardrailsFromConfig(config);
    const counts = await app.persistence.countProviderLogsForPurge(providerId);
    const matchCount = counts.errorTrailCount + counts.operationLogCount;
    const token = newProviderFixerToken();
    const now = new Date();
    const tokenExpiresAt = new Date(now.getTime() + guardrails.previewTokenTtlSeconds * 1000).toISOString();
    const confirmationText = `PURGE ${providerId}`;
    const operation = await app.persistence.createProviderOperation({
      providerId,
      marketCode: providerFixerMarketCode(providerId),
      operationType: "purge_logs",
      phase: "preview",
      errorCode: "provider_logs_purge",
      scopeQuery: `${providerId}:logs:purge`,
      snapshotHash: hashProviderFixerToken(`${providerId}:logs:${matchCount}:${now.toISOString()}`).slice(0, 12),
      previewTokenHash: hashProviderFixerToken(token),
      previewExpiresAt: tokenExpiresAt,
      matchCount,
      sample: [],
      metadata: {
        errorTrailCount: counts.errorTrailCount,
        operationLogCount: counts.operationLogCount,
        confirmationText,
        destructiveBoundary: "Deletes provider_error_trail rows and provider_operation_logs only.",
      },
      actorUserId: sessionUserId,
    });
    await app.persistence.appendAuditLog({
      actorUserId: sessionUserId,
      action: "provider_fixer_operation",
      metadata: {
        operationId: operation.id,
        action: "purge_logs_preview",
        providerId,
        matchCount,
        errorTrailCount: counts.errorTrailCount,
        operationLogCount: counts.operationLogCount,
      },
      ipAddress,
    });
    reply.code(201);
    return {
      preview: {
        operationId: operation.id,
        providerId,
        previewToken: token,
        tokenExpiresAt,
        confirmationText,
        errorTrailCount: counts.errorTrailCount,
        operationLogCount: counts.operationLogCount,
        matchCount,
        canExecute: matchCount > 0,
        boundary: "Deletes provider_error_trail rows and provider_operation_logs only. Incidents, unresolved items, mappings, operation summaries, audit logs, and pg-boss history are retained.",
      },
    };
  });

  app.post("/providers/:providerId/logs/purge/execute", async (req): Promise<ProviderLogPurgeExecuteResponse> => {
    requireAdminRole(req);
    const { sessionUserId, ipAddress } = resolveAdminContext(req, app);
    const { providerId } = providerConsoleParamsSchema.parse(req.params);
    const body = z
      .object({
        operationId: z.string().trim().min(1).max(120),
        previewToken: z.string().trim().min(1).max(160),
        typedConfirmation: z.string().trim().max(160),
      })
      .strict()
      .parse(req.body ?? {});
    const operation = await app.persistence.getProviderOperation(body.operationId);
    if (!operation || operation.providerId !== providerId || operation.operationType !== "purge_logs") {
      throw routeError(404, "provider_purge_operation_not_found", "Provider purge operation not found");
    }
    if (operation.phase !== "preview" && operation.phase !== "staged") {
      throw routeError(400, "provider_purge_operation_not_executable", "Provider purge operation cannot be executed");
    }
    assertProviderFixerPreviewToken(operation, body.previewToken);
    const expectedConfirmation = `PURGE ${providerId}`;
    if (body.typedConfirmation !== expectedConfirmation) {
      throw routeError(400, "provider_purge_typed_confirmation_required", "Provider log purge requires matching typed confirmation");
    }
    const counts = await app.persistence.countProviderLogsForPurge(providerId);
    const currentMatchCount = counts.errorTrailCount + counts.operationLogCount;
    if (currentMatchCount !== (operation.matchCount ?? 0)) {
      throw routeError(409, "snapshot_changed", "Provider log purge scope changed; run purge preview again");
    }
    const running = await app.persistence.updateProviderOperation({
      id: operation.id,
      phase: "running",
      startedAt: new Date().toISOString(),
      metadata: {
        ...(asRecord(operation.metadata) ?? {}),
        progressPercent: 0,
      },
    });
    await app.eventBus.publishEvent(sessionUserId, "provider_operation_phase_changed", {
      providerId,
      operationId: running.id,
      phase: running.phase,
    });
    const deleted = await app.persistence.purgeProviderLogs(providerId);
    await app.persistence.upsertProviderOperationOutcome({
      operationId: running.id,
      providerId,
      marketCode: running.marketCode,
      sourceSymbol: "provider_logs",
      providerSymbol: providerId,
      action: "purge_logs",
      state: "succeeded",
      message: `Purged ${deleted.errorTrailCount} provider error rows and ${deleted.operationLogCount} operation log rows.`,
      evidence: {
        errorTrailDeleted: deleted.errorTrailCount,
        operationLogDeleted: deleted.operationLogCount,
        boundary: "provider_error_trail and provider_operation_logs only",
      },
    });
    const completed = await app.persistence.updateProviderOperation({
      id: running.id,
      phase: "completed",
      completedAt: new Date().toISOString(),
      metadata: {
        ...(asRecord(running.metadata) ?? {}),
        progressPercent: 100,
        errorTrailDeleted: deleted.errorTrailCount,
        operationLogDeleted: deleted.operationLogCount,
      },
    });
    await app.persistence.createProviderOperationLog({
      operationId: completed.id,
      phase: completed.phase,
      level: "warning",
      message: `purge_logs_completed provider=${providerId} error_trail_deleted=${deleted.errorTrailCount} operation_logs_deleted=${deleted.operationLogCount}`,
      context: {
        providerId,
        errorTrailDeleted: deleted.errorTrailCount,
        operationLogDeleted: deleted.operationLogCount,
        boundary: "provider_error_trail and provider_operation_logs only",
      },
    });
    await app.persistence.appendAuditLog({
      actorUserId: sessionUserId,
      action: "provider_fixer_operation",
      metadata: {
        operationId: completed.id,
        action: "purge_logs_execute",
        providerId,
        errorTrailDeleted: deleted.errorTrailCount,
        operationLogDeleted: deleted.operationLogCount,
      },
      ipAddress,
    });
    await app.eventBus.publishEvent(sessionUserId, "provider_operation_phase_changed", {
      providerId,
      operationId: completed.id,
      phase: completed.phase,
    });
    await app.eventBus.publishEvent(sessionUserId, "provider_operation_progress", {
      operationId: completed.id,
      providerId,
      processed: 1,
      total: 1,
      progressPercent: 100,
    });
    return {
      operationId: completed.id,
      providerId,
      errorTrailDeleted: deleted.errorTrailCount,
      operationLogDeleted: deleted.operationLogCount,
    };
  });
}

export const adminRoutes: FastifyPluginAsync = async (app) => {
  registerProviderFixerAdminRoutes(app);

  app.get("/users", async (req) => {
    const query = req.query as Record<string, string | undefined>;
    const page = Math.max(1, parseInt(query.page ?? "1", 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(query.limit ?? "50", 10) || 50));
    return app.persistence.listUsers({
      page,
      limit,
      search: query.search,
      role: query.role ? userRoleSchema.parse(query.role) : undefined,
      status: z.enum(["active", "disabled", "deleted"]).optional().parse(query.status || undefined),
    });
  });

  app.patch("/users/:id/role", async (req) => {
    const { sessionUserId, ipAddress } = resolveAdminContext(req, app);
    const { id } = z.object({ id: userScopedIdSchema }).parse(req.params);
    const body = z.object({ role: userRoleSchema }).parse(req.body);

    assertNotSelf(sessionUserId, id);

    const target = await app.persistence.getAuthUserById(id);
    if (!target) throw routeError(404, "user_not_found", "User not found");

    // Last-admin guard is enforced atomically inside changeUserRole transaction

    const result = await app.persistence.changeUserRole(id, body.role, {
      actorUserId: sessionUserId,
      ipAddress,
    });

    // Force logout when removing admin role
    if (target.role === "admin" && body.role !== "admin") {
      await app.persistence.appendAuditLog({
        actorUserId: sessionUserId,
        action: "session_force_logout",
        targetUserId: id,
        ipAddress,
        metadata: { targetEmail: target.email, reason: "admin_role_change" },
      });
    }

    return result;
  });

  app.post("/users/:id/disable", async (req) => {
    const { sessionUserId, ipAddress } = resolveAdminContext(req, app);
    const { id } = z.object({ id: userScopedIdSchema }).parse(req.params);

    assertNotSelf(sessionUserId, id);

    const target = await app.persistence.getAuthUserById(id);
    if (!target) throw routeError(404, "user_not_found", "User not found");

    // Last-admin guard is enforced atomically inside disableUser transaction
    await app.persistence.disableUser(id, {
      actorUserId: sessionUserId,
      ipAddress,
    });
    return { status: "ok" };
  });

  app.post("/users/:id/enable", async (req) => {
    const { sessionUserId, ipAddress } = resolveAdminContext(req, app);
    const { id } = z.object({ id: userScopedIdSchema }).parse(req.params);

    assertNotSelf(sessionUserId, id);

    const target = await app.persistence.getAuthUserById(id);
    if (!target) throw routeError(404, "user_not_found", "User not found");

    await app.persistence.enableUser(id, {
      actorUserId: sessionUserId,
      ipAddress,
    });
    return { status: "ok" };
  });

  app.delete("/users/:id", async (req) => {
    const { sessionUserId, ipAddress } = resolveAdminContext(req, app);
    const { id } = z.object({ id: userScopedIdSchema }).parse(req.params);

    assertNotSelf(sessionUserId, id);

    const target = await app.persistence.getAuthUserById(id);
    if (!target) throw routeError(404, "user_not_found", "User not found");

    // Last-admin guard is enforced atomically inside softDeleteUser transaction
    await app.persistence.softDeleteUser(id, {
      actorUserId: sessionUserId,
      ipAddress,
    });
    return { status: "ok" };
  });

  app.delete("/users/:id/purge", async (req, reply) => {
    const { sessionUserId, ipAddress, email: adminEmail } = resolveAdminContext(req, app);
    const { id } = z.object({ id: userScopedIdSchema }).parse(req.params);
    const body = z.object({
      confirmation: z.string(),
      adminEmail: z.string().email(),
    }).parse(req.body);

    assertNotSelf(sessionUserId, id);

    const target = await app.persistence.getAuthUserById(id);
    if (!target) throw routeError(404, "user_not_found", "User not found");
    if (!target.email) {
      throw routeError(400, "no_email_for_purge", "Cannot purge a user with no email address");
    }

    // Validate confirmation strings
    const expectedConfirmation = `PURGE ${target.email}`;
    if (body.confirmation !== expectedConfirmation) {
      throw routeError(400, "invalid_confirmation", `Confirmation must be "${expectedConfirmation}"`);
    }
    if (body.adminEmail.toLowerCase() !== (adminEmail ?? "").toLowerCase()) {
      throw routeError(400, "invalid_admin_email", "Admin email does not match");
    }

    // Last-admin guard is enforced atomically inside hardPurgeUser transaction

    // Check for active jobs
    const hasJobs = await app.persistence.hasActiveJobs(id);
    if (hasJobs) {
      throw routeError(409, "active_jobs_blocked", "User has active background jobs — wait for completion before purging");
    }

    await app.persistence.hardPurgeUser(id, {
      actorUserId: sessionUserId,
      ipAddress,
    });
    reply.code(204);
    return null;
  });

  app.post("/users/:id/impersonate", async (req, reply) => {
    requireAdminRole(req);
    const { sessionUserId, ipAddress } = resolveAdminContext(req, app);
    const { id: targetUserId } = z.object({ id: userScopedIdSchema }).parse(req.params);

    if (req.authContext?.isDemo) {
      throw routeError(403, "demo_cannot_impersonate", "Demo sessions cannot impersonate users");
    }
    if (targetUserId === sessionUserId) {
      throw routeError(400, "cannot_impersonate_self", "Cannot impersonate yourself");
    }

    const targetUser = await app.persistence.getAuthUserById(targetUserId);
    if (!targetUser || targetUser.deactivatedAt || targetUser.deletedAt) {
      throw routeError(404, "user_not_found", "User not found");
    }

    if (req.authContext?.isImpersonating && req.authContext.impersonation) {
      await app.persistence.appendAuditLog({
        actorUserId: sessionUserId,
        action: "impersonation_end",
        targetUserId: req.authContext.impersonation.targetUserId,
        ipAddress,
        metadata: {
          reason: "replaced",
          targetUserId: req.authContext.impersonation.targetUserId,
          targetEmail: req.authContext.impersonation.targetEmail,
        },
      });
    }

    const sessionSecret = app.oauthConfig?.sessionSecret ?? Env.SESSION_SECRET ?? "";
    if (!sessionSecret) {
      throw routeError(500, "missing_secret", "SESSION_SECRET is required for impersonation cookie signing");
    }

    const ttlMinutes = Env.ADMIN_IMPERSONATION_TTL_MINUTES;
    const expiresAtMs = Date.now() + ttlMinutes * 60_000;
    const expiresAt = new Date(expiresAtMs).toISOString();
    const cookieValue = signImpersonationCookie(sessionUserId, targetUserId, expiresAtMs, sessionSecret);

    req.__clearImpersonationCookie = false;
    reply.header("set-cookie", impersonationSetCookieString(cookieValue, ttlMinutes));

    await app.persistence.appendAuditLog({
      actorUserId: sessionUserId,
      action: "impersonation_start",
      targetUserId,
      ipAddress,
      metadata: {
        targetUserId,
        targetEmail: targetUser.email ?? null,
        expiresAt,
      },
    });

    return {
      expiresAt,
      targetEmail: targetUser.email ?? null,
    };
  });

  app.delete("/impersonation", async (req, reply) => {
    requireAdminRole(req);
    const { sessionUserId, ipAddress } = resolveAdminContext(req, app);
    if (req.authContext?.isImpersonating && req.authContext.impersonation) {
      await app.persistence.appendAuditLog({
        actorUserId: sessionUserId,
        action: "impersonation_end",
        targetUserId: req.authContext.impersonation.targetUserId,
        ipAddress,
        metadata: {
          reason: "manual",
          targetUserId: req.authContext.impersonation.targetUserId,
          targetEmail: req.authContext.impersonation.targetEmail,
        },
      });
    }

    req.__clearImpersonationCookie = false;
    reply.header("set-cookie", impersonationClearCookieString());
    reply.code(204);
    return null;
  });

  app.get("/invites", async (req) => {
    const query = req.query as Record<string, string | undefined>;
    const page = Math.max(1, parseInt(query.page ?? "1", 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(query.limit ?? "50", 10) || 50));
    return app.persistence.listInvites({
      page,
      limit,
      status: z.enum(["pending", "used", "expired", "revoked"]).optional().parse(query.status || undefined),
      email: query.email,
    });
  });

  app.get("/audit-log", async (req) => {
    const query = req.query as Record<string, string | undefined>;
    const page = Math.max(1, parseInt(query.page ?? "1", 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(query.limit ?? "50", 10) || 50));
    return app.persistence.listAuditLog({
      page,
      limit,
      actorUserId: query.actorUserId,
      targetUserId: query.targetUserId,
      actions: query.action ? query.action.split(",").map((a) => a.trim()).filter(Boolean) : undefined,
      fromDate: query.fromDate,
      toDate: query.toDate,
    });
  });

  // ── Admin settings (KZO-142) ───────────────────────────────────────────────

  app.get("/settings", async (req): Promise<AppConfigDto> => {
    requireAdminRole(req);
    return loadAppConfigDto(app);
  });

  app.patch("/settings", async (req): Promise<AppConfigDto> => {
    requireAdminRole(req);
    const { sessionUserId, ipAddress } = resolveAdminContext(req, app);
    const body = patchAdminSettingsSchema.parse(req.body);
    assertProviderRateBudgetOverrides(body);

    const current = await app.persistence.getAppConfig();
    assertProviderHealthThresholdOverrides(body, current);

    // KZO-159 (158A): diff each tracked field independently — a PATCH may
    // carry one, the other, both, or neither. `undefined` means "no change",
    // `null` means "clear override", array means "set override".
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};

    if (
      body.repairCooldownMinutes !== undefined
      && body.repairCooldownMinutes !== current.repairCooldownMinutes
    ) {
      before.repairCooldownMinutes = current.repairCooldownMinutes;
      after.repairCooldownMinutes = body.repairCooldownMinutes;
      await app.persistence.setRepairCooldownMinutes(body.repairCooldownMinutes);
    }

    if (body.dashboardPerformanceRanges !== undefined) {
      const currentList = current.dashboardPerformanceRanges;
      const nextList = body.dashboardPerformanceRanges;
      // Treat [a,b,c] vs [a,b,c] as equal (same length, same elements).
      const unchanged =
        currentList === nextList
        || (Array.isArray(currentList)
          && Array.isArray(nextList)
          && currentList.length === nextList.length
          && currentList.every((v, i) => v === nextList[i]));
      if (!unchanged) {
        before.dashboardPerformanceRanges = currentList;
        after.dashboardPerformanceRanges = nextList;
        await app.persistence.setDashboardPerformanceRanges(nextList);
      }
    }

    if (
      body.metadataEnrichmentMode !== undefined
      && body.metadataEnrichmentMode !== current.metadataEnrichmentMode
    ) {
      before.metadataEnrichmentMode = current.metadataEnrichmentMode;
      after.metadataEnrichmentMode = body.metadataEnrichmentMode;
      await app.persistence.setMetadataEnrichmentMode(body.metadataEnrichmentMode);
    }

    // KZO-198 — diff Tier 1/2 plain fields. Only changed fields are added to
    // `patch` so a no-op PATCH does not bump `updated_at`.
    const patch: import("../persistence/types.js").AppConfigPatch = {};
    for (const field of TIER1_PLAIN_FIELDS) {
      const next = body[field];
      if (next === undefined) continue;
      const currentVal = current[field] ?? null;
      if (next === currentVal) continue;
      before[field] = currentVal;
      after[field] = next;
      patch[field] = next;
    }

    // KZO-198 — Tier 0 rotations. Plaintext goes onto the patch under the
    // camelCase key; persistence encrypts inline. Audit metadata uses the
    // `rotation` discriminator and NEVER carries the plaintext value. Each
    // rotation gets its own audit row so a partial PATCH cannot co-mingle
    // plaintext-changes with rotations in a single `before/after` diff.
    const rotations: Array<{
      field: "finmindApiToken" | "twelveDataApiKey";
      action: "rotate" | "clear";
    }> = [];
    if (body.finmindApiToken !== undefined) {
      patch.finmindApiToken = body.finmindApiToken;
      rotations.push({
        field: "finmindApiToken",
        action: body.finmindApiToken === null ? "clear" : "rotate",
      });
    }
    if (body.twelveDataApiKey !== undefined) {
      patch.twelveDataApiKey = body.twelveDataApiKey;
      rotations.push({
        field: "twelveDataApiKey",
        action: body.twelveDataApiKey === null ? "clear" : "rotate",
      });
    }

    if (Object.keys(patch).length > 0) {
      await app.persistence.setAppConfigPatch(patch);
    }

    const hasPlaintextDiff = Object.keys(after).length > 0;

    if (!hasPlaintextDiff && rotations.length === 0) {
      return loadAppConfigDto(app);
    }

    if (hasPlaintextDiff) {
      // KZO-198: explicit `value_change` discriminator on the metadata object.
      // Legacy rows (pre-KZO-198) without `type` are read as `value_change` by
      // the UI per design.md §6 — no backfill migration needed.
      await app.persistence.appendAuditLog({
        actorUserId: sessionUserId,
        action: "app_config_updated",
        metadata: { type: "value_change", before, after },
        ipAddress,
      });
    }

    for (const rotation of rotations) {
      // Tier 0 rotation audit — the value is NEVER part of the metadata. The
      // operator audit trail records who rotated which secret and when.
      await app.persistence.appendAuditLog({
        actorUserId: sessionUserId,
        action: "app_config_updated",
        metadata: {
          type: "rotation",
          field: rotation.field,
          action: rotation.action,
          actorUserId: sessionUserId,
        },
        ipAddress,
      });
    }

    // KZO-198 — invalidate the TTL cache so the next read on this instance
    // sees the new value immediately. Cross-instance pub/sub is a KZO-121
    // follow-up; peers see stale values up to TTL.
    invalidateAppConfigCache();
    await refreshAppConfigCache();

    return loadAppConfigDto(app);
  });

  app.get("/mcp/settings", async (req): Promise<AiConnectorPolicySettingsDto> => {
    requireAdminRole(req);
    return app.persistence.getAiConnectorPolicySettings();
  });

  app.post("/mcp/fresh-auth", async (req): Promise<{ freshAuthToken: string }> => {
    requireAdminRole(req);
    return { freshAuthToken: createMcpFreshAuthToken(app, req) };
  });

  app.patch("/mcp/settings", async (req): Promise<AiConnectorPolicySettingsDto> => {
    requireAdminRole(req);
    const { sessionUserId, ipAddress } = resolveAdminContext(req, app);
    const current = await app.persistence.getAiConnectorPolicySettings();
    assertFreshAuth(app, req, current);
    const body = aiConnectorPolicySettingsPatchSchema.parse(req.body);
    if (body.mcpOauthTokenSecret !== undefined) {
      await app.persistence.setAppConfigEncryptedSecret("mcpOauthTokenSecret", body.mcpOauthTokenSecret);
      const secretAction = body.mcpOauthTokenSecret === null ? "clear" : "rotate";
      const revokedConnectionCount = await app.persistence.revokeAiConnectorConnectionsForProvider(
        "chatgpt",
        body.mcpOauthTokenSecret === null ? "mcp_oauth_secret_cleared" : "mcp_oauth_secret_rotated",
        sessionUserId,
      );
      await app.persistence.appendAuditLog({
        actorUserId: sessionUserId,
        action: "app_config_updated",
        metadata: {
          type: "rotation",
          field: "mcpOauthTokenSecret",
          action: secretAction,
          actorUserId: sessionUserId,
          revokedConnectionCount,
        },
        ipAddress,
      });
      invalidateAppConfigCache();
    }
    const policyPatch = Object.fromEntries(
      Object.entries(body).filter(([key]) => key !== "mcpOauthTokenSecret"),
    ) as SaveAiConnectorPolicySettingsInput;
    if (Object.keys(policyPatch).length === 0) {
      return app.persistence.getAiConnectorPolicySettings();
    }
    return updateAiConnectorPolicySettings(app, policyPatch, {
      actorUserId: sessionUserId,
      ipAddress,
    });
  });

  // ── KZO-164: FX rates admin surface ───────────────────────────────────────
  // POST /admin/fx-rates/refresh — manually enqueue an FX refresh job (e.g.
  //   to backfill a missed window after an outage). Only this path emits
  //   `admin_fx_rates_refresh` audit; cron runs do NOT (precedent: catalog-sync).
  //
  //   AUTH: This route is intentionally NOT in `ADMIN_ROUTE_KEYS`
  //   (registerRoutes.ts) so the demo-restricted 403 fires before the
  //   admin-required 403 for non-admin demo callers — see scope-todo §5.1
  //   "Auth: admin-only; demo blocked" + the [auth]: demo_restricted HTTP/AAA
  //   spec assertion. The inline `requireAdminRole(req)` below is therefore the
  //   SOLE admin gate for this route. DO NOT REMOVE without also adding the
  //   route key to `ADMIN_ROUTE_KEYS` and adjusting the demo-precedence test.
  app.post("/fx-rates/refresh", async (req) => {
    if (req.authContext?.isDemo) {
      throw routeError(403, "demo_restricted", "FX refresh is not available for demo users");
    }
    requireAdminRole(req); // sole admin gate — see header comment
    const { sessionUserId, ipAddress } = resolveAdminContext(req, app);

    const body = fxRefreshBodySchema.parse(req.body ?? {});
    const today = today_utc();
    const startDate = body.startDate ?? today;
    const endDate = body.endDate ?? today;
    const bases = body.bases ?? [...STORED_QUOTES];

    if (!app.boss) {
      throw routeError(503, "queue_unavailable", "Job queue is not available");
    }

    const jobId = await app.boss.send(
      FX_REFRESH_QUEUE,
      { trigger: "manual" as const, startDate, endDate, bases },
      { singletonKey: "fx-refresh", priority: 5 },
    );

    await app.persistence.appendAuditLog({
      actorUserId: sessionUserId,
      action: "admin_fx_rates_refresh",
      metadata: { startDate, endDate, bases },
      ipAddress,
    });

    if (jobId === null) {
      // Singleton policy collapsed our send into an existing in-flight job.
      return {
        status: "skipped_existing_job" as const,
        reason: "another fx-refresh job is already enqueued or running (singleton policy)",
      };
    }
    return { status: "queued" as const, jobId };
  });

  // GET /admin/fx-rates/freshness — read-only freshness summary per (base, quote).
  // No audit log (read-only). `ageInDays` is computed against today_utc() so
  // any slow ingestion shows up immediately in the response.
  app.get("/fx-rates/freshness", async (req) => {
    requireAdminRole(req);
    const queriedAt = new Date().toISOString();
    const today = today_utc();
    const todayMs = new Date(`${today}T00:00:00Z`).getTime();
    const rows = await app.persistence.getFxRateFreshness();
    const pairs = rows.map((row) => {
      const latestMs = new Date(`${row.latestDate}T00:00:00Z`).getTime();
      const ageInDays = Math.max(0, Math.round((todayMs - latestMs) / 86_400_000));
      return {
        baseCurrency: row.baseCurrency,
        quoteCurrency: row.quoteCurrency,
        latestDate: row.latestDate,
        ageInDays,
      };
    });
    return { pairs, queriedAt };
  });

  // ── KZO-177: provider health admin surface ────────────────────────────────

  // GET /admin/providers — read-only snapshot of every provider health row
  // with computed counters and the last 10 trail entries each.
  app.get("/providers", async (req): Promise<AdminProvidersResponse> => {
    if (req.authContext?.role !== "admin") {
      throw routeError(403, "admin_required", "Admin role required");
    }
    // KZO-177 (P2 Fix 2): recompute `status` against the current trading
    // calendar for each row. The persisted `row.status` lags reality when the
    // queue stalls — a provider with `last_successful_run < latestSettled`
    // should report `down` even if no error trail rows have landed since.
    const rows = await app.persistence.getAllProviderHealthStatuses();
    const now = new Date();
    const providers: ProviderHealthStatusDto[] = await Promise.all(
      rows.map(async (row) => {
        const market = calendarMarketForProvider(row.providerId as ProviderId);
        const [errorCount24h, errorCount7d, rateLimitCount24h, recentErrors, latestSettled] =
          await Promise.all([
            app.persistence.computeErrorCount24h(row.providerId),
            app.persistence.computeErrorCount7d(row.providerId),
            app.persistence.computeRateLimitCount24h(row.providerId),
            app.persistence.getRecentProviderErrors(row.providerId, 10),
            app.tradingCalendarCache.latestSettledTradingDay(market, now),
          ]);
        const computedStatus = computeStatus({
          lastSuccessfulRun: row.lastSuccessfulRun,
          latestSettledTradingDay: latestSettled,
          errorCount24h,
        });
        // KZO-197 — derive `'awaiting'` purely at the route layer when the
        // provider has neither a successful nor a failed run on record (fresh
        // deploy). Persistence row shape, `provider_health_status` table CHECK,
        // and `recordOutcome` CAS reads remain unchanged — only the DTO gains
        // the 4th state. Any single failed_run record flips the row to
        // `computedStatus`, so there is no "awaiting + degraded" hybrid.
        const status =
          row.lastSuccessfulRun === null && row.lastFailedRun === null
            ? "awaiting"
            : computedStatus;
        const recentErrorDtos: ProviderErrorTrailEntryDto[] = recentErrors.map((e) => ({
          id: e.id,
          occurredAt: e.occurredAt,
          errorClass: e.errorClass,
          errorMessage: e.errorMessage,
        }));
        return {
          providerId: row.providerId,
          status,
          lastSuccessfulRun: row.lastSuccessfulRun,
          lastFailedRun: row.lastFailedRun,
          errorCount24h,
          errorCount7d,
          rateLimitCount24h,
          lastErrorMessage: row.lastErrorMessage,
          lastManualRerunAt: row.lastManualRerunAt,
          // KZO-197 — server-resolved per-provider rerun cooldown (ms).
          // Frontend uses this to render the live tooltip-cooldown label
          // and the 429 countdown fallback.
          rerunCooldownMs: getEffectiveProviderRerunCooldownMs(row.providerId),
          updatedAt: row.updatedAt,
          recentErrors: recentErrorDtos,
        };
      }),
    );
    return {
      providers,
      capabilities: listProviderOperationCapabilities(providers.map((provider) => provider.providerId)),
    };
  });

  // POST /admin/providers/:providerId/rerun — admin "Re-run now" button.
  // 60s per-provider cooldown via `last_manual_rerun_at`. Returns `429
  // rate_limit_exceeded` with `Retry-After` header if clicked within cooldown.
  app.post("/providers/:providerId/rerun", async (req, reply) => {
    // (1) admin guard — 403 fires before any other branch so unauthenticated
    // callers can't probe path-param shape or queue availability.
    if (req.authContext?.role !== "admin") {
      throw routeError(403, "admin_required", "Admin role required");
    }
    const { sessionUserId, ipAddress } = resolveAdminContext(req, app);

    // (2) provider exists 404 — path param parsed as a free string so an
    // unknown id lands as 404 (not Zod 400). The provider's existence in
    // `provider_health_status` is the authoritative gate.
    const params = z.object({ providerId: z.string() }).parse(req.params);
    const providerId = params.providerId as
      | "finmind-tw"
      | "finmind-us"
      | "yahoo-finance-au"
      | "twelve-data-au"
      | "yahoo-finance-kr"
      | "twelve-data-kr"
      | "frankfurter"
      // KZO-196 — ASX GICS catalog provider; admin "Run now" enqueues the
      // singleton-keyed `asx-gics-sync` queue (same job pg-boss runs on cron).
      | "asx-gics-csv";
    const existing = await app.persistence.getProviderHealthStatus(providerId);
    if (!existing) {
      throw routeError(404, "provider_not_found", "Unknown provider id");
    }
    const body = adminProviderRerunBodySchema.parse(req.body ?? {});

    if ((body.resolverMode || body.resolverModeRiskAccepted !== undefined) && providerId !== "yahoo-finance-kr") {
      throw routeError(
        400,
        "resolver_mode_provider_mismatch",
        "resolverMode is only supported for yahoo-finance-kr",
      );
    }

    const effectiveKrResolverMode =
      providerId === "yahoo-finance-kr" ? body.resolverMode ?? "quote_first" : undefined;
    if (body.resolverModeRiskAccepted !== undefined && effectiveKrResolverMode !== "chart_probe_v1") {
      throw routeError(
        400,
        "resolver_mode_risk_acceptance_unexpected",
        "resolverModeRiskAccepted is only valid with chart_probe_v1",
      );
    }
    if (effectiveKrResolverMode === "chart_probe_v1" && body.resolverModeRiskAccepted !== true) {
      throw routeError(
        400,
        "resolver_mode_risk_acceptance_required",
        "chart_probe_v1 requires explicit resolverModeRiskAccepted=true",
      );
    }

    // (3) cooldown per provider — read live (KZO-198: DB override → env).
    // KZO-197/KR — per-provider cooldown dispatch. Yahoo market reruns read
    // the longer Yahoo cooldown; other providers use the generic cooldown.
    const cooldownMs = getEffectiveProviderRerunCooldownMs(providerId);
    if (existing.lastManualRerunAt) {
      const elapsedMs = Date.now() - new Date(existing.lastManualRerunAt).getTime();
      if (elapsedMs < cooldownMs) {
        const retryAfterSec = Math.max(1, Math.ceil((cooldownMs - elapsedMs) / 1000));
        reply.header("Retry-After", String(retryAfterSec));
        throw routeError(429, "rate_limit_exceeded", "Re-run cooldown active for this provider");
      }
    }

    if (providerId === "yahoo-finance-kr" && effectiveKrResolverMode) {
      app.log.info(
        {
          providerId,
          resolverMode: effectiveKrResolverMode,
          resolverModeRiskAccepted: body.resolverModeRiskAccepted === true,
          marketAwareHint: "KR",
        },
        "provider_health_rerun_diagnostic_request",
      );
    }

    // (4) queue dispatch — checked LAST so auth/404/cooldown branches fire
    // first. When `app.boss` is null (memory backend / E2E tests with no
    // pg-boss), we skip the dispatch but still stamp the audit + cooldown
    // so the route stays observable end-to-end. Returns `tickerCount=0` and
    // `jobId=null` to signal the no-op.

    // Stamp the cooldown column BEFORE dispatching so a successful enqueue is
    // protected. If the dispatch throws, the cooldown is still in effect (a
    // small operator inconvenience), which is the safer default.
    await app.persistence.upsertProviderHealthStatus({
      providerId,
      lastManualRerunAt: new Date().toISOString(),
    });

    let tickerCount = 0;
    let marketCode: MarketCode | "FX" = "FX";
    let jobId: string | null = null;
    // Yahoo market providers use nested audit metadata. The two sub-paths
    // (catalog warm-up + monitored refresh) ship as `{tickerCount, jobId}`
    // each so the audit-log spec can verify both branches independently.
    // Top-level `tickerCount` and `jobId` remain populated as the back-compat
    // sum / first-non-null — KZO-177's audit spec asserts the flat shape and
    // must keep passing for every other provider.
    let marketCatalogBackfill: { tickerCount: number; jobId: string | null } | null = null;
    let marketMonitoredRefresh: { tickerCount: number; jobId: string | null } | null = null;

    if (providerId === "frankfurter") {
      if (app.boss) {
        const today = today_utc();
        jobId = await app.boss.send(
          FX_REFRESH_QUEUE,
          { trigger: "manual" as const, startDate: today, endDate: today, bases: [...STORED_QUOTES] },
          { singletonKey: "fx-refresh", priority: 5 },
        );
      }
      tickerCount = STORED_QUOTES.length;
    } else if (providerId === "asx-gics-csv") {
      // KZO-196: enqueue the asx-gics-sync queue. Singleton policy means a
      // concurrent admin click while a sync is in flight (or alongside the
      // weekly cron tick) coalesces — `boss.send` returns null when an
      // existing singleton job covers this work.
      const { ASX_GICS_SYNC_QUEUE, ASX_GICS_SYNC_SINGLETON_KEY } = await import(
        "../services/market-data/asxGicsSyncWorker.js"
      );
      marketCode = "AU";
      if (app.boss) {
        jobId = await app.boss.send(
          ASX_GICS_SYNC_QUEUE,
          {},
          { singletonKey: ASX_GICS_SYNC_SINGLETON_KEY, priority: 5 },
        );
      }
      tickerCount = 0;
    } else if (providerId === "twelve-data-au") {
      // KZO-200: Twelve Data is the AU catalog provider (KZO-194). Re-run
      // dispatches the catalog-sync queue for AU only — `pendingMarkets=["AU"]`
      // skips TW/US so we don't re-enumerate FinMind catalogs on this button.
      // Singleton policy collapses same-market concurrent kicks without letting
      // an AU-only rerun suppress a KR-only rerun, or vice versa.
      marketCode = "AU";
      if (app.boss) {
        jobId = await app.boss.send(
          CATALOG_SYNC_QUEUE,
          { pendingMarkets: ["AU"] },
          { singletonKey: catalogSyncRerunSingletonKey("AU"), priority: 5 },
        );
      }
      // tickerCount intentionally 0 — the catalog-sync worker enumerates the
      // upstream universe and reports `rawCount` in its own log lines; no
      // per-rerun count is meaningful at the route layer.
      tickerCount = 0;
    } else if (providerId === "twelve-data-kr") {
      marketCode = "KR";
      if (app.boss) {
        jobId = await app.boss.send(
          CATALOG_SYNC_QUEUE,
          { pendingMarkets: ["KR"] },
          { singletonKey: catalogSyncRerunSingletonKey("KR"), priority: 5 },
        );
      }
      tickerCount = 0;
    } else if (providerId === "yahoo-finance-au") {
      // KZO-197 — UNION of catalog warm-up + monitored refresh. The two sets
      // are disjoint by definition: catalog warm-up enumerates `(pending,
      // failed)` rows; monitored refresh consumes `ready` rows from the
      // monitored set. Both run unconditionally (not gated on whether the
      // other has any work).
      //
      // Single source of truth for audit metadata = helper return values.
      // Memory-backend / E2E (`app.boss === null`) → both helpers return
      // `{tickerCount:0, batchId:null}`, matching the locked scope-todo
      // (line 23) and the FinMind/twelve-data/asx-gics-csv memory-mode shape.
      marketCode = "AU";
      const [catalog, monitored] = app.boss
        ? await Promise.all([
            enqueueAuCatalogBarsBackfill(app.boss, app.persistence, app.log, {
              trigger: "admin_rerun",
            }),
            enqueueDailyRefresh(app.boss, app.persistence, app.log, {
              marketFilter: "AU",
              trigger: "admin_rerun",
            }),
          ])
        : [
            { tickerCount: 0, batchId: null as string | null },
            { tickerCount: 0, batchId: null as string | null },
          ];
      marketCatalogBackfill = { tickerCount: catalog.tickerCount, jobId: catalog.batchId };
      marketMonitoredRefresh = { tickerCount: monitored.tickerCount, jobId: monitored.batchId };
      tickerCount = catalog.tickerCount + monitored.tickerCount;
      // Top-level `jobId` = first non-null. Preserves the back-compat single-id
      // field that KZO-177 audit-log specs assert against; nested blocks carry
      // both ids when both branches dispatched.
      jobId = catalog.batchId ?? monitored.batchId ?? null;
    } else if (providerId === "yahoo-finance-kr") {
      marketCode = "KR";
      const [catalog, monitored] = app.boss
        ? await Promise.all([
            enqueueAuCatalogBarsBackfill(app.boss, app.persistence, app.log, {
              trigger: "admin_rerun",
              marketCode: "KR",
              resolverMode: effectiveKrResolverMode,
            }),
            enqueueDailyRefresh(app.boss, app.persistence, app.log, {
              marketFilter: "KR",
              trigger: "admin_rerun",
              resolverMode: effectiveKrResolverMode,
            }),
          ])
        : [
            { tickerCount: 0, batchId: null as string | null },
            { tickerCount: 0, batchId: null as string | null },
          ];
      marketCatalogBackfill = { tickerCount: catalog.tickerCount, jobId: catalog.batchId };
      marketMonitoredRefresh = { tickerCount: monitored.tickerCount, jobId: monitored.batchId };
      tickerCount = catalog.tickerCount + monitored.tickerCount;
      jobId = catalog.batchId ?? monitored.batchId ?? null;
    } else {
      marketCode = providerId === "finmind-tw" ? "TW" : "US";
      if (app.boss) {
        const result = await enqueueDailyRefresh(
          app.boss,
          app.persistence,
          app.log,
          { marketFilter: marketCode, trigger: "admin_rerun" },
        );
        tickerCount = result.tickerCount;
        jobId = result.batchId;
      }
    }

    // Yahoo market providers append the nested `catalogBackfill` +
    // `monitoredRefresh` blocks. Other providers keep the flat audit shape so
    // existing KZO-177 audit-log assertions stay green.
    const auditMetadata: Record<string, unknown> = {
      providerId,
      marketCode: marketCode === "FX" ? null : marketCode,
      tickerCount,
      jobId,
    };
    if (providerId === "yahoo-finance-kr" && effectiveKrResolverMode) {
      auditMetadata.resolverMode = effectiveKrResolverMode;
      auditMetadata.resolverModeRiskAccepted = body.resolverModeRiskAccepted === true;
    }
    if (marketCatalogBackfill !== null) {
      auditMetadata.catalogBackfill = marketCatalogBackfill;
    }
    if (marketMonitoredRefresh !== null) {
      auditMetadata.monitoredRefresh = marketMonitoredRefresh;
    }

    await app.persistence.appendAuditLog({
      actorUserId: sessionUserId,
      action: "provider_health_rerun",
      metadata: auditMetadata,
      ipAddress,
    });

    reply.code(202);
    return { status: "queued" as const, providerId, tickerCount, jobId };
  });

  // ── KZO-195 — Admin instruments listing + overrides ─────────────────────

  app.get("/instruments", async (req): Promise<import("@vakwen/shared-types").AdminInstrumentsResponse> => {
    requireAdminRole(req);
    const query = z
      .object({
        marketCode: z.enum(MARKET_CODES).default("AU"),
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      })
      .parse(req.query ?? {});

    const { items, total, page, limit } = await app.persistence.listAdminInstruments({
      marketCode: query.marketCode,
      page: query.page,
      limit: query.limit,
    });

    const {
      getEffectiveCatalogAbsenceThreshold,
      getEffectiveCatalogAbsenceGuardPercent,
      getEffectiveCatalogAbsenceGuardFloor,
    } = await import("../services/appConfig/catalogAbsence.js");

    const dtoItems: import("@vakwen/shared-types").AdminInstrumentDto[] = items.map((row) => {
      const status: import("@vakwen/shared-types").AdminInstrumentStatus = row.delistedAt
        ? "delisted"
        : row.delistingDetectionExcluded
          ? "excluded"
          : "listed";
      return {
        ticker: row.ticker,
        marketCode: row.marketCode as import("@vakwen/shared-types").MarketCode,
        name: row.name,
        // The persistence row carries `instrumentType` as `string | null`.
        // Default unknown rows to "STOCK" — safest fallback for UI rendering.
        instrumentType: (row.instrumentType ?? "STOCK") as import("@vakwen/domain").InstrumentType,
        status,
        statusReason: row.statusReason,
        absenceStreak: row.absenceStreak,
        lastSeenInCatalogAt: row.lastSeenInCatalogAt,
        delistedAt: row.delistedAt,
        delistingDetectionExcluded: row.delistingDetectionExcluded,
      };
    });

    return {
      items: dtoItems,
      total,
      page,
      limit,
      thresholds: {
        catalogAbsenceThreshold: getEffectiveCatalogAbsenceThreshold(),
        catalogAbsenceGuardPercent: getEffectiveCatalogAbsenceGuardPercent(),
        catalogAbsenceGuardFloor: getEffectiveCatalogAbsenceGuardFloor(),
      },
    };
  });

  //
  // Both override routes (undelete + exclude) are admin-only via the standard
  // `requireAdminRole` gate.
  // They mutate `market_data.instruments` directly via dedicated persistence
  // methods (see `instrumentAdminUndelete` / `instrumentAdminToggleExclude`)
  // and write per-action audit rows so operator history is durable.

  app.post("/instruments/:ticker/:marketCode/undelete", async (req) => {
    requireAdminRole(req);
    const { sessionUserId } = resolveAdminContext(req, app);
    const { ticker, marketCode } = z
      .object({
        ticker: z.string().min(1).max(40),
        marketCode: z.enum(MARKET_CODES),
      })
      .parse(req.params);

    // Persistence layer owns existence checks AND audit-row write (KZO-195).
    // Postgres throws routeError(404, "instrument_not_found", …) when the
    // composite (ticker, market_code) row is missing; memory backend
    // create-on-writes for test affordance.
    return app.persistence.undeleteInstrument(ticker, marketCode, sessionUserId);
  });

  app.post("/instruments/:ticker/:marketCode/exclude", async (req) => {
    requireAdminRole(req);
    const { sessionUserId } = resolveAdminContext(req, app);
    const { ticker, marketCode } = z
      .object({
        ticker: z.string().min(1).max(40),
        marketCode: z.enum(MARKET_CODES),
      })
      .parse(req.params);
    const body = z.object({ excluded: z.boolean() }).parse(req.body ?? {});

    return app.persistence.setInstrumentDelistingDetectionExcluded(
      ticker,
      marketCode,
      body.excluded,
      sessionUserId,
    );
  });
};
