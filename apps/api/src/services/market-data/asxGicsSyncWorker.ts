/**
 * KZO-196 — ASX GICS sync worker.
 *
 * Pg-boss handler that fetches the public ASX listed-companies CSV via
 * `AsxGicsCatalogProvider`, parses it into `{ ticker, gicsIndustryGroup }`
 * rows, and applies enrichment-only UPDATEs to `market_data.instruments`
 * rows scoped to `market_code = 'AU'`. NEVER INSERTs new rows; tickers in
 * the CSV that don't exist in the DB are logged as `unmatched_asx_ticker`
 * (per-ticker when total ≤ 50; one summary line otherwise) and dropped.
 *
 * Singleton policy with constant key `'asx-gics-sync'` (per
 * `.claude/rules/pgboss-composite-singleton-key.md` — global cron, not
 * per-ticker, so the constant key is correct). Concurrent admin "Run now"
 * clicks coalesce.
 *
 * Per `.claude/rules/typed-transient-error-catch-audit.md`: the inner
 * try/catch around the provider fetch re-throws `RateLimitedError` first.
 * The current ASX feed has no documented quota — defensive guard for any
 * future provider change.
 */
import type { JobWithMetadata, PgBoss } from "pg-boss";
import type { Pool } from "pg";
import type { AppInstance } from "../../app.js";
import type { AsxGicsProvider, RawAsxGicsRow } from "./providers/asxGicsCatalog.js";
import { AsxGicsFetchError, AsxGicsParseError } from "./providers/asxGicsCatalog.js";
import { RateLimitedError } from "./types.js";
import { DEFAULT_MARKET_DATA_QUEUE_OPTIONS } from "./registerBackfillWorker.js";
import type { ProviderHealthService } from "./providerHealth.js";
import { classifyProviderError } from "./backfillWorker.js";

export const ASX_GICS_SYNC_QUEUE = "asx-gics-sync";
export const ASX_GICS_SYNC_SINGLETON_KEY = "asx-gics-sync";

const ASX_GICS_QUEUE_OPTIONS = {
  ...DEFAULT_MARKET_DATA_QUEUE_OPTIONS,
  policy: "singleton",
} as const;

const SANITY_MIN = 1_000;
const SANITY_MAX = 5_000;
const UPDATE_BATCH_SIZE = 500;
const UNMATCHED_PER_TICKER_LOG_LIMIT = 50;

export interface AsxGicsSyncMetrics {
  rowsParsed: number;
  rowsUpdated: number;
  rowsUnchanged: number;
  rowsUnmatchedAsx: number;
  rowsMissingFromCsv: number;
  durationMs: number;
}

export interface AsxGicsSyncWorkerDeps {
  provider: AsxGicsProvider;
  pool: Pool;
  log: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
  /** Provider-health aggregator (KZO-177). Optional for memory-backed tests. */
  providerHealth?: ProviderHealthService;
}

/**
 * Pure handler factory — exported so unit tests can drive it without
 * pg-boss. Mirrors the pattern from `backfillWorker.ts`.
 */
