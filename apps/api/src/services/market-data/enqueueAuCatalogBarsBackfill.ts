import type { PgBoss } from "pg-boss";
import { randomUUID } from "node:crypto";
import type { MarketCode } from "@vakwen/domain";
import type { Persistence } from "../../persistence/types.js";
import type { BackfillJobData } from "./backfillWorker.js";
import { BACKFILL_QUEUE } from "./backfillWorker.js";
import { getEffectiveDailyRefreshPriority } from "../appConfig/backfill.js";

/**
 * KZO-197/KR — catalog warm-up producer. Originally AU-only; now accepts an
 * optional market override for KR resolver repair. It reads the market subset
 * of `market_data.instruments` whose `bars_backfill_status` is `pending` or
 * `failed` (and not delisted), and enqueues one `BACKFILL_QUEUE` job per
 * (ticker, marketCode) pair.
 *
 * Producer contract:
 *   - `marketCode` defaults to `'AU'`; optional override is used for KR.
 *   - **`startDate` is OMITTED** — the worker resolves
 *     `historyStartFor(marketCode)`. Yahoo per-ticker truncation makes
 *     full-history requests safe for AU/KR (returns the available subrange).
 *   - `singletonKey: \`${ticker}:${marketCode}\`` per
 *     `.claude/rules/pgboss-composite-singleton-key.md` — composite key prevents
 *     a same-ticker market warm-up from colliding with sibling-market backfills.
 *   - `priority` from `getEffectiveDailyRefreshPriority()` (Tier 2 admin lever).
 *   - `trigger: 'admin_rerun'` (only the admin Re-run-now route calls this; the
 *     param is forwarded so future callers — e.g. the deferred KZO-203
 *     auto-trigger — can pass `'first_trade'` or `'retry'`).
 *
 * Memory-backend behavior (per scope-todo):
 *   - When `boss === null` (memory backend / E2E without pg-boss), skip the
 *     dispatch but return `{tickerCount: 0, batchId: null}` so the route still
 *     stamps the audit + cooldown.
 *
 * Disjoint with `enqueueDailyRefresh({marketFilter})` by definition:
 * the catalog warm-up only enumerates `(pending,failed)` rows, while the
 * monitored refresh only enumerates `ready` + monitored rows. Same-ticker
 * collisions across the two paths can't happen because the status filter is
 * mutually exclusive.
 */
export async function enqueueAuCatalogBarsBackfill(
  boss: Pick<PgBoss, "send"> | null,
  persistence: Pick<Persistence, "listAuCatalogBarsBackfillCandidates"> & {
    listCatalogBarsBackfillCandidates?: Persistence["listCatalogBarsBackfillCandidates"];
    // Optional — when present, the helper allocates a refresh batch for
    // observability (mirrors `enqueueDailyRefresh`). When absent (e.g. unit
    // tests that only care about `boss.send` shape), the helper falls back
    // to a fresh UUID. The runtime `Persistence` always implements this.
    createRefreshBatch?: Persistence["createRefreshBatch"];
  },
  log: { info: (...args: unknown[]) => void },
  options: {
    trigger: BackfillJobData["trigger"];
    marketCode?: MarketCode;
    resolverMode?: BackfillJobData["resolverMode"];
  },
): Promise<{ tickerCount: number; batchId: string | null }> {
  const marketCode = options.marketCode ?? "AU";
  const candidates = marketCode === "AU"
    ? await persistence.listAuCatalogBarsBackfillCandidates()
    : await requireCatalogBarsBackfillCandidates(persistence, marketCode);
  if (candidates.length === 0) {
    log.info(
      { trigger: options.trigger, marketCode },
      "catalog_bars_backfill_skipped_empty",
    );
    return { tickerCount: 0, batchId: null };
  }

  // Memory backend / no pg-boss — return the no-op shape so the route still
  // stamps cooldown + audit. Mirrors the `app.boss === null` pattern in
  // `enqueueDailyRefresh`'s caller. Skips `createRefreshBatch` too — there's
  // no batch to report when no jobs will run.
  if (boss === null) {
    log.info(
      { trigger: options.trigger, marketCode, candidateCount: candidates.length },
      "catalog_bars_backfill_skipped_no_boss",
    );
    return { tickerCount: 0, batchId: null };
  }

  // Allocate a refresh batch (mirror of `enqueueDailyRefresh`) so the warm-up
  // is observable through the same batch-reporting UI: the worker's
  // `updateBatchTickerResult` calls thread per-job outcomes back into the
  // batch, and the route's audit metadata carries the `batchId` so admins can
  // correlate the click with downstream completion events. Falls back to a
  // fresh UUID if `createRefreshBatch` is not exposed by the structural
  // persistence stub (tests).
  const batchId = persistence.createRefreshBatch
    ? await persistence.createRefreshBatch(null, candidates.length)
    : randomUUID();

  await Promise.all(
    candidates.map(({ ticker, marketCode }) =>
      boss.send(
        BACKFILL_QUEUE,
        {
          ticker,
          marketCode,
          trigger: options.trigger,
          batchId,
          ...(options.resolverMode ? { resolverMode: options.resolverMode } : {}),
          includeBars: true,
          includeDividends: true,
          // startDate intentionally omitted — worker resolves historyStartFor(marketCode).
        } satisfies BackfillJobData,
        {
          priority: getEffectiveDailyRefreshPriority(),
          singletonKey: `${ticker}:${marketCode}`,
        },
      ),
    ),
  );

  log.info(
    { tickerCount: candidates.length, batchId, trigger: options.trigger, marketCode },
    "catalog_bars_backfill_enqueued",
  );

  return { tickerCount: candidates.length, batchId };
}

function requireCatalogBarsBackfillCandidates(
  persistence: {
    listCatalogBarsBackfillCandidates?: Persistence["listCatalogBarsBackfillCandidates"];
  },
  marketCode: MarketCode,
): Promise<Array<{ ticker: string; marketCode: MarketCode }>> {
  if (!persistence.listCatalogBarsBackfillCandidates) {
    throw new Error("listCatalogBarsBackfillCandidates is required for non-AU catalog warm-up");
  }
  return persistence.listCatalogBarsBackfillCandidates(marketCode);
}
