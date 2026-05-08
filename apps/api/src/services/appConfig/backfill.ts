/**
 * KZO-198 — backfill knob resolvers. DB override wins; env-fallback otherwise.
 *
 * Note: `backfillRetryLimit` and `backfillRetryDelaySeconds` are read once at
 * pg-boss queue registration time today (per scope-todo Phase 3 — eviction
 * cadence stays env-default to honor `fastify-eviction-lifecycle-pattern.md`).
 * The resolvers exist so the admin DTO can surface the effective values and
 * so future tickets that benefit from live reads have a single call surface.
 */
import { Env } from "@tw-portfolio/config";
import { getAppConfigCacheEntry } from "./cache.js";

export function getEffectiveBackfillRetryLimit(): number {
  return getAppConfigCacheEntry()?.backfillRetryLimit ?? Env.BACKFILL_RETRY_LIMIT;
}

export function getEffectiveBackfillRetryDelaySeconds(): number {
  return getAppConfigCacheEntry()?.backfillRetryDelaySeconds ?? Env.BACKFILL_RETRY_DELAY_SECONDS;
}

export function getEffectiveBackfillFinmind402RetryMs(): number {
  return getAppConfigCacheEntry()?.backfillFinmind402RetryMs ?? Env.BACKFILL_FINMIND_402_RETRY_MS;
}

export function getEffectiveDailyRefreshLookbackDays(): number {
  return getAppConfigCacheEntry()?.dailyRefreshLookbackDays ?? Env.DAILY_REFRESH_LOOKBACK_DAYS;
}

export function getEffectiveDailyRefreshPriority(): number {
  return getAppConfigCacheEntry()?.dailyRefreshPriority ?? Env.DAILY_REFRESH_PRIORITY;
}
