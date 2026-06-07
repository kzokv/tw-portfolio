import type { Pool } from "pg";
import type { PgBoss, JobWithMetadata } from "pg-boss";
import type { BackfillStatus, MarketCode } from "@vakwen/domain";
import { MARKET_CODES } from "@vakwen/shared-types";
import { z } from "zod";
import type { BufferedEventBus } from "../../events/index.js";
import type {
  CatalogInstrument,
  CatalogSyncResult,
  DelistingRecord,
  ProviderOperationPhase,
  ProviderOperationRecord,
} from "../../persistence/types.js";
import type { InstrumentCatalogProvider, MarketDataProvider } from "./types.js";
import { historyStartFor, RateLimitedError, type MarketDataResolverMode } from "./types.js";
import { buildCatalogInstruments } from "./catalogSync.js";
import { upsertDailyBars, upsertDividendEvents } from "./upserts.js";
import type { ProviderHealthService, ProviderId, ProviderOutcome } from "./providerHealth.js";
import type { ProviderErrorClass } from "../../persistence/types.js";

export const BACKFILL_QUEUE = "finmind-backfill";

export function getBackfillSingletonKey(
  ticker: string,
  marketCode: MarketCode,
  resolverMode?: MarketDataResolverMode,
): string {
  const baseKey = `${ticker}:${marketCode}`;
  return marketCode === "KR" && resolverMode ? `${baseKey}:${resolverMode}` : baseKey;
}

export interface BackfillJobData {
  ticker: string;
  // KZO-185: required after producer audit. Producers (snapshots/generate
  // auto-trigger, recompute/confirm auto-trigger, daily-refresh cron, manual
  // /market-data/backfill, /repair, /retry) all stamp `marketCode` directly.
  // The Zod schema below is the single validation gate at the worker entry.
  marketCode: MarketCode;
  userId?: string;
  trigger: "user_selection" | "first_trade" | "retry" | "daily_refresh" | "repair" | "admin_rerun";
  startDate?: string;
  endDate?: string;
  includeBars?: boolean;
  includeDividends?: boolean;
  resolverMode?: MarketDataResolverMode;
  batchId?: string;
  providerOperationId?: string;
}

// KZO-185: validation gate at the handler entry. Parsed BEFORE the existing
// `try` block so a ZodError on a malformed (or pre-KZO-169 in-flight) job
// propagates straight to pg-boss without running side effects (status updates,
// SSE events, instrument writes). Per `.claude/rules/typed-transient-error-catch-audit.md`
// — the existing `catch` (further down) only re-throws non-RateLimitedError, so
// ZodError surfaces cleanly to pg-boss and the job retries up to retryLimit.
export const BackfillJobDataSchema = z.object({
  ticker: z.string(),
  marketCode: z.enum(MARKET_CODES),
  userId: z.string().optional(),
  trigger: z.enum(["user_selection", "first_trade", "retry", "daily_refresh", "repair", "admin_rerun"]),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  includeBars: z.boolean().optional(),
  includeDividends: z.boolean().optional(),
  resolverMode: z.enum(["chart_probe_v1", "quote_first"]).optional(),
  batchId: z.string().optional(),
  providerOperationId: z.string().optional(),
}) satisfies z.ZodType<BackfillJobData>;

export interface ProviderOperationJobLogger {
  getProviderOperation(id: string): Promise<ProviderOperationRecord | null>;
  updateProviderOperation(input: {
    id: string;
    phase?: ProviderOperationPhase;
    metadata?: Record<string, unknown> | null;
    completedAt?: string | null;
    cancelledAt?: string | null;
  }): Promise<ProviderOperationRecord>;
  createProviderOperationLog(input: {
    operationId: string;
    phase: ProviderOperationPhase;
    level: "info" | "warning" | "error";
    message: string;
    context?: Record<string, unknown> | null;
  }): Promise<unknown>;
}

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
  // KZO-197 P2-2: composite scope on (ticker, marketCode) so cross-listed
  // siblings (e.g. BHP/AU vs BHP/US) are not silently mutated.
  updateBackfillStatus: (
    ticker: string,
    marketCode: MarketCode,
    status: BackfillStatus,
  ) => Promise<void>;
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
  /**
   * KZO-177 — provider health aggregator. The worker calls
   * `providerHealth.recordOutcome(providerId, outcome)` after each provider
   * call (bars/dividends/metadata) to feed the per-provider status machine.
   * Provider classes themselves stay pure (no health side effects).
   */
  providerHealth?: ProviderHealthService;
  providerOperationLogger?: ProviderOperationJobLogger;
  log: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
}

/** KZO-177 — map a `MarketCode` to the provider id used by the health aggregator. */
export function providerIdForMarket(market: MarketCode): ProviderId {
  if (market === "US") return "finmind-us";
  if (market === "AU") return "yahoo-finance-au";
  if (market === "KR") return "yahoo-finance-kr";
  return "finmind-tw";
}

