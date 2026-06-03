import type { PgBoss } from "pg-boss";
import type { MarketCode } from "@vakwen/domain";
import type { Persistence } from "../../persistence/types.js";
import type { BackfillJobData } from "./backfillWorker.js";
import { BACKFILL_QUEUE } from "./backfillWorker.js";
import {
  getEffectiveDailyRefreshLookbackDays,
  getEffectiveDailyRefreshPriority,
} from "../appConfig/backfill.js";

/**
 * @deprecated KZO-198 — prefer `getEffectiveDailyRefreshLookbackDays()` /
 * `getEffectiveDailyRefreshPriority()` from `services/appConfig/backfill.ts`.
 * Retained here as the back-compat env-default snapshot.
 */
export const DAILY_REFRESH_LOOKBACK_DAYS = 7;
export const DAILY_REFRESH_PRIORITY = 10;

export function getDailyRefreshStartDate(now: Date = new Date()): string {
  const startDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  // KZO-198: read live (DB override → env).
  startDate.setUTCDate(startDate.getUTCDate() - getEffectiveDailyRefreshLookbackDays());
  return startDate.toISOString().slice(0, 10);
}

export interface EnqueueDailyRefreshOptions {
  /**
   * KZO-177: when set, only tickers from `marketFilter` are enqueued. The admin
   * "Re-run now" button on `/admin/providers` uses this to scope the refresh
   * to a single provider's market. Daily-refresh cron passes no filter (all
   * markets are refreshed).
   */
  marketFilter?: MarketCode;
  /**
   * KZO-177: stamp the resulting `BackfillJobData.trigger`. Defaults to
   * `daily_refresh`. The admin "Re-run now" route passes `admin_rerun` so
   * downstream workers can distinguish operator-initiated runs from cron.
   */
  trigger?: BackfillJobData["trigger"];
  resolverMode?: BackfillJobData["resolverMode"];
}

export async function enqueueDailyRefresh(
  boss: Pick<PgBoss, "send">,
  persistence: Pick<Persistence, "getAllMonitoredTickers" | "createRefreshBatch">,
  log: { info: (...args: unknown[]) => void },
  options: EnqueueDailyRefreshOptions = {},
): Promise<{ tickerCount: number; batchId: string | null }> {
  const allTickers = await persistence.getAllMonitoredTickers();
  const filtered = options.marketFilter
    ? allTickers.filter((t) => t.marketCode === options.marketFilter)
    : allTickers;
  if (filtered.length === 0) {
    log.info(
      { marketFilter: options.marketFilter ?? null },
      "daily_refresh_enqueue_skipped: no monitored tickers",
    );
    return { tickerCount: 0, batchId: null };
  }

  const trigger: BackfillJobData["trigger"] = options.trigger ?? "daily_refresh";
  const batchId = await persistence.createRefreshBatch(null, filtered.length);

  const startDate = getDailyRefreshStartDate();
  await Promise.all(
    // KZO-185: producer stamps `marketCode` from the persistence result; the
    // worker's Zod schema rejects any old-shape job. `singletonKey` is the
    // composite `${ticker}:${marketCode}` so BHP/AU and BHP/US don't collide.
    filtered.map(({ ticker, marketCode }) =>
      boss.send(
        BACKFILL_QUEUE,
        {
          ticker,
          marketCode: marketCode as BackfillJobData["marketCode"],
          trigger,
          startDate,
          batchId,
          ...(options.resolverMode ? { resolverMode: options.resolverMode } : {}),
        } satisfies BackfillJobData,
        // KZO-198: read live (DB override → env).
        { priority: getEffectiveDailyRefreshPriority(), singletonKey: `${ticker}:${marketCode}` },
      ),
    ),
  );

  log.info(
    { tickers: filtered.length, startDate, batchId, trigger, marketFilter: options.marketFilter ?? null },
    "daily_refresh_enqueued",
  );
  return { tickerCount: filtered.length, batchId };
}
