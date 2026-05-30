// KZO-177 — daily prune of `market_data.provider_error_trail` rows older than
// 30 days. Mirrors the `registerXEviction(app)` factory pattern documented in
// `.claude/rules/fastify-eviction-lifecycle-pattern.md` — setInterval + paired
// onClose cleanup, encapsulated behind a single registration helper.

import type { FastifyInstance } from "fastify";
import type { Persistence } from "../persistence/types.js";
import {
  PROVIDER_ERROR_TRAIL_RETENTION_DAYS,
  purgeProviderErrorTrail,
} from "../services/market-data/providerErrorTrailPurge.js";
import { getEffectiveErrorTrailRetentionDays } from "../services/appConfig/providerHealth.js";

/** 24 hours. */
const PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000;
export { PROVIDER_ERROR_TRAIL_RETENTION_DAYS };

export function registerProviderErrorTrailPurge(
  app: FastifyInstance & { persistence: Persistence },
): void {
  const timer = setInterval(() => {
    void runPurgeOnce(app);
  }, PURGE_INTERVAL_MS);
  app.addHook("onClose", () => clearInterval(timer));
}

async function runPurgeOnce(
  app: FastifyInstance & { persistence: Persistence },
): Promise<void> {
  try {
    // KZO-198: read live (DB override → env). Each periodic run picks up the
    // current effective retention without a process restart.
    const retentionDays = getEffectiveErrorTrailRetentionDays();
    const removed = await purgeProviderErrorTrail(
      app.persistence,
      retentionDays,
    );
    if (removed > 0) {
      app.log.info(
        { removed, retentionDays },
        "provider_error_trail_purged",
      );
    }
  } catch (err) {
    app.log.warn({ err }, "provider_error_trail_purge_failed");
  }
}
