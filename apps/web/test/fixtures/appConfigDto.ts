// KZO-198 — shared `AppConfigDto` test fixture. Used by AdminSettingsClient
// unit tests so each spec doesn't have to enumerate the 22 numeric +
// 2 sentinel + bounds fields. Real DTO values come from the API; this
// fixture mirrors a freshly-deployed state where every Tier 1/2 field is on
// its env default and every Tier 0 secret is unset.

import type { AppConfigDto } from "@vakwen/shared-types";

const DEFAULT_BOUNDS: AppConfigDto["bounds"] = {
  marketDataPriceWindowMs: { min: 1_000, max: 600_000 },
  marketDataPriceLimit: { min: 1, max: 10_000 },
  marketDataSearchWindowMs: { min: 1_000, max: 600_000 },
  marketDataSearchLimit: { min: 1, max: 10_000 },
  inviteStatusWindowMs: { min: 1_000, max: 600_000 },
  inviteStatusLimit: { min: 1, max: 10_000 },
  providerDownNotificationSuppressionMs: { min: 60_000, max: 7 * 24 * 60 * 60 * 1000 },
  providerErrorTrailRetentionDays: { min: 1, max: 365 },
  providerRerunCooldownMs: { min: 1_000, max: 24 * 60 * 60 * 1000 },
  yahooAuRerunCooldownMs: { min: 1_000, max: 24 * 60 * 60 * 1000 },
  backfillRetryLimit: { min: 0, max: 10 },
  backfillRetryDelaySeconds: { min: 1, max: 3_600 },
  backfillFinmind402RetryMs: { min: 1_000, max: 24 * 60 * 60 * 1000 },
  dailyRefreshLookbackDays: { min: 1, max: 365 },
  dailyRefreshPriority: { min: 0, max: 100 },
  sseHeartbeatIntervalMs: { min: 1_000, max: 600_000 },
  sseMaxConnectionsPerUser: { min: 1, max: 1_000 },
  sseBufferDefaultTtlMs: { min: 1_000, max: 24 * 60 * 60 * 1000 },
  repairCooldownMinutes: { min: 1, max: 24 * 60 },
  // KZO-199 — Tier 1 sharing knobs.
  anonymousShareTokenCap: { min: 1, max: 1_000 },
  anonymousShareRateLimitMax: { min: 1, max: 10_000 },
  anonymousShareRateLimitWindowMs: { min: 1_000, max: 600_000 },
};

export function buildAppConfigDto(overrides: Partial<AppConfigDto> = {}): AppConfigDto {
  return {
    repairCooldownMinutes: null,
    effectiveRepairCooldownMinutes: 15,
    dashboardPerformanceRanges: null,
    effectiveDashboardPerformanceRanges: ["1M", "3M", "YTD", "1Y"],
    metadataEnrichmentMode: null,
    effectiveMetadataEnrichmentMode: "conditional",

    // Tier 1 — rate limits
    marketDataPriceWindowMs: null,
    effectiveMarketDataPriceWindowMs: 60_000,
    marketDataPriceLimit: null,
    effectiveMarketDataPriceLimit: 60,
    marketDataSearchWindowMs: null,
    effectiveMarketDataSearchWindowMs: 60_000,
    marketDataSearchLimit: null,
    effectiveMarketDataSearchLimit: 30,
    inviteStatusWindowMs: null,
    effectiveInviteStatusWindowMs: 60_000,
    inviteStatusLimit: null,
    effectiveInviteStatusLimit: 30,

    // Tier 1 — provider health
    providerDownNotificationSuppressionMs: null,
    effectiveProviderDownNotificationSuppressionMs: 6 * 60 * 60 * 1000,
    providerErrorTrailRetentionDays: null,
    effectiveProviderErrorTrailRetentionDays: 30,
    providerRerunCooldownMs: null,
    effectiveProviderRerunCooldownMs: 60_000,
    yahooAuRerunCooldownMs: null,
    effectiveYahooAuRerunCooldownMs: 30 * 60 * 1000,

    // Tier 1 — backfill
    backfillRetryLimit: null,
    effectiveBackfillRetryLimit: 3,
    backfillRetryDelaySeconds: null,
    effectiveBackfillRetryDelaySeconds: 60,
    backfillFinmind402RetryMs: null,
    effectiveBackfillFinmind402RetryMs: 60 * 60 * 1000,

    // KZO-198 Tier 2 (dailyRefresh + SSE) is DB+SQL only and intentionally
    // absent from AppConfigDto. Operators override via direct SQL.

    // KZO-195 — Tier 2 absence-based delisting detection
    catalogAbsenceThreshold: null,
    effectiveCatalogAbsenceThreshold: 3,
    catalogAbsenceGuardPercent: null,
    effectiveCatalogAbsenceGuardPercent: 1.0,
    catalogAbsenceGuardFloor: null,
    effectiveCatalogAbsenceGuardFloor: 5,

    // KZO-199 — Tier 1 sharing knobs
    anonymousShareTokenCap: null,
    effectiveAnonymousShareTokenCap: 20,
    anonymousShareRateLimitMax: null,
    effectiveAnonymousShareRateLimitMax: 30,
    anonymousShareRateLimitWindowMs: null,
    effectiveAnonymousShareRateLimitWindowMs: 300_000,

    // ui-enhancement (2026-05-13) — Tier B grace period for account
    // soft-delete → hard-purge cron.
    accountHardPurgeDays: null,
    effectiveAccountHardPurgeDays: 30,

    // Tier 0 — encrypted secrets (sentinel)
    finmindApiTokenSet: false,
    twelveDataApiKeySet: false,

    bounds: DEFAULT_BOUNDS,
    secretLengthBounds: { min: 20, max: 500 },

    updatedAt: "2026-05-08T10:00:00.000Z",
    ...overrides,
  };
}
