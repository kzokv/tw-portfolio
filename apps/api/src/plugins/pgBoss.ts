import { PgBoss } from "pg-boss";
import pg from "pg";
import { Env } from "@tw-portfolio/config";
import { BACKFILL_QUEUE, createBackfillHandler } from "../services/market-data/backfillWorker.js";
import { RateLimiter } from "../services/market-data/rateLimiter.js";
import { MockFinMindClient } from "../services/market-data/finmindClient.mock.js";
import { FinMindClient } from "../services/market-data/finmindClient.js";
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

  await boss.createQueue(BACKFILL_QUEUE, {
    policy: "stately",
    retryLimit: 3,
    retryDelay: 60,
    retryBackoff: true,
    expireInSeconds: 600, // 10 min max per job
  });

  // Data pool for backfill worker SQL operations
  const pool = new pg.Pool({ connectionString, max: 2, application_name: "tw-portfolio-backfill" });

  const rateLimiter = new RateLimiter();

  // Use real client if token is configured, mock otherwise
  const finmind = Env.FINMIND_API_TOKEN ? new FinMindClient() : new MockFinMindClient();

  const handler = createBackfillHandler({
    pool,
    finmind,
    rateLimiter,
    eventBus: app.eventBus,
    boss,
    updateBackfillStatus: (ticker, status) => app.persistence.updateBackfillStatus(ticker, status),
    log: app.log,
  });

  await boss.work(BACKFILL_QUEUE, { batchSize: 1, includeMetadata: true }, handler);

  app.boss = boss;

  app.addHook("onClose", async () => {
    await boss.stop({ graceful: true, timeout: 10_000 });
    await pool.end();
  });

  app.log.info("pg-boss started, backfill worker registered");
}
