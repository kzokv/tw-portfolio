import { PgBoss } from "pg-boss";
import pg from "pg";
import { Env } from "@tw-portfolio/config";
import type { MarketCode } from "@tw-portfolio/domain";
import { registerBackfillWorker } from "../services/market-data/registerBackfillWorker.js";
import { CATALOG_SYNC_CRON, CATALOG_SYNC_QUEUE, registerCatalogSyncWorker } from "../services/market-data/registerCatalogSyncWorker.js";
import { getEffectiveMetadataEnrichmentMode } from "../services/appConfig/metadataEnrichmentMode.js";
import { FX_REFRESH_CRON, FX_REFRESH_QUEUE } from "../services/market-data/fxRefreshWorker.js";
import { registerFxRefreshWorker } from "../services/market-data/registerFxRefreshWorker.js";
import {
  ANONYMOUS_SHARE_TOKEN_PURGE_CRON,
  ANONYMOUS_SHARE_TOKEN_PURGE_QUEUE,
  registerAnonymousShareTokenPurgeWorker,
} from "../services/registerAnonymousShareTokenPurgeWorker.js";
import { handleBatchComplete } from "../services/notificationService.js";
import type { AppInstance } from "../app.js";

/**
 * Initialize pg-boss job queue and register the backfill worker.
 * Skipped entirely when persistence backend is memory (no Postgres available).
 */
