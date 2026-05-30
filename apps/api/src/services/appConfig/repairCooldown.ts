import { Env } from "@vakwen/config";
import { getAppConfigCacheEntry } from "./cache.js";

/**
 * Effective repair cooldown (KZO-133, migrated to KZO-198 cache layer): DB
 * value when set, else env fallback. Single source of truth — repair route
 * and DTO mapper decoration both call this.
 *
 * Reads from the `app_config` TTL cache (`getAppConfigCacheEntry()`) — no
 * `persistence` parameter. Cache miss / pending / load-failure → env fallback.
 */
export function getEffectiveRepairCooldownMinutes(): number {
  const db = getAppConfigCacheEntry()?.repairCooldownMinutes ?? null;
  return db ?? Env.REPAIR_COOLDOWN_MINUTES;
}

/**
 * Derive the earliest ISO timestamp at which a ticker's bars can be repaired.
 * Returns null when no prior repair has occurred (immediately repairable).
 */
export function deriveRepairAvailableAt(
  lastRepairAt: string | null | undefined,
  effectiveCooldownMinutes: number,
): string | null {
  if (!lastRepairAt) return null;
  const t = new Date(lastRepairAt).getTime();
  if (Number.isNaN(t)) return null;
  return new Date(t + effectiveCooldownMinutes * 60_000).toISOString();
}

/**
 * Remaining minutes until the repair cooldown expires.
 * Returns 0 when the cooldown has expired or the date is invalid.
 * Uses Math.ceil so a partial minute counts as a full minute of remaining time.
 */
export function remainingCooldownMinutes(lastRepairAt: string, cooldownMinutes: number, nowMs: number): number {
  const repairedAtMs = new Date(lastRepairAt).getTime();
  if (Number.isNaN(repairedAtMs)) return 0;
  const cooldownUntilMs = repairedAtMs + cooldownMinutes * 60_000;
  if (nowMs >= cooldownUntilMs) return 0;
  return Math.ceil((cooldownUntilMs - nowMs) / 60_000);
}
