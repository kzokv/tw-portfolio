import type { Pool } from "pg";
import type { PgBoss, JobWithMetadata } from "pg-boss";
import type { BackfillStatus, MarketCode } from "@tw-portfolio/domain";
import { z } from "zod";
import type { BufferedEventBus } from "../../events/index.js";
import type { CatalogInstrument, CatalogSyncResult, DelistingRecord } from "../../persistence/types.js";
import type { InstrumentCatalogProvider, MarketDataProvider } from "./types.js";
import { historyStartFor, RateLimitedError } from "./types.js";
import { buildCatalogInstruments } from "./catalogSync.js";
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
  /**
   * KZO-172 — per-market catalog registry. The handler calls
   * `catalogRegistry.get(market).fetchInstrumentMetadata(ticker)` after bars+dividends
   * to enrich the persisted catalog row. For TW/US the provider returns `null` (no-op);
   * for AU it returns Yahoo-derived metadata. Same instance is registered in both
   * `marketDataRegistry` and `catalogRegistry` for AU (and for FinMind).
   */
  catalogRegistry: Map<MarketCode, InstrumentCatalogProvider>;
  /**
   * KZO-172 — minimal persistence surface for metadata-enrichment writes. Only
   * `upsertInstrumentCatalog` is needed; the handler keeps `pool`-based bars/dividends
   * writes via `upsertDailyBars` / `upsertDividendEvents` for legacy parity.
   */
  persistence: { upsertInstrumentCatalog(instruments: CatalogInstrument[], delistings: DelistingRecord[]): Promise<CatalogSyncResult> };
  eventBus: BufferedEventBus;
  boss: PgBoss;
  /**
   * KZO-189 — effective AU metadata enrichment mode resolver. Hybrid env+DB
   * (mirror of `getEffectiveRepairCooldownMinutes`). Read every job (no
   * in-process cache) so admin toggles take effect on the next backfill.
   * Predicate: `shouldEnrich = (mode === "unconditional") || (trigger !== "daily_refresh")`.
   */
  getEffectiveMetadataEnrichmentMode: () => Promise<"unconditional" | "conditional">;
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
  onBarsUpserted?: (market: MarketCode, dates: ReadonlyArray<string>) => void;
  log: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
}

function collectDistinctBarDatesByMarket(
  bars: ReadonlyArray<{ marketCode: MarketCode; barDate: string }>,
): Map<MarketCode, Set<string>> {
  const distinctByMarket = new Map<MarketCode, Set<string>>();
  for (const bar of bars) {
    let dates = distinctByMarket.get(bar.marketCode);
    if (!dates) {
      dates = new Set<string>();
      distinctByMarket.set(bar.marketCode, dates);
    }
    dates.add(bar.barDate);
  }
  return distinctByMarket;
}

export function createBackfillHandler(deps: BackfillWorkerDeps) {
  const {
    pool,
    marketDataRegistry,
    catalogRegistry,
    persistence,
    eventBus,
    boss,
    getEffectiveMetadataEnrichmentMode,
    updateBackfillStatus,
    updateLastRepairAt,
    getUsersMonitoringTicker,
    createNotification,
    updateBatchTickerResult,
    onBatchComplete,
    onBarsUpserted,
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

    // KZO-189: AU metadata enrichment gate. Resolved per-job (no cache) so admin
    // toggles take effect on the next backfill. The predicate matches the locked
    // truth table:
    //   unconditional × any trigger              → enrich (reserveCapacity 3)
    //   conditional   × user_selection|first_trade|retry|repair → enrich (3)
    //   conditional   × daily_refresh            → SKIP (reserveCapacity 2)
    const mode = await getEffectiveMetadataEnrichmentMode();
    const shouldEnrich = mode === "unconditional" || trigger !== "daily_refresh";

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

    // KZO-190 — hoisted from the `if (shouldEnrich)` block below so the reserveCapacity
    // formula can read `supportsMetadataEnrichment`. Reused by the enrichment block to
    // avoid a second registry lookup. Per `registry.ts`, the same instance is registered
    // under both the market-data and catalog maps for each market, so `provider` and
    // `catalogProvider` resolve to the same object — reserving on `provider`'s rate
    // limiter covers the metadata call's consumption on `catalogProvider`.
    const catalogProvider = catalogRegistry.get(market);

    try {
      // KZO-163 HIGH-1 + KZO-172 + KZO-189 + KZO-190: pre-reserve rate-limit slots for
      // every call this invocation will make. Three independent slot decisions:
      //   - `includeBars` → 1 slot for `fetchBars`
      //   - `includeDividends` → 1 slot for `fetchDividends`
      //   - `shouldEnrich && supportsMetadataEnrichment` → 1 slot for
      //     `fetchInstrumentMetadata` (only AU's Yahoo `quote()` consumes a slot;
      //     FinMind TW/US implementations are no-op `return null`).
      // Pre-reserving up-front breaks the deterministic starvation pattern under
      // one-slot-at-a-time replenishment by waiting for ALL needed slots together.
      // Invariant: `provider` and `catalogProvider` resolve to the same instance per
      // market (per `registry.ts`), so reserving on `provider`'s rate limiter covers
      // the metadata call's consumption on `catalogProvider`.
      provider.reserveCapacity(
        (includeBars ? 1 : 0) +
        (includeDividends ? 1 : 0) +
        (shouldEnrich && catalogProvider?.supportsMetadataEnrichment ? 1 : 0),
      );

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
        if (onBarsUpserted) {
          for (const [upsertedMarket, dates] of collectDistinctBarDatesByMarket(bars)) {
            onBarsUpserted(upsertedMarket, [...dates]);
          }
        }
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

      // KZO-172 + KZO-189 — metadata enrichment via the per-market catalog provider.
      // The KZO-189 gate (`shouldEnrich`) skips this block when `mode === "conditional"`
      // and the trigger is `daily_refresh`, conserving the Yahoo budget on the bulk
      // daily-refresh sweep. For TW/US the provider returns null (no-op); for AU,
      // Yahoo's `quote()` returns enriched `{ name, quoteType }`.
      //
      // Error policy mirrors the dividend block exactly (REVISIT-D in scope-todo):
      //   - `RateLimitedError` MUST be re-thrown so the outer reschedule path runs
      //     (per `.claude/rules/typed-transient-error-catch-audit.md`).
      //   - Any other error (network blip, Yahoo HTML breakage, TS narrowing slip) is
      //     warn-and-continue — bars + dividends already landed, the catalog row will
      //     be enriched on the next backfill or the daily catalog-sync sweep.
      if (shouldEnrich) {
        // KZO-190 — reuse the `catalogProvider` hoisted above the `try` block.
        if (catalogProvider) {
          try {
            const rawMeta = await catalogProvider.fetchInstrumentMetadata(ticker);
            if (rawMeta) {
              const [catalogRow] = buildCatalogInstruments([rawMeta], market);
              if (catalogRow) {
                await persistence.upsertInstrumentCatalog([catalogRow], []);
                log.info({ ticker, marketCode: market, provider: catalogProvider.providerId }, "backfill_metadata_enriched");
              }
            }
          } catch (metaErr) {
            if (metaErr instanceof RateLimitedError) {
              throw metaErr;
            }
            log.warn(
              { ticker, marketCode: market, provider: catalogProvider.providerId, error: metaErr },
              "backfill_metadata_fetch_failed: continuing without enrichment",
            );
          }
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
