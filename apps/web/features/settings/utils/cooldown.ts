const DEFAULT_COOLDOWN_MINUTES = 60;

/**
 * Returns the number of minutes remaining in the repair cooldown window,
 * or 0 if the cooldown has expired or no repair has been performed.
 */
export function getCooldownRemainingMinutes(
  lastRepairAt: string | null | undefined,
  now: Date = new Date(),
  cooldownMinutes: number = DEFAULT_COOLDOWN_MINUTES,
): number {
  if (!lastRepairAt) return 0;
  const parsed = new Date(lastRepairAt);
  if (Number.isNaN(parsed.getTime())) return 0;
  const cooldownMs = cooldownMinutes * 60 * 1000;
  const elapsed = now.getTime() - parsed.getTime();
  if (elapsed >= cooldownMs) return 0;
  return Math.max(1, Math.ceil((cooldownMs - elapsed) / (60 * 1000)));
}
