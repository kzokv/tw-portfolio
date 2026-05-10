// KZO-198 — Shared test helpers for the AppConfig resolver unit tests.
//
// Backend ships:
//   - `getAppConfigCacheEntry()` (sync, returns row or null)
//   - `refresh()` (async, reads via the registered persistence)
//   - `setAppConfigCachePersistence(p)` (test-only injection)
//   - `_resetAppConfigCache()` (test-only state reset)
//
// MemoryPersistence does not yet expose per-field setters for the 17 new
// columns. Until it does, these tests inject a stub Persistence that returns
// a hand-rolled row from `getAppConfig()` so the cache is seeded with whatever
// shape the test wants. The shape mirrors `AppConfigCacheEntry`.

import { vi } from "vitest";
import type { AppConfigCacheEntry } from "../../../src/services/appConfig/cache.js";
import type { Persistence } from "../../../src/persistence/types.js";

/**
 * Build a fake `Persistence` whose `getAppConfig()` returns a single hand-
 * rolled row. All fields default to NULL (env-fallback) — overrides land at
 * whatever subset the test cares about.
 */
export function fakePersistenceWithAppConfig(
  override: Partial<AppConfigCacheEntry> = {},
): { getAppConfig: ReturnType<typeof vi.fn<() => Promise<AppConfigCacheEntry>>> } {
  const row: AppConfigCacheEntry = {
    repairCooldownMinutes: null,
    dashboardPerformanceRanges: null,
    metadataEnrichmentMode: null,
    finmindApiTokenEncrypted: null,
    twelveDataApiKeyEncrypted: null,
    marketDataPriceWindowMs: null,
    marketDataPriceLimit: null,
    marketDataSearchWindowMs: null,
    marketDataSearchLimit: null,
    inviteStatusWindowMs: null,
    inviteStatusLimit: null,
    providerDownNotificationSuppressionMs: null,
    providerErrorTrailRetentionDays: null,
    providerRerunCooldownMs: null,
    // KZO-197 — yahoo-finance-au rerun cooldown override (Tier 1).
    yahooAuRerunCooldownMs: null,
    backfillRetryLimit: null,
    backfillRetryDelaySeconds: null,
    backfillFinmind402RetryMs: null,
    dailyRefreshLookbackDays: null,
    dailyRefreshPriority: null,
    sseHeartbeatIntervalMs: null,
    sseMaxConnectionsPerUser: null,
    sseBufferDefaultTtlMs: null,
    // KZO-195 — absence detection knobs.
    catalogAbsenceThreshold: null,
    catalogAbsenceGuardPercent: null,
    catalogAbsenceGuardFloor: null,
    // KZO-196 — AU GICS sync cron override.
    asxGicsRefreshCron: null,
    updatedAt: new Date().toISOString(),
    ...override,
  };
  return {
    getAppConfig: vi.fn<() => Promise<AppConfigCacheEntry>>().mockResolvedValue(row),
  };
}

/**
 * Seed the cache with the given partial app_config row. Returns once the
 * cache has the row loaded so subsequent `getAppConfigCacheEntry()` calls
 * see it within the TTL window.
 */
export async function seedCache(
  override: Partial<AppConfigCacheEntry>,
  modules: {
    setAppConfigCachePersistence: (p: Persistence | null) => void;
    refresh: () => Promise<void>;
    _resetAppConfigCache: () => void;
  },
): Promise<void> {
  modules._resetAppConfigCache();
  // Cast — `fakePersistenceWithAppConfig` returns a structural subset of
  // `Persistence`. The cache only calls `.getAppConfig()`, so this is safe.
  modules.setAppConfigCachePersistence(
    fakePersistenceWithAppConfig(override) as unknown as Persistence,
  );
  await modules.refresh();
}