export function createAsxGicsSyncHandler(deps: AsxGicsSyncWorkerDeps) {
  const { provider, pool, log, providerHealth } = deps;

  async function safeRecordOutcome(
    outcome: Parameters<ProviderHealthService["recordOutcome"]>[1],
  ): Promise<void> {
    if (!providerHealth) return;
    try {
      // KZO-196: `"asx-gics-csv"` is a member of `ProviderId` (added in
      // providerHealth.ts alongside this worker), so no cast is needed.
      await providerHealth.recordOutcome("asx-gics-csv", outcome);
    } catch (healthErr) {
      log.warn(
        { err: healthErr, providerId: "asx-gics-csv", outcomeKind: outcome.kind },
        "provider_health_record_outcome_failed",
      );
    }
  }

  return async (_jobs: JobWithMetadata<unknown>[]): Promise<AsxGicsSyncMetrics> => {
    const startedAt = Date.now();
    log.info({ providerId: "asx-gics-csv" }, "gics_sync_started");

    let rows: RawAsxGicsRow[];
    try {
      rows = await provider.fetchGicsCatalog();
    } catch (err) {
      // Re-throw transient errors first per typed-transient-error-catch-audit.md.
      if (err instanceof RateLimitedError) {
        await safeRecordOutcome({ kind: "rate_limit", errorMessage: err.message });
        throw err;
      }
      const errorClass = err instanceof AsxGicsParseError
        ? "parse"
        : err instanceof AsxGicsFetchError
          ? "network"
          : classifyProviderError(err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      log.error({ err, stage: "fetch" }, "gics_sync_failed");
      await safeRecordOutcome({ kind: "error", errorClass, errorMessage });
      throw err;
    }

    const rowsParsed = rows.length;
    if (rowsParsed < SANITY_MIN) {
      log.warn(
        { rowsParsed, threshold: SANITY_MIN, providerId: "asx-gics-csv" },
        "gics_sync_sanity_warn_low",
      );
    } else if (rowsParsed > SANITY_MAX) {
      log.warn(
        { rowsParsed, threshold: SANITY_MAX, providerId: "asx-gics-csv" },
        "gics_sync_sanity_warn_high",
      );
    }

    // Deduplicate by ticker (CSV occasionally lists multiple share classes
    // under one ticker; we take the first occurrence).
    const csvByTicker = new Map<string, string>();
    for (const r of rows) {
      if (!csvByTicker.has(r.ticker)) {
        csvByTicker.set(r.ticker, r.gicsIndustryGroup);
      }
    }

    // Get the current AU ticker set so we can split into matched / unmatched.
    let dbTickers: Set<string>;
    try {
      const { rows: dbRows } = await pool.query<{ ticker: string }>(
        `SELECT ticker FROM market_data.instruments WHERE market_code = 'AU'`,
      );
      dbTickers = new Set(dbRows.map((r) => r.ticker));
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      log.error({ err, stage: "load_db_tickers" }, "gics_sync_failed");
      await safeRecordOutcome({
        kind: "error",
        errorClass: classifyProviderError(err),
        errorMessage,
      });
      throw err;
    }

    const matchedUpdates: Array<{ ticker: string; gicsIndustryGroup: string }> = [];
    const unmatched: string[] = [];
    for (const [ticker, gics] of csvByTicker.entries()) {
      if (dbTickers.has(ticker)) {
        matchedUpdates.push({ ticker, gicsIndustryGroup: gics });
      } else {
        unmatched.push(ticker);
      }
    }
    const rowsMissingFromCsv = [...dbTickers].filter((t) => !csvByTicker.has(t)).length;
    const rowsUnmatchedAsx = unmatched.length;

    if (rowsUnmatchedAsx > 0) {
      if (rowsUnmatchedAsx <= UNMATCHED_PER_TICKER_LOG_LIMIT) {
        for (const ticker of unmatched) {
          log.info({ ticker, providerId: "asx-gics-csv" }, "unmatched_asx_ticker");
        }
      } else {
        log.info(
          { count: rowsUnmatchedAsx, providerId: "asx-gics-csv" },
          "unmatched_asx_tickers_summary",
        );
      }
    }

    // Apply UPDATEs in batched transactions. The `IS DISTINCT FROM` guard
    // prevents an `updated_at` bump when the new value matches the existing.
    let rowsUpdated = 0;
    let rowsUnchanged = 0;
    try {
      for (let i = 0; i < matchedUpdates.length; i += UPDATE_BATCH_SIZE) {
        const batch = matchedUpdates.slice(i, i + UPDATE_BATCH_SIZE);
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          for (const u of batch) {
            const result = await client.query(
              `UPDATE market_data.instruments
                  SET gics_industry_group = $1,
                      updated_at = CURRENT_TIMESTAMP
                WHERE ticker = $2
                  AND market_code = 'AU'
                  AND gics_industry_group IS DISTINCT FROM $1`,
              [u.gicsIndustryGroup, u.ticker],
            );
            if ((result.rowCount ?? 0) > 0) {
              rowsUpdated += 1;
            } else {
              rowsUnchanged += 1;
            }
          }
          await client.query("COMMIT");
        } catch (txErr) {
          await client.query("ROLLBACK");
          throw txErr;
        } finally {
          client.release();
        }
      }
    } catch (err) {
      if (err instanceof RateLimitedError) {
        await safeRecordOutcome({ kind: "rate_limit", errorMessage: err.message });
        throw err;
      }
      const errorMessage = err instanceof Error ? err.message : String(err);
      log.error({ err, stage: "apply_updates" }, "gics_sync_failed");
      await safeRecordOutcome({
        kind: "error",
        errorClass: classifyProviderError(err),
        errorMessage,
      });
      throw err;
    }

    const durationMs = Date.now() - startedAt;
    const metrics: AsxGicsSyncMetrics = {
      rowsParsed,
      rowsUpdated,
      rowsUnchanged,
      rowsUnmatchedAsx,
      rowsMissingFromCsv,
      durationMs,
    };
    log.info({ ...metrics, providerId: "asx-gics-csv" }, "gics_sync_completed");
    await safeRecordOutcome({ kind: "success" });
    return metrics;
  };
}

export async function registerAsxGicsSyncWorker(
  app: AppInstance,
  boss: PgBoss,
  deps: AsxGicsSyncWorkerDeps,
): Promise<void> {
  await boss.createQueue(ASX_GICS_SYNC_QUEUE, ASX_GICS_QUEUE_OPTIONS);
  await boss.work(
    ASX_GICS_SYNC_QUEUE,
    { batchSize: 1, includeMetadata: true },
    createAsxGicsSyncHandler(deps),
  );
  app.log.info("asx-gics-sync worker registered");
}
