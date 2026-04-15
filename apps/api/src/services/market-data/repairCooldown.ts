import { Env } from "@tw-portfolio/config";
import type { Persistence } from "../../persistence/types.js";

/**
 * Effective repair cooldown (KZO-133): DB value when set, else env fallback.
 * Single source of truth — repair route and DTO mapper decoration both call this.
 */
export async function getEffectiveRepairCooldownMinutes(
  persistence: Persistence,
): Promise<number> {
  const db = await persistence.getRepairCooldownMinutes();
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
