import type { JobWithMetadata } from "pg-boss";
import { Env } from "@vakwen/config";
import type { Persistence } from "../../persistence/types.js";
import type { FxRate, FxRateProvider, FxRefreshJobData } from "./types.js";
import { RateLimitedError } from "./types.js";
import { deriveFetchWindow } from "./deriveFetchWindow.js";
import type { ProviderHealthService } from "./providerHealth.js";
import { classifyProviderError } from "./backfillWorker.js";

/** KZO-164: pg-boss queue name. */
export const FX_REFRESH_QUEUE = "fx-refresh";
/**
 * KZO-198: cron sourced from `Env.FX_REFRESH_CRON` (Tier 3, restart-required).
 * Default `"0 22 * * *"` (daily 22:00 UTC) when env unset — by this hour
 * CBC/RBA/ECB have published.
 */
export const FX_REFRESH_CRON = Env.FX_REFRESH_CRON;

/**
 * KZO-164 Phase 1.5 invariant #4 — stored reporting currencies. Module-top constant so a single
 * grep finds all consumers, and so the worker filter rejects non-stored quotes
 * unconditionally regardless of which `bases` the job was launched with.
 */
export const STORED_QUOTES = ["TWD", "USD", "AUD", "KRW"] as const;
export type StoredQuote = (typeof STORED_QUOTES)[number];

export interface FxRefreshWorkerDeps {
  fxProvider: FxRateProvider;
  persistence: Pick<
    Persistence,
    | "getLatestFxRateDate"
    | "upsertFxRates"
  > & Partial<Pick<Persistence, "getProviderOperation" | "updateProviderOperation" | "createProviderOperationLog">>;
  log: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
  /** Test seam — defaults to `today_utc()`. */
  now?: () => string;
  /**
   * KZO-177 — provider health aggregator. The handler calls
   * `recordOutcome("frankfurter", outcome)` on success/error/rate_limit.
   */
  providerHealth?: ProviderHealthService;
}

/**
 * KZO-164: pg-boss handler factory. Mirrors `createCatalogSyncHandler` shape — returns a
 * handler that pg-boss invokes with a 1-element job batch. Rebuilds the fetch window per
 * trigger, fans out per-base requests in series, filters self-pairs + non-stored quotes,
 * and persists in a single bulk upsert.
 *
 * Phase 1.5 invariants touched here:
 *  - #1 Self-pair filter (`r.quoteCurrency !== r.baseCurrency`) BEFORE `upsertFxRates`.
 *  - #2 Audit log on manual trigger only — handler emits NO audit; the
 *       `POST /admin/fx-rates/refresh` route owns the `admin_fx_rates_refresh` entry.
 *  - #3 `source` field is column-aligned — provider stamps `'frankfurter'`; we pass through.
 *  - #4 `STORED_QUOTES` filter — only supported reporting currencies persisted.
 *  - #5 `today` resolves to UTC — `deriveFetchWindow` defaults `now` to `today_utc()`;
 *       tests can inject a fixed clock via `deps.now`.
 *  - #6 Upsert uses `response.date`, not `today_utc()` — we pass through provider dates.
 *  - #7 Errors bubble — no special catch; pg-boss retry policy applies.
 */