export async function registerPgBoss(app: AppInstance, persistenceOverride?: string): Promise<void> {
  const backend = persistenceOverride ?? Env.PERSISTENCE_BACKEND;
  if (backend === "memory") {
    app.boss = null;
    return;
  }

  const connectionString = Env.getDatabaseUrl();

  const boss = new PgBoss({ connectionString, application_name: "tw-portfolio-boss" });
  boss.on("error", (err: Error) => app.log.error(err, "pg-boss error"));

  await boss.start();

  // Data pool for backfill worker SQL operations
  const pool = new pg.Pool({ connectionString, max: 2, application_name: "tw-portfolio-backfill" });

  // KZO-163: providers + rate limiters now live inside `app.marketDataRegistry` (built in app.ts).
  // The backfill worker takes the marketData map; the catalog-sync worker takes the catalog map.
  const backfillDeps = {
    pool,
    marketDataRegistry: app.marketDataRegistry.marketData,
    // KZO-172: catalog registry threaded so the handler can call
    // `fetchInstrumentMetadata(ticker)` after bars+dividends. AU's same-instance
    // registration in both maps means the rate-limiter budget is shared.
    catalogRegistry: app.marketDataRegistry.catalog,
    // KZO-172: `persistence.upsertInstrumentCatalog([row], [])` writes the enriched
    // catalog row. The handler limits this to a single row per backfill, mirroring the
    // catalog-sync upsert path but scoped to one ticker.
    persistence: app.persistence,
    // KZO-170: `resolveMarketCode` deleted — `/market-data/price` now requires
    // `market_code` as a query param, producers stamp `marketCode` directly on
    // `BackfillJobData`, and the worker validates the marketCode via Zod at
    // handler entry. Nothing references `marketResolution.ts` post-KZO-170.
    eventBus: app.eventBus,
    boss,
    // KZO-189: AU metadata enrichment gate — read every job (no cache) so admin
    // toggles take effect on the next backfill. Hybrid env+DB resolution.
    getEffectiveMetadataEnrichmentMode: () => Promise.resolve(getEffectiveMetadataEnrichmentMode()),
    updateBackfillStatus: (ticker: string, status: import("@tw-portfolio/domain").BackfillStatus) =>
      app.persistence.updateBackfillStatus(ticker, status),
    updateLastRepairAt: (ticker: string) => app.persistence.updateLastRepairAt(ticker),
    getUsersMonitoringTicker: (ticker: string) => app.persistence.getUsersMonitoringTicker(ticker),
    createNotification: (notification: Parameters<typeof app.persistence.createNotification>[0]) =>
      app.persistence.createNotification(notification),
    updateBatchTickerResult: (
      batchId: string,
      ticker: string,
      result: { status: "success" | "failed"; barsCount?: number; dividendsCount?: number; reason?: string },
    ) => app.persistence.updateBatchTickerResult(batchId, ticker, result),
    onBatchComplete: async (batchId: string) => {
      const batch = await app.persistence.getRefreshBatch(batchId);
      if (!batch) return;
      const finalStatus = batch.jobsFailed > 0 ? "failed" as const : "completed" as const;
      await app.persistence.completeRefreshBatch(batchId, finalStatus);
      await handleBatchComplete({
        persistence: app.persistence,
        eventBus: app.eventBus,
        batchId,
        tickerResults: batch.tickerResults,
        log: app.log,
      });
    },
    onBarsUpserted: (market: MarketCode, dates: ReadonlyArray<string>) => {
      app.tradingCalendarCache.notifyBarsUpserted(market, dates);
    },
    // KZO-177: feed provider outcomes (success/error/rate_limit) into the
    // health aggregator. Decorated by `registerProviderHealth(app)` in app.ts.
    providerHealth: app.providerHealth,
    log: app.log,
  };

  const catalogDeps = {
    boss,
    catalogRegistry: app.marketDataRegistry.catalog,
    persistence: app.persistence,
    log: app.log,
    // KZO-200: feed catalog-sync outcomes into the health aggregator. AU is
    // attributed to `twelve-data-au` (KZO-194 catalog provider); TW/US share
    // their bars provider id (`finmind-tw`/`finmind-us`).
    providerHealth: app.providerHealth,
  };

  await registerBackfillWorker(app, boss, backfillDeps);
  await registerCatalogSyncWorker(app, boss, catalogDeps);
  await boss.schedule(CATALOG_SYNC_QUEUE, CATALOG_SYNC_CRON, {});
  // KZO-194: kick the catalog-sync queue once on startup so a fresh deploy doesn't
  // wait up to 72h (Fri afternoon → Mon 17:30 UTC, the next CATALOG_SYNC_CRON tick)
  // for the AU catalog to populate. Pre-KZO-194, AU shipped a hardcoded 7-row
  // reserved set so an empty `instruments` table was acceptable post-deploy. Now
  // the AU catalog comes entirely from `TwelveDataAuCatalogProvider`'s upstream
  // call — without this startup-tick, the AU catalog stays empty until the cron
  // fires. Singleton policy collapses duplicate kicks from concurrent restarts.
  await boss.send(CATALOG_SYNC_QUEUE, {}, { singletonKey: CATALOG_SYNC_QUEUE });

  // KZO-164: Frankfurter FX rate ingestion. Singleton policy ensures concurrent
  // manual triggers (and overlapping cron + manual) coalesce. Cron schedule sends
  // an empty payload; the worker normalizes that to `trigger='cron'` and re-derives
  // the date window via `getLatestFxRateDate()`.
  const fxDeps = {
    fxProvider: app.marketDataRegistry.fxRate,
    persistence: app.persistence,
    log: app.log,
    // KZO-177: feed Frankfurter outcomes into the health aggregator.
    providerHealth: app.providerHealth,
  };
  await registerFxRefreshWorker(app, boss, fxDeps);
  await boss.schedule(FX_REFRESH_QUEUE, FX_REFRESH_CRON, {});

  const purgeCutoffMs = Env.ANONYMOUS_SHARE_TOKEN_PURGE_DAYS * 24 * 60 * 60 * 1000;
  await registerAnonymousShareTokenPurgeWorker(app, boss, {
    persistence: app.persistence,
    cutoffMs: purgeCutoffMs,
    log: app.log,
  });
  await boss.schedule(ANONYMOUS_SHARE_TOKEN_PURGE_QUEUE, ANONYMOUS_SHARE_TOKEN_PURGE_CRON, {});

  app.boss = boss;

  app.addHook("onClose", async () => {
    await boss.stop({ graceful: true, timeout: 10_000 });
    await pool.end();
  });

  app.log.info("pg-boss started, market-data workers registered");
}
