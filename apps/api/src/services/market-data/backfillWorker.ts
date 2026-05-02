import type { Pool } from "pg";
import type { PgBoss, JobWithMetadata } from "pg-boss";
import type { BackfillStatus, MarketCode } from "@tw-portfolio/domain";
import { z } from "zod";
import type { BufferedEventBus } from "../../events/index.js";
import type { MarketDataProvider } from "./types.js";
import { historyStartFor, RateLimitedError } from "./types.js";
import { upsertDailyBars, upsertDividendEvents } from "./upserts.js";

export const BACKFILL_QUEUE = "finmind-backfill";

export interface BackfillJobData {
  ticker: string;
  // KZO-185: required after producer audit. Producers (snapshots/generate
  // auto-trigger, recompute/confirm auto-trigger, daily-refresh cron, manual
  // /market-data/backfill, /repair, /retry) all stamp `marketCode` directly.
  // The Zod schema below is the single validation gate at the worker entry.
  marketCode: MarketCode;
  userId?: string;
  trigger: "user_selection" | "first_trade" | "retry" | "daily_refresh" | "repair";
  startDate?: string;
  endDate?: string;
  includeBars?: boolean;
  includeDividends?: boolean;
  batchId?: string;
}

// KZO-185: validation gate at the handler entry. Parsed BEFORE the existing
// `try` block so a ZodError on a malformed (or pre-KZO-169 in-flight) job
// propagates straight to pg-boss without running side effects (status updates,
// SSE events, instrument writes). Per `.claude/rules/typed-transient-error-catch-audit.md`
// — the existing `catch` (further down) only re-throws non-RateLimitedError, so
// ZodError surfaces cleanly to pg-boss and the job retries up to retryLimit.
export const BackfillJobDataSchema = z.object({
  ticker: z.string(),
  marketCode: z.enum(["TW", "US", "AU"]),
  userId: z.string().optional(),
  trigger: z.enum(["user_selection", "first_trade", "retry", "daily_refresh", "repair"]),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  includeBars: z.boolean().optional(),
  includeDividends: z.boolean().optional(),
  batchId: z.string().optional(),
}) satisfies z.ZodType<BackfillJobData>;

export interface BackfillWorkerDeps {
  pool: Pool;
  /** Per-market market-data registry. Replaces the single-provider `finmind` dep (KZO-163). */
  marketDataRegistry: Map<MarketCode, MarketDataProvider>;
  eventBus: BufferedEventBus;
  boss: PgBoss;
  updateBackfillStatus: (ticker: string, status: BackfillStatus) => Promise<void>;
  updateLastRepairAt?: (ticker: string) => Promise<void>;
  getUsersMonitoringTicker: (ticker: string) => Promise<string[]>;
  createNotification?: (notification: {
    userId: string;
    severity: "info" | "warning" | "error";
    source: string;
    sourceRef?: string;
    title: string;
    body?: string;
    detail?: unknown;
  }) => Promise<string>;
  updateBatchTickerResult?: (
    batchId: string,
    ticker: string,
    result: { status: "success" | "failed"; barsCount?: number; dividendsCount?: number; reason?: string },
  ) => Promise<{ jobsSucceeded: number; jobsFailed: number; jobsTotal: number } | null>;
  onBatchComplete?: (batchId: string) => Promise<void>;
  log: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
}

