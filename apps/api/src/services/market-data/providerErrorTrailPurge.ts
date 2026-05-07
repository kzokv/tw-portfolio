// KZO-177 — pure purge function for the provider error trail.
//
// This module is the test-friendly entry point used by integration tests.
// The Fastify-lifecycle wrapper (setInterval + onClose teardown) lives in
// `apps/api/src/lib/providerErrorTrailPurge.ts` and delegates here.

import type { Persistence } from "../../persistence/types.js";

export const PROVIDER_ERROR_TRAIL_RETENTION_DAYS = 30;

export interface PurgeOptions {
  /** Time-based cutoff in milliseconds. Rows older than `olderThanMs` are deleted. */
  olderThanMs?: number;
  /** Convenience: equivalent to `{ olderThanMs: olderThanDays * 86_400_000 }`. */
  olderThanDays?: number;
}

/**
 * Delete provider_error_trail rows older than the configured cutoff. Returns
 * the number of rows deleted. Default cutoff is 30 days.
 */
export async function purgeProviderErrorTrail(
  persistence: Pick<Persistence, "pruneOldProviderErrorTrail">,
  options: PurgeOptions | number = {},
): Promise<number> {
  let olderThanDays: number;
  if (typeof options === "number") {
    olderThanDays = options;
  } else if (typeof options.olderThanDays === "number") {
    olderThanDays = options.olderThanDays;
  } else if (typeof options.olderThanMs === "number") {
    olderThanDays = options.olderThanMs / (24 * 60 * 60 * 1000);
  } else {
    olderThanDays = PROVIDER_ERROR_TRAIL_RETENTION_DAYS;
  }
  return persistence.pruneOldProviderErrorTrail(olderThanDays);
}
