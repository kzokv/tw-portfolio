export const RECOMPUTE_RUNNING_LEASE_MS = 5 * 60 * 1000;

export function isRecomputeRunningLeaseExpired(startedAt: string | undefined, now: Date): boolean {
  if (!startedAt) return false;
  const startedAtMs = new Date(startedAt).getTime();
  return Number.isFinite(startedAtMs) && startedAtMs + RECOMPUTE_RUNNING_LEASE_MS <= now.getTime();
}

export function recomputeRunningLeaseCutoff(startedAt: string): string {
  const startedAtMs = new Date(startedAt).getTime();
  if (!Number.isFinite(startedAtMs)) throw new Error("Invalid recompute startedAt timestamp");
  return new Date(startedAtMs - RECOMPUTE_RUNNING_LEASE_MS).toISOString();
}
