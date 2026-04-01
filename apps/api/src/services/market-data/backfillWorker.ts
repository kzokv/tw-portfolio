import type { Pool } from "pg";
import type { PgBoss, JobWithMetadata } from "pg-boss";
import type { BackfillStatus } from "@tw-portfolio/domain";
import type { BufferedEventBus } from "../../events/index.js";
import type { FinMindProvider } from "./types.js";
import type { RateLimiter } from "./rateLimiter.js";
import { HISTORY_START } from "./types.js";
import { upsertDailyBars, upsertDividendEvents } from "./upserts.js";

export const BACKFILL_QUEUE = "finmind-backfill";

export interface BackfillJobData {
  ticker: string;
  userId?: string;
  trigger: "user_selection" | "first_trade" | "retry" | "daily_refresh";
  startDate?: string;
}

export interface BackfillWorkerDeps {
  pool: Pool;
  finmind: FinMindProvider;
  rateLimiter: RateLimiter;
  eventBus: BufferedEventBus;
  boss: PgBoss;
  updateBackfillStatus: (ticker: string, status: BackfillStatus) => Promise<void>;
  getUsersMonitoringTicker: (ticker: string) => Promise<string[]>;
  log: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
}

/** Number of FinMind API calls per ticker (bars + dividends). */
const CALLS_PER_TICKER = 2;

export function createBackfillHandler(deps: BackfillWorkerDeps) {
  const { pool, finmind, rateLimiter, eventBus, boss, updateBackfillStatus, getUsersMonitoringTicker, log } = deps;

  return async ([job]: JobWithMetadata<BackfillJobData>[]): Promise<void> => {
    const { ticker, userId, trigger, startDate } = job.data;
    const effectiveStartDate = startDate ?? HISTORY_START;
    const isDailyRefresh = trigger === "daily_refresh";

    // 1. Check rate limiter — if budget exhausted, reschedule (not a retry)
    if (!rateLimiter.canConsume(CALLS_PER_TICKER)) {
      const delayMs = rateLimiter.msUntilAvailable(CALLS_PER_TICKER);
      const delaySec = Math.ceil(delayMs / 1000);
      log.info({ ticker, trigger, delaySec }, "backfill_rate_limited: rescheduling");
      await boss.send(BACKFILL_QUEUE, job.data, {
        startAfter: delaySec,
        singletonKey: ticker,
        priority: job.priority ?? 0,
      });
      return; // Complete current job successfully — this is NOT a retry
    }

    rateLimiter.consume(CALLS_PER_TICKER);

    try {
      if (!isDailyRefresh) {
        await updateBackfillStatus(ticker, "backfilling");
      }

      if (!isDailyRefresh && userId) {
        await eventBus.publishEvent(userId, "backfill_started", { ticker });
      }

      // 4. Fetch daily bars from FinMind
      log.info({ ticker, trigger, startDate: effectiveStartDate }, "backfill_fetching_bars");
      const bars = await finmind.fetchDailyBars(ticker, effectiveStartDate);

      // 5. Write bars to market_data.daily_bars (upsert)
      const barsCount = await upsertDailyBars(pool, bars);
      log.info({ ticker, barsCount }, "backfill_bars_upserted");

      // 6. Fetch dividend events from FinMind
      let dividendsCount = 0;
      try {
        const dividends = await finmind.fetchDividendEvents(ticker, effectiveStartDate);
        // 7. Write dividend events (dividend failure → log warning, don't fail job)
        dividendsCount = await upsertDividendEvents(pool, dividends);
        log.info({ ticker, dividendsCount }, "backfill_dividends_upserted");
      } catch (divErr) {
        log.warn({ ticker, error: divErr }, "backfill_dividend_fetch_failed: continuing without dividends");
      }

      // 8. Update status → ready, update last_synced_at
      await updateBackfillStatus(ticker, "ready");

      if (isDailyRefresh) {
        const userIds = await getUsersMonitoringTicker(ticker);
        await Promise.all(
          userIds.map((monitoringUserId) =>
            eventBus.publishEvent(monitoringUserId, "daily_refresh_complete", {
              ticker,
              barsCount,
              dividendsCount,
            }),
          ),
        );
      } else if (userId) {
        await eventBus.publishEvent(userId, "backfill_complete", {
          ticker,
          barsCount,
          dividendsCount,
        });
      }
    } catch (err) {
      const isLastRetry = job.retryCount >= job.retryLimit;
      const reason = err instanceof Error ? err.message : String(err);

      if (isLastRetry && !isDailyRefresh) {
        await updateBackfillStatus(ticker, "failed");
      }

      if (isDailyRefresh) {
        if (isLastRetry) {
          const userIds = await getUsersMonitoringTicker(ticker);
          await Promise.all(
            userIds.map((monitoringUserId) =>
              eventBus.publishEvent(monitoringUserId, "daily_refresh_failed", {
                ticker,
                reason,
              }),
            ),
          );
        }
      } else if (userId) {
        await eventBus.publishEvent(userId, "backfill_failed", {
          ticker,
          reason,
          retriesExhausted: isLastRetry,
        });
      }

      throw err; // Re-throw so pg-boss handles retry
    }
  };
}
