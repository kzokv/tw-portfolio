/**
 * KZO-199 — sharing knob resolvers. DB override (when set) wins; env-fallback
 * otherwise. Mirrors `apps/api/src/services/appConfig/sse.ts`.
 *
 * Cache-pending / load-failure → `getAppConfigCacheEntry()` returns null and
 * we fall back to env. Never throws.
 */
import { Env } from "@vakwen/config";
import { getAppConfigCacheEntry } from "./cache.js";

export function getEffectiveAnonymousShareTokenCap(): number {
  return getAppConfigCacheEntry()?.anonymousShareTokenCap ?? Env.ANONYMOUS_SHARE_TOKEN_CAP;
}

export function getEffectiveAnonymousShareTokenRetentionMs(): number {
  return getAppConfigCacheEntry()?.anonymousShareTokenRetentionMs ?? Env.ANONYMOUS_SHARE_TOKEN_RETENTION_MS;
}

export function getEffectiveAnonymousShareRateLimitMax(): number {
  return getAppConfigCacheEntry()?.anonymousShareRateLimitMax ?? Env.ANONYMOUS_SHARE_RATE_LIMIT_MAX;
}

export function getEffectiveAnonymousShareRateLimitWindowMs(): number {
  return getAppConfigCacheEntry()?.anonymousShareRateLimitWindowMs ?? Env.ANONYMOUS_SHARE_RATE_LIMIT_WINDOW_MS;
}
