import type { JobWithMetadata, PgBoss } from "pg-boss";
import type { MarketCode } from "@tw-portfolio/domain";
import type { AppInstance } from "../../app.js";
import type { Persistence } from "../../persistence/types.js";
import type { InstrumentCatalogProvider } from "./types.js";
import { RateLimitedError } from "./types.js";
import { runCatalogSync } from "./runCatalogSync.js";
import { enqueueDailyRefresh } from "./dailyRefreshEnqueue.js";
import { DEFAULT_MARKET_DATA_QUEUE_OPTIONS } from "./registerBackfillWorker.js";

export const CATALOG_SYNC_QUEUE = "catalog-sync";
export const CATALOG_SYNC_CRON = "30 17 * * 1-5";
const CATALOG_SYNC_QUEUE_OPTIONS = {
  ...DEFAULT_MARKET_DATA_QUEUE_OPTIONS,
  policy: "singleton",
} as const;

export interface CatalogSyncWorkerDeps {
  boss: Pick<PgBoss, "send">;
  /** Per-market catalog registry. Replaces the `finmind` + `rateLimiter` deps (KZO-163). */
  catalogRegistry: Map<MarketCode, InstrumentCatalogProvider>;
  persistence: Pick<Persistence, "upsertInstrumentCatalog" | "getAllMonitoredTickers" | "createRefreshBatch">;
  log: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
  enqueueDailyRefreshFn?: typeof enqueueDailyRefresh;
  runCatalogSyncFn?: typeof runCatalogSync;
}

export function createCatalogSyncHandler(deps: CatalogSyncWorkerDeps) {
  const { boss, catalogRegistry, persistence, log } = deps;
  const enqueueDailyRefreshFn = deps.enqueueDailyRefreshFn ?? enqueueDailyRefresh;
  const runCatalogSyncFn = deps.runCatalogSyncFn ?? runCatalogSync;

  return async ([job]: JobWithMetadata<Record<string, never>>[]): Promise<void> => {
    let rescheduled = false;
    try {
      // KZO-163: iterate over every registered market. For KZO-163 this is a single
      // entry ('TW'); future markets (KZO-170 US) plug in here without code changes.
      for (const [, catalogProvider] of catalogRegistry) {
        // KZO-163 HIGH-1 fix: pre-reserve 2 slots (catalog + delisting) to prevent starvation
        // under one-slot-at-a-time rate-limit replenishment. Without this, catalog could
        // consume the single newly-freed slot, delisting throws RateLimitedError, the job
        // reschedules, and we redo the catalog call only to fail again on delisting forever.
        catalogProvider.reserveCapacity(2);
        await runCatalogSyncFn({ catalogProvider, persistence, log });
      }
      log.info("catalog_sync_completed");
    } catch (error) {
      // KZO-163: provider rate limit → reschedule the whole job (single-provider today;
      // architect-approved default. KZO-170 may switch to per-market reschedule).
      if (error instanceof RateLimitedError) {
        const delaySec = error.retryAfterSeconds;
        log.info({ delaySec }, "catalog_sync_rate_limited: rescheduling");
        const id = await boss.send(CATALOG_SYNC_QUEUE, job.data, {
          startAfter: delaySec,
          singletonKey: CATALOG_SYNC_QUEUE,
          priority: 0,
        });
        // KZO-163 MEDIUM-2: log when singleton policy drops the reschedule (existing job
        // already covers this work). The existing job will run on its own schedule.
        if (id === null) {
          log.warn({ delaySec }, "catalog_sync_rate_limit_reschedule_dropped: existing singleton covers this work");
        }
        rescheduled = true;
        return;
      }
      log.error({ error }, "catalog_sync_failed");
      throw error;
    } finally {
      // Don't enqueue a daily refresh while the catalog sync is paused for rate-limit reschedule.
      if (!rescheduled) {
        await enqueueDailyRefreshFn(boss, persistence, log);
      }
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
