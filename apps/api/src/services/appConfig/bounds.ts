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

  // Tier 1 — backfill (UI-editable subset)
  backfillRetryLimit: { min: 0, max: 10 },
  backfillRetryDelaySeconds: { min: 1, max: 3_600 },
  backfillFinmind402RetryMs: { min: 1_000, max: 24 * 60 * 60 * 1000 },

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
} as const;

export type AppConfigBoundsKey = keyof typeof APP_CONFIG_BOUNDS;

/**
 * Tier 0 plaintext length bound (chars). `decryptSecret` does not enforce
 * this — it is purely a UI/route-schema affordance to reject obvious typos
 * (empty, accidental copy of "•••" placeholder, etc.).
 */
export const APP_CONFIG_SECRET_LENGTH = { min: 20, max: 500 } as const;
