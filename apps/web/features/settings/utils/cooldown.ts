/**
 * Returns the number of minutes remaining in the repair cooldown window,
 * or 0 if the cooldown has expired or no repair is in force.
 *
 * The server computes `repairAvailableAt` as `lastRepairAt + effectiveCooldown`
 * (see `deriveRepairAvailableAt` in apps/api). The client just compares to now.
 */
export function getCooldownRemainingMinutes(
  repairAvailableAt: string | null | undefined,
  now: Date = new Date(),
): number {
  if (!repairAvailableAt) return 0;
  const target = new Date(repairAvailableAt).getTime();
  if (Number.isNaN(target)) return 0;
  const remaining = target - now.getTime();
  if (remaining <= 0) return 0;
  return Math.max(1, Math.ceil(remaining / 60_000));
}