/** KZO-177 — best-effort error classification from a thrown error. */
export function classifyProviderError(err: unknown): ProviderErrorClass {
  if (!err) return "other";
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  if (/(http )?5\d\d|server error|bad gateway|gateway timeout/.test(lower)) return "http_5xx";
  if (/(http )?4\d\d|forbidden|unauthorized|not found|bad request/.test(lower)) return "http_4xx";
  if (/network|econnrefused|enotfound|etimedout|timeout|fetch failed|socket/.test(lower)) return "network";
  if (/parse|json|unexpected token|invalid response/.test(lower)) return "parse";
  return "other";
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
    providerHealth,
    providerOperationLogger,
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
    const {
      ticker,
      marketCode: market,
      userId,
      trigger,
      startDate,
      endDate,
      resolverMode,
      includeBars = true,
      includeDividends = true,
      batchId,
      providerOperationId,
    } = data;
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
    // KZO-177: provider id for the active market. Used to feed `providerHealth`
    // outcomes. Computed once per job — the market is stable across the
    // bars/dividends/metadata calls.
    const healthProviderId = providerIdForMarket(market);

    async function recordOperationLog(
      phase: ProviderOperationPhase,
      level: "info" | "warning" | "error",
      message: string,
      context: Record<string, unknown> = {},
    ): Promise<void> {
      if (!providerOperationId || !providerOperationLogger) return;
      try {
        await providerOperationLogger.createProviderOperationLog({
          operationId: providerOperationId,
          phase,
          level,
          message,
          context: {
            providerId: healthProviderId,
            marketCode: market,
            ticker,
            trigger,
            batchId,
            resolverMode,
            jobId: job.id,
            ...context,
          },
        });
      } catch (logErr) {
        log.warn(
          { err: logErr, providerOperationId, ticker, marketCode: market },
          "provider_operation_job_log_failed",
        );
      }
    }

    async function assertOperationCanRun(): Promise<boolean> {
      if (!providerOperationId || !providerOperationLogger) return true;
      const operation = await providerOperationLogger.getProviderOperation(providerOperationId);
      if (!operation) {
        await recordOperationLog(
          "failed",
          "error",
          `job_aborted_missing_operation provider=${healthProviderId} market=${market} ticker=${ticker}`,
        );
        return false;
      }
      if (operation.phase === "cancelled") {
        await recordOperationLog(
          "cancelled",
          "warning",
          `job_cancelled provider=${operation.providerId} market=${operation.marketCode} ticker=${ticker}`,
        );
        return false;
      }
      if (operation.phase === "paused") {
        const id = await boss.send(BACKFILL_QUEUE, data, {
          startAfter: 60,
          singletonKey: getBackfillSingletonKey(ticker, market, resolverMode),
          priority: job.priority ?? 0,
        });
        await recordOperationLog(
          "paused",
          "warning",
          `job_deferred_paused_operation provider=${operation.providerId} market=${operation.marketCode} ticker=${ticker}`,
          { requeuedJobId: id, delaySec: 60 },
        );
        return false;
      }
      if (!["running", "staged"].includes(operation.phase)) {
        await recordOperationLog(
          operation.phase,
          "warning",
          `job_skipped_inactive_operation provider=${operation.providerId} market=${operation.marketCode} ticker=${ticker} phase=${operation.phase}`,
        );
        return false;
      }
      return true;
    }

    async function safeRecordOutcome(outcome: ProviderOutcome): Promise<void> {
      if (!providerHealth) return;
      try {
        await providerHealth.recordOutcome(healthProviderId, outcome);
      } catch (healthErr) {
        log.warn(
          { err: healthErr, providerId: healthProviderId, outcomeKind: outcome.kind },
          "provider_health_record_outcome_failed",
        );
      }
    }

    async function rescheduleAfterRateLimit(err: RateLimitedError): Promise<void> {
      const delaySec = err.retryAfterSeconds;
      log.info(
        {
          ticker,
          marketCode: market,
          providerId: healthProviderId,
          trigger,
          batchId,
          delaySec,
          ...(resolverMode ? { resolverMode } : {}),
        },
        "backfill_rate_limited: rescheduling",
      );
      // KZO-169/KZO-197: singletonKey scopes by market and KR resolver mode so
      // cross-market and acknowledged KR repair reruns don't collapse.
      const singletonKey = getBackfillSingletonKey(ticker, market, resolverMode);
      // KZO-185: enqueue the parsed (validated) payload, not raw `job.data`.
      const id = await boss.send(BACKFILL_QUEUE, data, {
        startAfter: delaySec,
        singletonKey,
        priority: job.priority ?? 0,
      });
      // KZO-163 MEDIUM-2: singleton policy returns null when an existing job already covers
      // this ticker. Log so we can see drops without throwing — the existing job will run.
      if (id === null) {
        log.warn(
          {
            ticker,
            marketCode: market,
            providerId: healthProviderId,
            trigger,
            batchId,
            delaySec,
            ...(resolverMode ? { resolverMode } : {}),
          },
          "backfill_rate_limit_reschedule_dropped: existing singleton covers this ticker",
        );
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
      if (!(await assertOperationCanRun())) return;
      await recordOperationLog(
        "running",
        "info",
        `job_started provider=${healthProviderId} market=${market} ticker=${ticker}`,
        { startDate: effectiveStartDate, endDate },
      );
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
        await updateBackfillStatus(ticker, market, "backfilling");
      }

      if (isRepair && userId) {
        await eventBus.publishEvent(userId, "repair_started", { ticker });
      } else if (!isDailyRefresh && userId) {
        await eventBus.publishEvent(userId, "backfill_started", { ticker });
      }

      let barsCount = 0;
      if (includeBars) {
        const providerFetchOptions = resolverMode ? [{ resolverMode }] as const : [];
        log.info(
          {
            ticker,
            marketCode: market,
            providerId: healthProviderId,
            trigger,
            batchId,
            startDate: effectiveStartDate,
            endDate,
            ...(resolverMode ? { resolverMode } : {}),
          },
          "backfill_fetching_bars",
        );
        const bars = (await provider.fetchBars(ticker, effectiveStartDate, endDate, ...providerFetchOptions))
          .map((bar) => ({ ...bar, marketCode: market }));

        // Write bars to market_data.daily_bars (upsert)
        barsCount = await upsertDailyBars(pool, bars);
        if (onBarsUpserted) {
          for (const [upsertedMarket, dates] of collectDistinctBarDatesByMarket(bars)) {
            onBarsUpserted(upsertedMarket, [...dates]);
          }
        }
        log.info(
          { ticker, marketCode: market, providerId: healthProviderId, batchId, providerOperationId, barsCount },
          "backfill_bars_upserted",
        );
      }

      // Fetch dividend events from the provider
      let dividendsCount = 0;
      if (includeDividends) {
        try {
          const providerFetchOptions = resolverMode ? [{ resolverMode }] as const : [];
          const dividends = (await provider.fetchDividends(
            ticker,
            effectiveStartDate,
            endDate,
            ...providerFetchOptions,
          ))
            .map((dividend) => ({ ...dividend, marketCode: market }));
          // Write dividend events (dividend failure → log warning, don't fail job)
          dividendsCount = await upsertDividendEvents(pool, dividends);
          log.info(
            { ticker, marketCode: market, providerId: healthProviderId, batchId, providerOperationId, dividendsCount },
            "backfill_dividends_upserted",
          );
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
          // KZO-177 (P2 Fix 1): warn-and-continue must NOT mask the failure from
          // the health aggregator. Record the partial-error outcome so
          // error_count_24h reflects the dividend fetch failure; the later
          // success call still fires (bars landed) and the resulting status
          // computes as `degraded` (success ≥ settled day AND errors ≥ 1).
          await safeRecordOutcome({
            kind: "error",
            errorClass: classifyProviderError(divErr),
            errorMessage: divErr instanceof Error ? divErr.message : String(divErr),
            context: { ticker, marketCode: market, phase: "dividends" },
          });
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
            // KZO-177 (P2 Fix 1): mirror the dividend block — record the
            // partial-error outcome so the health aggregator sees the
            // metadata-enrichment failure even when bars+dividends landed.
            await safeRecordOutcome({
              kind: "error",
              errorClass: classifyProviderError(metaErr),
              errorMessage: metaErr instanceof Error ? metaErr.message : String(metaErr),
              context: { ticker, marketCode: market, phase: "metadata" },
            });
          }
        }
      }

      // KZO-177: provider succeeded — record success outcome before downstream
      // status updates / SSE fan-out so the health aggregator's status machine
      // sees the success even if a later step throws.
      await safeRecordOutcome({ kind: "success" });

      // Update status for non-repair/non-daily-refresh jobs.
      if (shouldSetReadyStatus) {
        await updateBackfillStatus(ticker, market, "ready");
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

      // KZO-197 P2-1: track batch fan-in for any job carrying a `batchId` —
      // both daily-refresh AND admin_rerun-triggered AU catalog warm-up.
      // Previously gated on `isDailyRefresh`, which left AU warm-up batches
      // permanently incomplete (jobs ran but never reported into the batch).
      await recordOperationLog(
        "running",
        "info",
        `job_completed provider=${healthProviderId} market=${market} ticker=${ticker} bars=${barsCount} dividends=${dividendsCount}`,
        { barsCount, dividendsCount },
      );
      if (batchId && updateBatchTickerResult) {
        await trackBatchResult(
          batchId,
          ticker,
          { status: "success", barsCount, dividendsCount },
          log,
          { providerOperationId, providerId: healthProviderId, marketCode: market },
        );
      }
    } catch (err) {
      // KZO-163: provider rate limit → reschedule (NOT a retry). Status is left untouched
      // so the job effectively pauses until the limiter releases.
      if (err instanceof RateLimitedError) {
        // KZO-177: classify as rate_limit — does NOT change provider status.
        await safeRecordOutcome({
          kind: "rate_limit",
          errorMessage: err.message,
          context: { ticker, marketCode: market, retryAfterSeconds: err.retryAfterSeconds },
        });
        await rescheduleAfterRateLimit(err);
        return;
      }

      const isLastRetry = job.retryCount >= job.retryLimit;
      const reason = err instanceof Error ? err.message : String(err);
      await recordOperationLog(
        isLastRetry ? "failed" : "running",
        isLastRetry ? "error" : "warning",
        `job_failed provider=${healthProviderId} market=${market} ticker=${ticker} last_retry=${isLastRetry}`,
        { reason, retryCount: job.retryCount, retryLimit: job.retryLimit },
      );

      // KZO-177: record provider error outcome. Classification falls back to
      // "other" when the message doesn't match a known shape. The handler
      // continues with the existing failure-path side effects below.
      await safeRecordOutcome({
        kind: "error",
        errorClass: classifyProviderError(err),
        errorMessage: reason,
        context: { ticker, marketCode: market, trigger, isLastRetry },
      });

      if (isLastRetry && shouldSetFailedStatus) {
        await updateBackfillStatus(ticker, market, "failed");
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

      // KZO-197 P2-1: track batch fan-in for terminal failures on any job
      // carrying a `batchId`. Mirrors the success-path gate. Non-last retries
      // do NOT report to the batch — the job will be retried by pg-boss.
      if (isLastRetry && batchId && updateBatchTickerResult) {
        await trackBatchResult(
          batchId,
          ticker,
          { status: "failed", reason },
          log,
          { providerOperationId, providerId: healthProviderId, marketCode: market },
        );
      }

      throw err; // Re-throw so pg-boss handles retry
    }
  };

  async function trackBatchResult(
    batchId: string,
    ticker: string,
    result: { status: "success" | "failed"; barsCount?: number; dividendsCount?: number; reason?: string },
    logger: BackfillWorkerDeps["log"],
    operationContext?: {
      providerOperationId?: string;
      providerId: ProviderId;
      marketCode: MarketCode;
    },
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
        await completeProviderOperationBatch(batchId, counters, operationContext, logger);
      }
    } catch (err) {
      logger.warn({ batchId, ticker, err }, "batch_result_tracking_failed");
    }
  }

  async function completeProviderOperationBatch(
    batchId: string,
    counters: { jobsSucceeded: number; jobsFailed: number; jobsTotal: number },
    operationContext: {
      providerOperationId?: string;
      providerId: ProviderId;
      marketCode: MarketCode;
    } | undefined,
    logger: BackfillWorkerDeps["log"],
  ): Promise<void> {
    if (!operationContext?.providerOperationId || !providerOperationLogger) return;
    try {
      const operation = await providerOperationLogger.getProviderOperation(operationContext.providerOperationId);
      if (!operation || (operation.phase !== "running" && operation.phase !== "queued")) return;
      const phase: ProviderOperationPhase = counters.jobsFailed > 0 ? "failed" : "completed";
      const completedAt = new Date().toISOString();
      await providerOperationLogger.updateProviderOperation({
        id: operation.id,
        phase,
        completedAt,
        metadata: {
          ...(operation.metadata ?? {}),
          batchId,
          jobsSucceeded: counters.jobsSucceeded,
          jobsFailed: counters.jobsFailed,
          jobsTotal: counters.jobsTotal,
          progressPercent: 100,
        },
      });
      await providerOperationLogger.createProviderOperationLog({
        operationId: operation.id,
        phase,
        level: counters.jobsFailed > 0 ? "warning" : "info",
        message: `backfill_batch_${phase} provider=${operation.providerId} market=${operation.marketCode} batch=${batchId}`,
        context: {
          providerId: operation.providerId,
          marketCode: operation.marketCode,
          batchId,
          jobsSucceeded: counters.jobsSucceeded,
          jobsFailed: counters.jobsFailed,
          jobsTotal: counters.jobsTotal,
        },
      });
    } catch (err) {
      logger.warn({
        err,
        batchId,
        providerOperationId: operationContext.providerOperationId,
        providerId: operationContext.providerId,
        marketCode: operationContext.marketCode,
      }, "provider_operation_batch_completion_failed");
    }
  }
}
