/**
 * KZO-198 — rate-limit resolvers. Each getter returns the effective value:
 * DB override (if set in `app_config`) wins, else the env-var fallback.
 *
 * Cache-pending / load-failure → `getAppConfigCacheEntry()` returns null and
 * we fall back to env. Never throws.
 */
import { Env } from "@vakwen/config";
import { getAppConfigCacheEntry } from "./cache.js";

export function getEffectiveMarketDataPriceWindowMs(): number {
  return getAppConfigCacheEntry()?.marketDataPriceWindowMs ?? Env.MARKET_DATA_PRICE_WINDOW_MS;
}

export function getEffectiveMarketDataPriceLimit(): number {
  return getAppConfigCacheEntry()?.marketDataPriceLimit ?? Env.MARKET_DATA_PRICE_LIMIT;
}

export function getEffectiveMarketDataSearchWindowMs(): number {
  return getAppConfigCacheEntry()?.marketDataSearchWindowMs ?? Env.MARKET_DATA_SEARCH_WINDOW_MS;
}

/**
 * Effective max search requests per window. Falls back to
 * `MARKET_DATA_SEARCH_RATE_LIMIT_PER_MINUTE` (the legacy env name documents
 * the per-minute cadence; the DB override is a request-count value matching
 * `getEffectiveMarketDataSearchWindowMs()`).
 */
export function getEffectiveMarketDataSearchLimit(): number {
  return getAppConfigCacheEntry()?.marketDataSearchLimit ?? Env.MARKET_DATA_SEARCH_RATE_LIMIT_PER_MINUTE;
}

export function getEffectiveInviteStatusWindowMs(): number {
  return getAppConfigCacheEntry()?.inviteStatusWindowMs ?? Env.INVITE_STATUS_WINDOW_MS;
}

export function getEffectiveInviteStatusLimit(): number {
  return getAppConfigCacheEntry()?.inviteStatusLimit ?? Env.INVITE_STATUS_LIMIT;
}
