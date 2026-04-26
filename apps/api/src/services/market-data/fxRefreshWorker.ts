import type { JobWithMetadata } from "pg-boss";
import type { Persistence } from "../../persistence/types.js";
import type { FxRate, FxRateProvider, FxRefreshJobData } from "./types.js";
import { deriveFetchWindow } from "./deriveFetchWindow.js";

/** KZO-164: pg-boss queue name. */
export const FX_REFRESH_QUEUE = "fx-refresh";
/** KZO-164: cron spec — daily at 22:00 UTC. By this hour CBC/RBA/ECB have published. */
export const FX_REFRESH_CRON = "0 22 * * *";

/**
 * KZO-164 Phase 1.5 invariant #4 — hardcoded for v1. KZO-170 (US) and KZO-171 (AU) will
 * expand this list when cross-currency tickers ship. Module-top constant so a single
 * grep finds all consumers, and so the worker filter rejects non-stored quotes
 * unconditionally regardless of which `bases` the job was launched with.
 */
export const STORED_QUOTES = ["TWD", "USD", "AUD"] as const;
export type StoredQuote = (typeof STORED_QUOTES)[number];

export interface FxRefreshWorkerDeps {
  fxProvider: FxRateProvider;
  persistence: Pick<Persistence, "getLatestFxRateDate" | "upsertFxRates">;
  log: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
  /** Test seam — defaults to `today_utc()`. */
  now?: () => string;
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
 *  - #4 `STORED_QUOTES` filter — only TWD/USD/AUD persisted.
 *  - #5 `today` resolves to UTC — `deriveFetchWindow` defaults `now` to `today_utc()`;
 *       tests can inject a fixed clock via `deps.now`.
 *  - #6 Upsert uses `response.date`, not `today_utc()` — we pass through provider dates.
 *  - #7 Errors bubble — no special catch; pg-boss retry policy applies.
 */
export function createFxRefreshHandler(deps: FxRefreshWorkerDeps) {
  const { fxProvider, persistence, log } = deps;
  const storedQuotesSet = new Set<string>(STORED_QUOTES);

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
    };

    try {
      const window = await deriveFetchWindow(normalized, persistence, deps.now);

      const collected: FxRate[] = [];
      // No-op window (startDate > endDate) — already-up-to-date sentinel from
      // deriveFetchWindow. Skip the per-base fetch loop and proceed to the upsert (which
      // is a no-op for an empty array). Keeps the provider from hitting Frankfurter with
      // an invalid `from > to` query.
      if (window.startDate <= window.endDate) {
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
    } catch (error) {
      log.error({ error, trigger }, "fx_refresh_failed");
      throw error;
    }
  };
}
