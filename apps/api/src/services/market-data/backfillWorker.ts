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
  trigger: "user_selection" | "first_trade" | "retry" | "daily_refresh" | "repair";
  startDate?: string;
  endDate?: string;
  includeBars?: boolean;
  includeDividends?: boolean;
  batchId?: string;
}

export interface BackfillWorkerDeps {
  pool: Pool;
  finmind: FinMindProvider;
  rateLimiter: RateLimiter;
  eventBus: BufferedEventBus;
  boss: PgBoss;
  updateBackfillStatus: (ticker: string, status: BackfillStatus) => Promise<void>;
  updateLastRepairAt?: (ticker: string) => Promise<void>;
  getUsersMonitoringTicker: (ticker: string) => Promise<string[]>;
  updateBatchTickerResult?: (
    batchId: string,
    ticker: string,
    result: { status: "success" | "failed"; barsCount?: number; dividendsCount?: number; reason?: string },
  ) => Promise<{ jobsSucceeded: number; jobsFailed: number; jobsTotal: number } | null>;
  onBatchComplete?: (batchId: string) => Promise<void>;
  log: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
}

const MAX_CALLS_PER_TICKER = 2;

function computeCallCost(includeBars: boolean, includeDividends: boolean): number {
  const requestedCalls = (includeBars ? 1 : 0) + (includeDividends ? 1 : 0);
  return Math.min(MAX_CALLS_PER_TICKER, Math.max(0, requestedCalls));
}

export function createBackfillHandler(deps: BackfillWorkerDeps) {
  const {
    pool,
    finmind,
    rateLimiter,
    eventBus,
    boss,
    updateBackfillStatus,
    updateLastRepairAt,
    getUsersMonitoringTicker,
    updateBatchTickerResult,
    onBatchComplete,
    log,
  } = deps;

  return async ([job]: JobWithMetadata<BackfillJobData>[]): Promise<void> => {
    const { ticker, userId, trigger, startDate, endDate, includeBars = true, includeDividends = true, batchId } = job.data;
    const effectiveStartDate = startDate ?? HISTORY_START;
    const isDailyRefresh = trigger === "daily_refresh";
    const isRepair = trigger === "repair";
    const shouldSetBackfillingStatus = !isDailyRefresh && !isRepair;
    const shouldSetReadyStatus = !isRepair;
    const shouldSetFailedStatus = !isDailyRefresh && !isRepair;
    const callCost = computeCallCost(includeBars, includeDividends);

    if (callCost <= 0) {
      throw new Error("Backfill job must request at least one dataset");
    }

    // 1. Check rate limiter — if budget exhausted, reschedule (not a retry)
    if (!rateLimiter.canConsume(callCost)) {
      const delayMs = rateLimiter.msUntilAvailable(callCost);
      const delaySec = Math.ceil(delayMs / 1000);
      log.info({ ticker, trigger, callCost, delaySec }, "backfill_rate_limited: rescheduling");
      await boss.send(BACKFILL_QUEUE, job.data, {
        startAfter: delaySec,
        singletonKey: ticker,
        priority: job.priority ?? 0,
      });
      return; // Complete current job successfully — this is NOT a retry
    }

    rateLimiter.consume(callCost);

    try {
      if (shouldSetBackfillingStatus) {
        await updateBackfillStatus(ticker, "backfilling");
      }

      if (isRepair && userId) {
        await eventBus.publishEvent(userId, "repair_started", { ticker });
      } else if (!isDailyRefresh && userId) {
        await eventBus.publishEvent(userId, "backfill_started", { ticker });
      }

      let barsCount = 0;
      if (includeBars) {
        log.info({ ticker, trigger, startDate: effectiveStartDate, endDate }, "backfill_fetching_bars");
        const bars = await finmind.fetchDailyBars(ticker, effectiveStartDate, endDate);

        // 5. Write bars to market_data.daily_bars (upsert)
        barsCount = await upsertDailyBars(pool, bars);
        log.info({ ticker, barsCount }, "backfill_bars_upserted");
      }

      // 6. Fetch dividend events from FinMind
      let dividendsCount = 0;
      if (includeDividends) {
        try {
          const dividends = await finmind.fetchDividendEvents(ticker, effectiveStartDate, endDate);
          // 7. Write dividend events (dividend failure → log warning, don't fail job)
          dividendsCount = await upsertDividendEvents(pool, dividends);
          log.info({ ticker, dividendsCount }, "backfill_dividends_upserted");
        } catch (divErr) {
          log.warn({ ticker, error: divErr }, "backfill_dividend_fetch_failed: continuing without dividends");
        }
      }

      // 8. Update status for non-repair/non-daily-refresh jobs.
      if (shouldSetReadyStatus) {
        await updateBackfillStatus(ticker, "ready");
      }

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

        // Batch tracking: record success and check fan-in completion
        if (batchId && updateBatchTickerResult) {
          await trackBatchResult(batchId, ticker, { status: "success", barsCount, dividendsCount }, log);
        }
      } else if (isRepair && userId) {
        if (updateLastRepairAt) {
          await updateLastRepairAt(ticker);
        }
        await eventBus.publishEvent(userId, "repair_complete", {
          ticker,
          barsCount,
          dividendsCount,
        });
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

      if (isLastRetry && shouldSetFailedStatus) {
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

          // Batch tracking: record failure and check fan-in completion
          if (batchId && updateBatchTickerResult) {
            await trackBatchResult(batchId, ticker, { status: "failed", reason }, log);
          }
        }
      } else if (isRepair && userId) {
        await eventBus.publishEvent(userId, "repair_failed", {
          ticker,
          reason,
          retriesExhausted: isLastRetry,
        });
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

  async function trackBatchResult(
    batchId: string,
    ticker: string,
    result: { status: "success" | "failed"; barsCount?: number; dividendsCount?: number; reason?: string },
    logger: BackfillWorkerDeps["log"],
  ): Promise<void> {
    try {
      const counters = await updateBatchTickerResult!(batchId, ticker, result);
      if (!counters) {
        logger.warn({ batchId, ticker }, "batch_ticker_result_update_failed: batch not found");
        return;
      }

      // Fan-in complete: all jobs reported back
      if (counters.jobsSucceeded + counters.jobsFailed >= counters.jobsTotal && onBatchComplete) {
        logger.info({ batchId, ...counters }, "batch_fan_in_complete");
        await onBatchComplete(batchId);
      }
    } catch (err) {
      logger.warn({ batchId, ticker, err }, "batch_result_tracking_failed");
    }
  }
}
