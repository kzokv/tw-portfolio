import type { PgBoss } from "pg-boss";
import type { Persistence } from "../../persistence/types.js";
import type { BackfillJobData } from "./backfillWorker.js";
import { BACKFILL_QUEUE } from "./backfillWorker.js";

export const DAILY_REFRESH_LOOKBACK_DAYS = 7;
export const DAILY_REFRESH_PRIORITY = 10;

export function getDailyRefreshStartDate(now: Date = new Date()): string {
  const startDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  startDate.setUTCDate(startDate.getUTCDate() - DAILY_REFRESH_LOOKBACK_DAYS);
  return startDate.toISOString().slice(0, 10);
}

export async function enqueueDailyRefresh(
  boss: Pick<PgBoss, "send">,
  persistence: Pick<Persistence, "getAllMonitoredTickers" | "createRefreshBatch">,
  log: { info: (...args: unknown[]) => void },
): Promise<number> {
  const tickers = await persistence.getAllMonitoredTickers();
  if (tickers.length === 0) {
    log.info("daily_refresh_enqueue_skipped: no monitored tickers");
    return 0;
  }

  const batchId = await persistence.createRefreshBatch(null, tickers.length);

  const startDate = getDailyRefreshStartDate();
  await Promise.all(
    // KZO-185: producer stamps `marketCode` from the persistence result; the
    // worker's Zod schema rejects any old-shape job. `singletonKey` is the
    // composite `${ticker}:${marketCode}` so BHP/AU and BHP/US don't collide.
    tickers.map(({ ticker, marketCode }) =>
      boss.send(
        BACKFILL_QUEUE,
        { ticker, marketCode: marketCode as BackfillJobData["marketCode"], trigger: "daily_refresh", startDate, batchId } satisfies BackfillJobData,
        { priority: DAILY_REFRESH_PRIORITY, singletonKey: `${ticker}:${marketCode}` },
      ),
    ),
  );

  log.info({ tickers: tickers.length, startDate, batchId }, "daily_refresh_enqueued");
  return tickers.length;
}
