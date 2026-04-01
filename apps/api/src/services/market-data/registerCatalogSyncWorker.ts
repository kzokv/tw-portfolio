import type { JobWithMetadata, PgBoss } from "pg-boss";
import type { AppInstance } from "../../app.js";
import type { Persistence } from "../../persistence/types.js";
import type { CatalogSyncDeps } from "./runCatalogSync.js";
import type { RateLimiter } from "./rateLimiter.js";
import { runCatalogSync } from "./runCatalogSync.js";
import { enqueueDailyRefresh } from "./dailyRefreshEnqueue.js";
import { DEFAULT_MARKET_DATA_QUEUE_OPTIONS } from "./registerBackfillWorker.js";

export const CATALOG_SYNC_QUEUE = "catalog-sync";
export const CATALOG_SYNC_CRON = "30 17 * * 1-5";
const CATALOG_SYNC_CALLS = 2;
const CATALOG_SYNC_QUEUE_OPTIONS = {
  ...DEFAULT_MARKET_DATA_QUEUE_OPTIONS,
  policy: "singleton",
} as const;

export interface CatalogSyncWorkerDeps extends CatalogSyncDeps {
  boss: Pick<PgBoss, "send">;
  rateLimiter: RateLimiter;
  persistence: Pick<Persistence, "upsertInstrumentCatalog" | "getAllMonitoredTickers" | "createRefreshBatch">;
  enqueueDailyRefreshFn?: typeof enqueueDailyRefresh;
  runCatalogSyncFn?: typeof runCatalogSync;
}

export function createCatalogSyncHandler(deps: CatalogSyncWorkerDeps) {
  const { boss, rateLimiter, persistence, log } = deps;
  const enqueueDailyRefreshFn = deps.enqueueDailyRefreshFn ?? enqueueDailyRefresh;
  const runCatalogSyncFn = deps.runCatalogSyncFn ?? runCatalogSync;

  return async ([job]: JobWithMetadata<Record<string, never>>[]): Promise<void> => {
    if (!rateLimiter.canConsume(CATALOG_SYNC_CALLS)) {
      const delayMs = rateLimiter.msUntilAvailable(CATALOG_SYNC_CALLS);
      const delaySec = Math.ceil(delayMs / 1000);
      log.info({ delaySec }, "catalog_sync_rate_limited: rescheduling");
      await boss.send(CATALOG_SYNC_QUEUE, job.data, {
        startAfter: delaySec,
        singletonKey: CATALOG_SYNC_QUEUE,
        priority: 0,
      });
      return;
    }

    rateLimiter.consume(CATALOG_SYNC_CALLS);

    try {
      const result = await runCatalogSyncFn(deps);
      log.info({ result }, "catalog_sync_completed");
    } catch (error) {
      log.error({ error }, "catalog_sync_failed");
      throw error;
    } finally {
      await enqueueDailyRefreshFn(boss, persistence, log);
    }
  };
}

export async function registerCatalogSyncWorker(
  app: AppInstance,
  boss: PgBoss,
  deps: CatalogSyncWorkerDeps,
): Promise<void> {
  await boss.createQueue(CATALOG_SYNC_QUEUE, CATALOG_SYNC_QUEUE_OPTIONS);
  await boss.work(CATALOG_SYNC_QUEUE, { batchSize: 1, includeMetadata: true }, createCatalogSyncHandler(deps));
  app.log.info("catalog sync worker registered");
}
