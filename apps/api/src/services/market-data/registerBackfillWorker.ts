import type { AppInstance } from "../../app.js";
import type { PgBoss } from "pg-boss";
import { BACKFILL_QUEUE, createBackfillHandler } from "./backfillWorker.js";
import {
  getEffectiveBackfillRetryLimit,
  getEffectiveBackfillRetryDelaySeconds,
} from "../appConfig/backfill.js";

export const DEFAULT_MARKET_DATA_QUEUE_OPTIONS = {
  policy: "stately",
  retryLimit: 3,
  retryDelay: 60,
  retryBackoff: true,
  expireInSeconds: 600,
} as const;

export async function registerBackfillWorker(
  app: AppInstance,
  boss: PgBoss,
  deps: Parameters<typeof createBackfillHandler>[0],
): Promise<void> {
  // KZO-198: read effective retryLimit / retryDelay at registration time
  // (DB override → env). Cache pre-warm runs in `app.ready()`, which fires
  // before pg-boss workers are registered, so any DB override is honored.
  // Retries are queue-level pg-boss state — changing them mid-flight is not
  // supported by pg-boss; this matches the eviction-cadence pattern in
  // `fastify-eviction-lifecycle-pattern.md` (read once, then static).
  const queueOptions = {
    ...DEFAULT_MARKET_DATA_QUEUE_OPTIONS,
    retryLimit: getEffectiveBackfillRetryLimit(),
    retryDelay: getEffectiveBackfillRetryDelaySeconds(),
  };
  await boss.createQueue(BACKFILL_QUEUE, queueOptions);
  await boss.work(BACKFILL_QUEUE, { batchSize: 1, includeMetadata: true }, createBackfillHandler(deps));
  app.log.info("backfill worker registered");
}
