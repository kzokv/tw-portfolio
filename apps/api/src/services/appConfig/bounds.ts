/**
 * KZO-198 — single source of truth for Tier 1/2 admin override bounds.
 *
 * Consumed by:
 *   - `apps/api/src/routes/adminRoutes.ts` PATCH `/admin/settings` Zod schema
 *   - The `AppConfigDto` exposed to the admin UI; the UI binds `min`/`max`
 *     HTML attributes from this object so admin clients never duplicate the
 *     values (per scope-todo locked decisions).
 *
 * `secretLength` is the Tier 0 plaintext length window (chars). It is NOT a
 * bound on the encrypted storage shape; the resolver-layer `decryptSecret`
 * doesn't care about plaintext length.
 *
 * Update bounds here when adjusting any admin override; never inline literal
 * `min`/`max` values in the route schema or UI.
 */
export const APP_CONFIG_BOUNDS = {
  // Tier 1 — rate limits
  marketDataPriceWindowMs: { min: 1_000, max: 600_000 },
  marketDataPriceLimit: { min: 1, max: 10_000 },
  marketDataSearchWindowMs: { min: 1_000, max: 600_000 },
  marketDataSearchLimit: { min: 1, max: 10_000 },
  inviteStatusWindowMs: { min: 1_000, max: 600_000 },
  inviteStatusLimit: { min: 1, max: 10_000 },

  // Tier 1 — provider health
  providerDownNotificationSuppressionMs: { min: 60_000, max: 7 * 24 * 60 * 60 * 1000 },
  providerErrorTrailRetentionDays: { min: 1, max: 365 },
  providerRerunCooldownMs: { min: 1_000, max: 24 * 60 * 60 * 1000 },
  // KZO-197 — yahoo-finance-au rerun cooldown override. Same window as the
  // generic provider cooldown — 1 s minimum to allow tests to drive sub-cooldown
  // sequences, 24 h maximum to prevent operator-lockout on misconfiguration.
  yahooAuRerunCooldownMs: { min: 1_000, max: 24 * 60 * 60 * 1000 },
  // Provider Fixer guardrails (KZO-197 addendum). These are admin-tunable
  // because operator risk appetite differs by deployment and provider quota.
  providerFixerDangerousMatchThreshold: { min: 1, max: 100_000 },
  providerFixerPreviewSampleLimit: { min: 1, max: 1_000 },
  providerFixerUiPageSize: { min: 5, max: 200 },
  providerFixerAutoPauseFailuresPerMinute: { min: 1, max: 10_000 },
  providerFixerPreviewTokenTtlMinutes: { min: 1, max: 120 },
  providerOperationAutoRenewIntervalMinutes: { min: 1, max: 24 * 60 },
  providerIncidentRecurrenceWindowMinutes: { min: 1, max: 24 * 60 },
  providerHealthWarningUnresolvedThreshold: { min: 1, max: 1_000_000 },
  providerHealthCriticalUnresolvedThreshold: { min: 1, max: 1_000_000 },
  providerOperationStaleHeartbeatMinutes: { min: 1, max: 240 },
  providerOperationSummaryRetentionDays: { min: 1, max: 365 },
  providerOperationLogRetentionDays: { min: 1, max: 365 },
  providerIncidentRetentionDays: { min: 1, max: 365 },
  providerResolvedItemRetentionDays: { min: 1, max: 365 },
  finmindProviderRateLimitPerHour: { min: 1, max: 100_000 },
  twelveDataProviderRateLimitPerMinute: { min: 1, max: 10_000 },
  yahooAuProviderRateLimitPerMinute: { min: 1, max: 10_000 },
  yahooKrProviderRateLimitPerMinute: { min: 1, max: 10_000 },
  frankfurterProviderRateLimitPerMinute: { min: 1, max: 10_000 },
  asxGicsProviderRateLimitPerHour: { min: 1, max: 10_000 },

  // Tier 1 — backfill (UI-editable subset)
  backfillRetryLimit: { min: 0, max: 10 },
  backfillRetryDelaySeconds: { min: 1, max: 3_600 },
  backfillFinmind402RetryMs: { min: 1_000, max: 24 * 60 * 60 * 1000 },
  tickerPriceCloseRefreshGraceMinutes: { min: 0, max: 24 * 60 },
  tickerPriceIntradayRefreshIntervalMinutes: { min: 1, max: 60 },
  tickerPriceIntradayFreshnessToleranceMinutes: { min: 1, max: 24 * 60 },
  tickerPriceYahooChartRequestLimitPerMinute: { min: 1, max: 10_000 },
  tickerPriceQueueConcurrency: { min: 1, max: 128 },
  tickerPriceMaxTickersPerRefreshCycle: { min: 1, max: 10_000 },
  tickerPriceRefreshCloseRateLimitWindowMs: { min: 1_000, max: 24 * 60 * 60 * 1000 },
  tickerPriceRefreshCloseRateLimitMax: { min: 1, max: 10_000 },
  tickerPriceSyncTickerCap: { min: 1, max: 10_000 },
  tickerPriceActivityDetailedRetentionDays: { min: 1, max: 365 },
  tickerPriceActivitySummaryRetentionDays: { min: 1, max: 730 },
  tickerPriceCalendarHistoryRetentionDays: { min: 30, max: 10 * 365 },

  // Tier 2 (DB + SQL only — NOT in UI / NOT in PATCH):
  //   dailyRefreshLookbackDays, dailyRefreshPriority,
  //   sseHeartbeatIntervalMs, sseMaxConnectionsPerUser, sseBufferDefaultTtlMs.
  // These are intentionally absent so they never leak into AppConfigDto or
  // patchAdminSettingsSchema. Operators override via direct SQL.

  // Existing (pre-KZO-198) — surfaced here so admin UI/route can bind off the
  // same source of truth. Keep `max=10080` (7 days in minutes) for back-compat
  // with the pre-existing PATCH bound (`apps/api/test/unit/admin-settings-schema.test.ts`).
  repairCooldownMinutes: { min: 1, max: 10080 },

  // KZO-195 — absence-based delisting detection (Tier 2 hybrid).
  // `catalogAbsenceGuardPercent` is not constrained to integer; the admin
  // route schema uses a non-int Zod refinement for it.
  catalogAbsenceThreshold: { min: 1, max: 30 },
  catalogAbsenceGuardPercent: { min: 0, max: 100 },
  catalogAbsenceGuardFloor: { min: 0, max: 1000 },

  // KZO-199 — Tier 1 sharing knobs (in PATCH schema, in UI).
  anonymousShareTokenCap: { min: 1, max: 1_000 },
  anonymousShareRateLimitMax: { min: 1, max: 10_000 },
  anonymousShareRateLimitWindowMs: { min: 1_000, max: 600_000 },
  // KZO-199 — Tier 2 (NOT in PATCH schema, NOT in UI; documented for column
  // comment + bodyLimit ceiling). Operators override via direct SQL.
  anonymousShareTokenRetentionMs: { min: 24 * 60 * 60 * 1000, max: 365 * 24 * 60 * 60 * 1000 },
  userPreferencesMaxBytes: { min: 256, max: 1_048_576 },

  // ui-enhancement — Tier B account-soft-delete grace period (days). Lower
  // bound 1 (any positive integer permits "purge tomorrow" semantics for
  // testing); upper bound 365 (1 year — matches the upstream Anonymous share
  // token retention bound).
  accountHardPurgeDays: { min: 1, max: 365 },
  valuationHealthRelativeBps: { min: 0, max: 10_000 },
  valuationHealthAbsoluteAud: { min: 0, max: 1_000_000 },
  valuationHealthAbsoluteUsd: { min: 0, max: 1_000_000 },
  valuationHealthAbsoluteTwd: { min: 0, max: 100_000_000 },
  valuationHealthAbsoluteKrw: { min: 0, max: 1_000_000_000 },
  routeCacheDashboardPrimaryTtlMs: { min: 5_000, max: 30 * 60 * 1000 },
  routeCacheDashboardEnrichmentTtlMs: { min: 5_000, max: 30 * 60 * 1000 },
  routeCacheDashboardPerformanceTtlMs: { min: 5_000, max: 30 * 60 * 1000 },
  routeCachePortfolioTtlMs: { min: 5_000, max: 30 * 60 * 1000 },
  routeCacheReportsTtlMs: { min: 5_000, max: 30 * 60 * 1000 },
  routeCacheStaleUsableTtlMs: { min: 30_000, max: 60 * 60 * 1000 },
} as const;

export type AppConfigBoundsKey = keyof typeof APP_CONFIG_BOUNDS;

/**
 * Tier 0 plaintext length bound (chars). `decryptSecret` does not enforce
 * this — it is purely a UI/route-schema affordance to reject obvious typos
 * (empty, accidental copy of "•••" placeholder, etc.).
 */
export const APP_CONFIG_SECRET_LENGTH = { min: 20, max: 500 } as const;
