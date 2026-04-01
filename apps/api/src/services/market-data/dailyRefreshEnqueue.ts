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
  persistence: Pick<Persistence, "getAllMonitoredTickers">,
  log: { info: (...args: unknown[]) => void },
): Promise<number> {
  const tickers = await persistence.getAllMonitoredTickers();
  if (tickers.length === 0) {
    log.info("daily_refresh_enqueue_skipped: no monitored tickers");
    return 0;
  }

  const startDate = getDailyRefreshStartDate();
  await Promise.all(
    tickers.map((ticker) =>
      boss.send(
        BACKFILL_QUEUE,
        { ticker, trigger: "daily_refresh", startDate } satisfies BackfillJobData,
        { priority: DAILY_REFRESH_PRIORITY, singletonKey: ticker },
      ),
    ),
  );

  log.info({ tickers: tickers.length, startDate }, "daily_refresh_enqueued");
  return tickers.length;
}
