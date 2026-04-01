import type { AppInstance } from "../../app.js";
import type { PgBoss } from "pg-boss";
import { BACKFILL_QUEUE, createBackfillHandler } from "./backfillWorker.js";

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
  await boss.createQueue(BACKFILL_QUEUE, DEFAULT_MARKET_DATA_QUEUE_OPTIONS);
  await boss.work(BACKFILL_QUEUE, { batchSize: 1, includeMetadata: true }, createBackfillHandler(deps));
  app.log.info("backfill worker registered");
}
