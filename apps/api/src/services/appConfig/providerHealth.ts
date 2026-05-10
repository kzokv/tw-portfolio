/**
 * KZO-198 — provider-health resolvers. DB override wins; env-fallback otherwise.
 *
 * KZO-197 — adds per-provider rerun-cooldown dispatch:
 *   - `getEffectiveYahooAuRerunCooldownMs()` resolves the AU-specific cooldown.
 *   - `getEffectiveProviderRerunCooldownMs(providerId)` dispatches `'yahoo-finance-au'`
 *     to the AU resolver and every other provider to the generic
 *     `getEffectiveRerunCooldownMs()`. Use this from any caller that already
 *     knows the providerId — keeps the AU 30-min default + DB override coherent
 *     with the generic 60-s default for everything else.
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

/**
 * KZO-197 — yahoo-finance-au-only rerun cooldown. Reads
 * `app_config.yahoo_au_rerun_cooldown_ms` (BIGINT, NULL = use env). Default
 * 30 min protects the Yahoo budget on operator re-clicks of the AU "Re-run
 * now" button (which kicks BOTH catalog warm-up AND monitored refresh).
 */
export function getEffectiveYahooAuRerunCooldownMs(): number {
  return (
    getAppConfigCacheEntry()?.yahooAuRerunCooldownMs ??
    Env.YAHOO_AU_RERUN_COOLDOWN_MS
  );
}

/**
 * KZO-197 — per-provider rerun-cooldown resolver. Dispatch table:
 *   - `'yahoo-finance-au'` → `getEffectiveYahooAuRerunCooldownMs()` (30 min default)
 *   - everything else      → `getEffectiveRerunCooldownMs()` (60 s default)
 *
 * Per `.claude/rules/capability-flag-polarity.md`: this is an explicit positive
 * dispatch keyed on a known provider id, NOT the negation of a capability. The
 * dispatch is exhaustive enough — adding more per-provider overrides (KZO-204)
 * extends this switch without the polarity trap.
 */
export function getEffectiveProviderRerunCooldownMs(providerId: string): number {
  if (providerId === "yahoo-finance-au") {
    return getEffectiveYahooAuRerunCooldownMs();
  }
  return getEffectiveRerunCooldownMs();
}