export function createFxRefreshHandler(deps: FxRefreshWorkerDeps) {
  const { fxProvider, persistence, log, providerHealth } = deps;
  const storedQuotesSet = new Set<string>(STORED_QUOTES);

  async function logProviderOperation(
    providerOperationId: string | undefined,
    phase: "running" | "paused" | "completed" | "failed" | "cancelled",
    message: string,
    context: Record<string, unknown>,
    level: "info" | "warning" | "error" = "info",
  ): Promise<void> {
    if (!providerOperationId) return;
    if (!persistence.createProviderOperationLog) return;
    try {
      await persistence.createProviderOperationLog({
        operationId: providerOperationId,
        phase,
        level,
        message,
        context,
      });
    } catch (err) {
      log.warn({ err, providerOperationId }, "fx_refresh_provider_operation_log_failed");
    }
  }

  async function updateProviderOperation(
    providerOperationId: string | undefined,
    input: Omit<Parameters<Persistence["updateProviderOperation"]>[0], "id">,
  ): Promise<void> {
    if (!providerOperationId) return;
    if (!persistence.getProviderOperation || !persistence.updateProviderOperation) return;
    try {
      const current = await persistence.getProviderOperation(providerOperationId);
      await persistence.updateProviderOperation({
        id: providerOperationId,
        ...input,
        metadata: input.metadata
          ? { ...(current?.metadata ?? {}), ...input.metadata }
          : input.metadata,
      });
    } catch (err) {
      log.warn({ err, providerOperationId }, "fx_refresh_provider_operation_update_failed");
    }
  }

  async function shouldRunProviderOperation(providerOperationId: string | undefined): Promise<boolean> {
    if (!providerOperationId) return true;
    if (!persistence.getProviderOperation) return true;
    const operation = await persistence.getProviderOperation(providerOperationId);
    if (operation?.phase !== "paused" && operation?.phase !== "cancelled") return true;
    await logProviderOperation(
      providerOperationId,
      operation.phase,
      `fx_refresh_skipped provider=${operation.providerId} phase=${operation.phase}`,
      { providerId: operation.providerId, marketCode: operation.marketCode },
      "warning",
    );
    return false;
  }

  async function safeRecordOutcome(outcome: import("./providerHealth.js").ProviderOutcome): Promise<void> {
    if (!providerHealth) return;
    try {
      await providerHealth.recordOutcome("frankfurter", outcome);
    } catch (err) {
      log.warn({ err, outcomeKind: outcome.kind }, "provider_health_record_outcome_failed");
    }
  }

  // The cron schedule sends `{}` (no payload), so the worker normalizes the partial input
  // into a full `FxRefreshJobData` before delegating. Manual-trigger payloads from the
  // admin route are already complete; cron payloads default `trigger='cron'` and let
  // `deriveFetchWindow` recompute the date range.
  return async ([job]: JobWithMetadata<Partial<FxRefreshJobData>>[]): Promise<void> => {
    const startedAt = Date.now();
    const data = job.data ?? {};
    const trigger: FxRefreshJobData["trigger"] = data.trigger ?? "cron";
    const bases = data.bases && data.bases.length > 0 ? data.bases : STORED_QUOTES;
    const normalized: FxRefreshJobData = {
      trigger,
      startDate: data.startDate ?? "",
      endDate: data.endDate ?? "",
      bases,
      providerOperationId: data.providerOperationId,
    };

    try {
      if (!(await shouldRunProviderOperation(normalized.providerOperationId))) return;
      await updateProviderOperation(normalized.providerOperationId, {
        phase: "running",
        startedAt: new Date().toISOString(),
        metadata: { progressPercent: 0, bases: normalized.bases },
      });
      await logProviderOperation(
        normalized.providerOperationId,
        "running",
        `fx_refresh_started bases=${normalized.bases.join(",")}`,
        { trigger, bases: normalized.bases },
      );
      const window = await deriveFetchWindow(normalized, persistence, deps.now);

      const collected: FxRate[] = [];
      // No-op window (startDate > endDate) — already-up-to-date sentinel from
      // deriveFetchWindow. Skip the per-base fetch loop and proceed to the upsert (which
      // is a no-op for an empty array). Keeps the provider from hitting Frankfurter with
      // an invalid `from > to` query.
      if (window.startDate <= window.endDate) {
        fxProvider.reserveCapacity(normalized.bases.length);
        for (const base of normalized.bases) {
          const rows = await fxProvider.fetchRatesForBase(base, window.startDate, window.endDate, STORED_QUOTES);
          for (const r of rows) {
            if (r.baseCurrency !== base) continue; // defensive — provider should already use the requested base
            if (!storedQuotesSet.has(r.quoteCurrency)) continue;
            if (r.quoteCurrency === r.baseCurrency) continue; // Phase 1.5 invariant #1
            collected.push(r);
          }
        }
      }

      const upserted = await persistence.upsertFxRates(collected);
      const durationMs = Date.now() - startedAt;
      log.info(
        {
          trigger,
          dates_covered: { startDate: window.startDate, endDate: window.endDate },
          rows_upserted: upserted,
          durationMs,
        },
        "fx_refresh_completed",
      );
      // KZO-177: feed the success outcome to the health aggregator AFTER the
      // upsert lands, so a partial failure never reports as a healthy run.
      await safeRecordOutcome({ kind: "success" });
      await updateProviderOperation(normalized.providerOperationId, {
        phase: "completed",
        completedAt: new Date().toISOString(),
        metadata: {
          progressPercent: 100,
          rowsUpserted: upserted,
          dateRange: { startDate: window.startDate, endDate: window.endDate },
        },
      });
      await logProviderOperation(
        normalized.providerOperationId,
        "completed",
        `fx_refresh_completed rows_upserted=${upserted}`,
        { trigger, rowsUpserted: upserted, dateRange: { startDate: window.startDate, endDate: window.endDate } },
      );
    } catch (error) {
      log.error({ error, trigger }, "fx_refresh_failed");
      // KZO-177: classify outcome before re-throw. Frankfurter has no rate
      // limiter today, but a future provider switch could throw RateLimitedError.
      if (error instanceof RateLimitedError) {
        await safeRecordOutcome({
          kind: "rate_limit",
          errorMessage: error.message,
          context: { trigger, retryAfterSeconds: error.retryAfterSeconds },
        });
      } else {
        const reason = error instanceof Error ? error.message : String(error);
        await safeRecordOutcome({
          kind: "error",
          errorClass: classifyProviderError(error),
          errorMessage: reason,
          context: { trigger },
        });
      }
      const terminal = job.retryCount >= job.retryLimit;
      await updateProviderOperation(normalized.providerOperationId, {
        phase: terminal ? "failed" : "running",
        completedAt: terminal ? new Date().toISOString() : null,
        metadata: {
          progressPercent: 0,
          failureReason: error instanceof Error ? error.message : String(error),
          retryCount: job.retryCount,
          retryLimit: job.retryLimit,
        },
      });
      await logProviderOperation(
        normalized.providerOperationId,
        terminal ? "failed" : "running",
        `fx_refresh_${terminal ? "failed" : "attempt_failed"} reason=${error instanceof Error ? error.message : String(error)}`,
        { trigger, retryCount: job.retryCount, retryLimit: job.retryLimit },
        terminal ? "error" : "warning",
      );
      throw error;
    }
  };
}
