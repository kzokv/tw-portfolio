/**
 * KZO-198 — provider-health resolvers. DB override wins; env-fallback otherwise.
 */
import { Env } from "@tw-portfolio/config";
import { getAppConfigCacheEntry } from "./cache.js";

export function getEffectiveDownNotificationSuppressionMs(): number {
  return (
    getAppConfigCacheEntry()?.providerDownNotificationSuppressionMs ??
    Env.PROVIDER_DOWN_NOTIFICATION_SUPPRESSION_MS
  );
}

export function getEffectiveErrorTrailRetentionDays(): number {
  return (
    getAppConfigCacheEntry()?.providerErrorTrailRetentionDays ??
    Env.PROVIDER_ERROR_TRAIL_RETENTION_DAYS
  );
}

export function getEffectiveRerunCooldownMs(): number {
  return (
    getAppConfigCacheEntry()?.providerRerunCooldownMs ??
    Env.PROVIDER_RERUN_COOLDOWN_MS
  );
}
