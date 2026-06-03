import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";
import type {
  AiConnectorPolicySettingsDto,
  AppConfigDto,
  ProviderFixerDashboardDiagnosticsResponse,
  ProviderFixerDashboardEvidenceSampleDto,
  ProviderFixerDashboardGuardrailSettingsDto,
  ProviderFixerDashboardLogEntryDto,
  ProviderFixerDashboardLogsResponse,
  ProviderFixerDashboardOperationDto,
  ProviderFixerDashboardOperationsResponse,
  ProviderFixerDashboardSummaryResponse,
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
} from "../services/appConfig/cache.js";
import type {
  AppConfigPlainField,
  ProviderErrorTrailRow,
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
import type { MarketDataResolverMode, ProviderSymbolVerificationResult } from "../services/market-data/types.js";
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
    bounds: APP_CONFIG_BOUNDS,
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
const providerFixerOperationParamsSchema = z.object({
  operationId: z.string().trim().min(1).max(120),
});

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
  options: { resolverMode?: MarketDataResolverMode; verifyCandidate?: boolean } = {},
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
    canCancel: operation.phase === "preview" || operation.phase === "staged" || operation.phase === "running" || operation.phase === "paused",
    dangerous,
    progressPercent: numberField(metadata.progressPercent),
    autoPauseFailureCount: numberField(metadata.autoPauseFailureCount),
    autoPauseFailureThresholdPerMinute: guardrails.autoPauseFailureThresholdPerMinute,
    effectiveRateCapPerMinute: numberField(metadata.effectiveRateCapPerMinute) ?? 250,
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

async function assertNoOtherProviderFixerExecution(
  app: FastifyInstance,
  operation: ProviderOperationRecord,
): Promise<void> {
  const active = await app.persistence.listProviderOperations({
    providerId: operation.providerId,
    marketCode: operation.marketCode,
    phases: ["staged", "running", "paused"],
    page: 1,
    limit: 50,
  });
  const other = active.items.find((row) => row.id !== operation.id);
  if (other) {
    throw routeError(
      409,
      "provider_fixer_active_execution_exists",
      "Another Provider Fixer execution is already active for this provider and market",
    );
  }
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
    phases: ["preview", "staged", "running", "paused"],
  });
  const running = await app.persistence.listProviderOperations({
    page: 1,
    limit: 1,
    phases: ["running"],
  });
  const staged = await app.persistence.listProviderOperations({
    page: 1,
    limit: 1,
    phases: ["preview", "staged"],
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
      effectiveRateCapPerMinute: 250,
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
      const evidence = await buildProviderFixerEvidenceRow(app, operation.providerId, operation.marketCode, row, {
        resolverMode: operation.resolverMode ?? "quote_first",
        verifyCandidate: true,
      });
      if (!evidence?.candidateSymbol || evidence.verificationStatus !== "verified") {
        skipped += 1;
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
    }
    if (page * limit >= rows.total || rows.items.length === 0) break;
    page += 1;
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

function registerProviderFixerAdminRoutes(app: FastifyInstance): void {
  app.get("/provider-fixer/summary", async (req): Promise<ProviderFixerDashboardSummaryResponse> => {
    requireAdminRole(req);
    const guardrails = providerFixerGuardrailsFromConfig(await loadAppConfigDto(app));
    return providerFixerSummary(app, guardrails);
  });

  app.get("/provider-fixer/diagnostics", async (req): Promise<ProviderFixerDashboardDiagnosticsResponse> => {
    requireAdminRole(req);
    const query = z
      .object({
        providerId: providerFixerProviderSchema.default("yahoo-finance-kr"),
        marketCode: providerFixerMarketCodeSchema.optional(),
        resolverMode: providerFixerResolverModeSchema.default("quote_first"),
        errorCode: providerFixerErrorCodeSchema.default("yahoo_finance_kr_symbol_unresolved"),
      })
      .parse(req.query ?? {});
    const guardrails = providerFixerGuardrailsFromConfig(await loadAppConfigDto(app));
    return providerFixerDiagnostics(
      app,
      guardrails,
      query.providerId,
      providerFixerMarketCode(query.providerId, query.marketCode),
      query.resolverMode,
      query.errorCode,
    );
  });

  app.post("/provider-fixer/preview", async (req, reply) => {
    requireAdminRole(req);
    const { sessionUserId, ipAddress } = resolveAdminContext(req, app);
    const body = providerFixerPreviewBodySchema.parse(req.body ?? {});
    const guardrails = providerFixerGuardrailsFromConfig(await loadAppConfigDto(app));
    const marketCode = providerFixerMarketCode(body.providerId, body.marketCode);
    const { sample, total } = await buildProviderFixerEvidenceSample(
      app,
      body.providerId,
      marketCode,
      body.errorCode,
      body.resolverMode,
      guardrails.previewSampleLimit,
    );
    const token = newProviderFixerToken();
    const dangerous = total >= guardrails.dangerousMatchThreshold;
    const confirmationText = dangerous ? `EXECUTE ${total}` : null;
    const now = Date.now();
    const operation = await app.persistence.createProviderOperation({
      providerId: body.providerId,
      marketCode,
      operationType: "resolver_repair",
      phase: "preview",
      errorCode: body.errorCode,
      resolverMode: body.resolverMode,
      scopeQuery: `${body.providerId}:${marketCode}:${body.errorCode}`,
      snapshotHash: hashProviderFixerToken(`${body.providerId}:${marketCode}:${body.errorCode}:${total}:${now}`).slice(0, 12),
      previewTokenHash: hashProviderFixerToken(token),
      previewExpiresAt: new Date(now + guardrails.previewTokenTtlSeconds * 1000).toISOString(),
      matchCount: total,
      sample,
      metadata: {
        previewTokenDisplay: token,
        confirmationText,
        effectiveRateCapPerMinute: 250,
        autoPauseFailureThresholdPerMinute: guardrails.autoPauseFailureThresholdPerMinute,
      },
      actorUserId: sessionUserId,
    });
    await app.persistence.createProviderOperationLog({
      operationId: operation.id,
      phase: "preview",
      level: total > 0 ? "info" : "warning",
      message: `preview provider=${body.providerId} market=${marketCode} error_code=${body.errorCode} matched=${total} sample=${sample.length}`,
      context: {
        providerId: body.providerId,
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
        providerId: body.providerId,
        marketCode,
        errorCode: body.errorCode,
        resolverMode: body.resolverMode,
        matchCount: total,
        dangerous,
      },
    });
    reply.code(201);
    return { operation: providerFixerOperationToDto(operation, guardrails) };
  });

  app.post("/provider-fixer/stage", async (req) => {
    requireAdminRole(req);
    const { sessionUserId, ipAddress } = resolveAdminContext(req, app);
    const body = providerFixerOperationBodySchema.parse(req.body ?? {});
    const existing = await app.persistence.getProviderOperation(body.operationId);
    if (!existing) throw routeError(404, "provider_operation_not_found", "Provider operation not found");
    if (existing.phase !== "preview") {
      throw routeError(400, "provider_operation_not_stageable", "Only preview operations can be staged");
    }
    assertProviderFixerPreviewToken(existing, body.previewToken);
    const updated = await app.persistence.updateProviderOperation({
      id: existing.id,
      phase: "staged",
      actorUserId: sessionUserId,
    });
    await app.persistence.createProviderOperationLog({
      operationId: updated.id,
      phase: "staged",
      level: "info",
      message: `staged provider=${updated.providerId} market=${updated.marketCode} matched=${updated.matchCount ?? 0}`,
      context: { providerId: updated.providerId, marketCode: updated.marketCode },
    });
    await app.persistence.appendAuditLog({
      actorUserId: sessionUserId,
      action: "provider_fixer_operation",
      ipAddress,
      metadata: { operationId: updated.id, action: "stage", providerId: updated.providerId, marketCode: updated.marketCode },
    });
    return { operation: providerFixerOperationToDto(updated, providerFixerGuardrailsFromConfig(await loadAppConfigDto(app))) };
  });

  async function executeProviderFixerOperation(
    req: FastifyRequest,
    operationId: string,
    body: z.infer<typeof providerFixerOperationBodySchema>,
  ) {
    requireAdminRole(req);
    const { sessionUserId, ipAddress } = resolveAdminContext(req, app);
    const existing = await app.persistence.getProviderOperation(operationId);
    if (!existing) throw routeError(404, "provider_operation_not_found", "Provider operation not found");
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
    await assertNoOtherProviderFixerExecution(app, existing);

    const running = await app.persistence.updateProviderOperation({
      id: existing.id,
      phase: "running",
      actorUserId: sessionUserId,
      startedAt: new Date().toISOString(),
      metadata: { ...(asRecord(existing.metadata) ?? {}), progressPercent: 0 },
    });
    await app.persistence.createProviderOperationLog({
      operationId: running.id,
      phase: "running",
      level: "info",
      message: `execute_started provider=${running.providerId} market=${running.marketCode} matched=${running.matchCount ?? 0}`,
      context: { providerId: running.providerId, marketCode: running.marketCode, errorCode: running.errorCode },
    });
    const result = await executeProviderFixerMappings(app, running, sessionUserId);
    const backfills = await enqueueProviderFixerBackfills(app, running, result.mappedTickers);
    const completed = await app.persistence.updateProviderOperation({
      id: running.id,
      phase: "completed",
      completedAt: new Date().toISOString(),
      metadata: {
        ...(asRecord(running.metadata) ?? {}),
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
      actorUserId: sessionUserId,
      action: "provider_fixer_operation",
      ipAddress,
      metadata: {
        operationId: completed.id,
        action: "execute",
        providerId: completed.providerId,
        marketCode: completed.marketCode,
        dangerous: operationDto.dangerous,
        ...result,
        backfills,
      },
    });
    return { operation: providerFixerOperationToDto(completed, guardrails), result: { ...result, backfills } };
  }

  app.post("/provider-fixer/execute", async (req) => {
    const body = providerFixerOperationBodySchema.parse(req.body ?? {});
    return executeProviderFixerOperation(req, body.operationId, body);
  });

  app.post("/provider-fixer/operations/:operationId/execute", async (req) => {
    const params = providerFixerOperationParamsSchema.parse(req.params);
    const body = providerFixerOperationBodySchema.partial({ operationId: true }).parse(req.body ?? {});
    return executeProviderFixerOperation(req, params.operationId, { ...body, operationId: params.operationId });
  });

  for (const [action, from, to] of [
    ["pause", "running", "paused"],
    ["resume", "paused", "running"],
    ["cancel", null, "cancelled"],
  ] as const) {
    app.post(`/provider-fixer/operations/:operationId/${action}`, async (req) => {
      requireAdminRole(req);
      const { sessionUserId, ipAddress } = resolveAdminContext(req, app);
      const { operationId } = providerFixerOperationParamsSchema.parse(req.params);
      const existing = await app.persistence.getProviderOperation(operationId);
      if (!existing) throw routeError(404, "provider_operation_not_found", "Provider operation not found");
      if (from && existing.phase !== from) {
        throw routeError(400, `provider_operation_not_${action}able`, `Selected operation cannot be ${action}d`);
      }
      if (action === "cancel" && !["preview", "staged", "running", "paused"].includes(existing.phase)) {
        throw routeError(400, "provider_operation_not_cancellable", "Selected operation cannot be cancelled");
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
      return { operation: providerFixerOperationToDto(updated, providerFixerGuardrailsFromConfig(await loadAppConfigDto(app))) };
    });
  }

  app.get("/provider-fixer/operations", async (req): Promise<ProviderFixerDashboardOperationsResponse> => {
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
    const result = await app.persistence.listProviderOperations({
      providerId: query.providerId,
      marketCode: query.marketCode,
      phases: query.phase ? [query.phase as ProviderOperationPhase] : undefined,
      page: query.page,
      limit: query.limit,
    });
    const guardrails = providerFixerGuardrailsFromConfig(await loadAppConfigDto(app));
    const operations = result.items.map((operation) => providerFixerOperationToDto(operation, guardrails));
    return {
      stagedOperation:
        operations.find((operation) => operation.phase === "preview" || operation.phase === "staged") ?? null,
      operations,
      total: result.total,
      page: result.page,
      limit: result.limit,
    };
  });

  app.get("/provider-fixer/logs", async (req): Promise<ProviderFixerDashboardLogsResponse> => {
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
    const operationIds = query.operationId
      ? [query.operationId]
      : (await app.persistence.listProviderOperations({
          providerId: query.providerId,
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

    const current = await app.persistence.getAppConfig();

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
    return { providers };
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