export function createBackfillHandler(deps: BackfillWorkerDeps) {
  const {
    pool,
    marketDataRegistry,
    eventBus,
    boss,
    updateBackfillStatus,
    updateLastRepairAt,
    getUsersMonitoringTicker,
    createNotification,
    updateBatchTickerResult,
    onBatchComplete,
    log,
  } = deps;

  return async ([job]: JobWithMetadata<BackfillJobData>[]): Promise<void> => {
    // KZO-185: validate job.data BEFORE the existing try block so a ZodError
    // on a malformed (or pre-KZO-169 in-flight) job propagates straight to
    // pg-boss without running side effects (status updates, SSE events,
    // instrument writes). Per `.claude/rules/typed-transient-error-catch-audit.md`:
    // the catch on the try block below only re-throws non-RateLimitedError, so
    // ZodError surfaces cleanly to pg-boss and the job retries up to retryLimit.
    const data = BackfillJobDataSchema.parse(job.data);
    const { ticker, marketCode: market, userId, trigger, startDate, endDate, includeBars = true, includeDividends = true, batchId } = data;
    // KZO-170 D13: truncate caller-supplied `startDate` to the per-market provider boundary.
    // The TW provider serves bars from 1994-10-01; the US provider serves from 2019-06-01
    // (Phase-1 verified). Without truncation, a backfill request for a US ticker with
    // `startDate=2010-01-01` would round-trip through FinMind and silently return zero rows
    // (or worse, a 4xx) — producing a "ready" status with no data. Truncating at this layer
    // makes the boundary explicit and observable via `pre_provider_history_truncated`.
    const providerStartDate = historyStartFor(market);
    const effectiveStartDate = startDate && startDate >= providerStartDate ? startDate : providerStartDate;
    if (startDate && startDate < providerStartDate) {
      log.info(
        { ticker, marketCode: market, requestedStartDate: startDate, providerStartDate },
        "pre_provider_history_truncated",
      );
    }
    const isDailyRefresh = trigger === "daily_refresh";
    const isRepair = trigger === "repair";
    const shouldSetBackfillingStatus = !isDailyRefresh && !isRepair;
    const shouldSetReadyStatus = !isRepair;
    const shouldSetFailedStatus = !isDailyRefresh && !isRepair;

    if (!includeBars && !includeDividends) {
      throw new Error("Backfill job must request at least one dataset");
    }

    const provider = marketDataRegistry.get(market);
    if (!provider) {
      throw new Error(`No market data provider for market ${market}`);
    }

    // Helper: reschedule the current job after the rate limiter releases capacity. Returns
    // true once a reschedule is enqueued so the caller can short-circuit cleanly.
    async function rescheduleAfterRateLimit(err: RateLimitedError): Promise<void> {
      const delaySec = err.retryAfterSeconds;
      log.info({ ticker, trigger, delaySec }, "backfill_rate_limited: rescheduling");
      // KZO-169 (G3): singletonKey is composite `${ticker}:${marketCode}` so
      // BHP/AU and BHP/US don't share a slot.
      const singletonKey = `${ticker}:${market}`;
      // KZO-185: enqueue the parsed (validated) payload, not raw `job.data`.
      const id = await boss.send(BACKFILL_QUEUE, data, {
        startAfter: delaySec,
        singletonKey,
        priority: job.priority ?? 0,
      });
      // KZO-163 MEDIUM-2: singleton policy returns null when an existing job already covers
      // this ticker. Log so we can see drops without throwing — the existing job will run.
      if (id === null) {
        log.warn({ ticker, trigger, delaySec }, "backfill_rate_limit_reschedule_dropped: existing singleton covers this ticker");
      }
    }

    try {
      // KZO-163 HIGH-1 fix: pre-reserve rate-limit slots for the call count this invocation
      // will make (bars + dividends, optional). Without this, the dominant starvation pattern
      // is: bars consumes the only newly-freed slot, dividends throws RateLimitedError, the
      // job reschedules, and the cycle repeats indefinitely under one-slot-at-a-time
      // replenishment. Pre-reserving throws RateLimitedError upfront with msUntilAvailable
      // sized for the full call count, so the reschedule waits until ALL slots are free.
      const callCount = (includeBars ? 1 : 0) + (includeDividends ? 1 : 0);
      if (callCount > 1) {
        provider.reserveCapacity(callCount);
      }

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
        const bars = (await provider.fetchBars(ticker, effectiveStartDate, endDate))
          .map((bar) => ({ ...bar, marketCode: market }));

        // Write bars to market_data.daily_bars (upsert)
        barsCount = await upsertDailyBars(pool, bars);
        log.info({ ticker, barsCount }, "backfill_bars_upserted");
      }

      // Fetch dividend events from the provider
      let dividendsCount = 0;
      if (includeDividends) {
        try {
          const dividends = (await provider.fetchDividends(ticker, effectiveStartDate, endDate))
            .map((dividend) => ({ ...dividend, marketCode: market }));
          // Write dividend events (dividend failure → log warning, don't fail job)
          dividendsCount = await upsertDividendEvents(pool, dividends);
          log.info({ ticker, dividendsCount }, "backfill_dividends_upserted");
        } catch (divErr) {
          // KZO-163: must not let the warn-and-continue path swallow RateLimitedError.
          // The outer catch reschedules; re-throw here so it gets there.
          if (divErr instanceof RateLimitedError) {
            throw divErr;
          }
          // KZO-170 D14: stamp `provider` on every fetch-failure log so observability
          // can disambiguate per-provider failure patterns (e.g. finmind-tw 4xx vs.
          // finmind-us 422-on-bad-ticker).
          log.warn(
            { ticker, marketCode: market, provider: provider.providerId, error: divErr },
            "backfill_dividend_fetch_failed: continuing without dividends",
          );
        }
      }

      // Update status for non-repair/non-daily-refresh jobs.
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
        if (createNotification) {
          try {
            await createNotification({
              userId,
              severity: "info",
              source: "repair",
              title: `Repair completed — ${ticker}`,
              body: `${barsCount} daily bars, ${dividendsCount} dividend events`,
              detail: { ticker, barsCount, dividendsCount },
            });
          } catch (err) {
            log.warn({ ticker, err }, "repair_notification_create_failed");
          }
        }
      } else if (userId) {
        await eventBus.publishEvent(userId, "backfill_complete", {
          ticker,
          barsCount,
          dividendsCount,
        });
      }
    } catch (err) {
      // KZO-163: provider rate limit → reschedule (NOT a retry). Status is left untouched
      // so the job effectively pauses until the limiter releases.
      if (err instanceof RateLimitedError) {
        await rescheduleAfterRateLimit(err);
        return;
      }

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
        if (isLastRetry && createNotification) {
          try {
            await createNotification({
              userId,
              severity: "error",
              source: "repair",
              title: `Repair failed — ${ticker}`,
              body: reason,
              detail: { ticker, reason },
            });
          } catch (notifErr) {
            log.warn({ ticker, notifErr }, "repair_failure_notification_create_failed");
          }
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
