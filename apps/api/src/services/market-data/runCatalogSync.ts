import type { MarketCode } from "@tw-portfolio/domain";
import type { InstrumentCatalogProvider } from "./types.js";
import type { Persistence, CatalogSyncResult } from "../../persistence/types.js";
import { deduplicateInstruments, buildCatalogInstruments } from "./catalogSync.js";
import {
  detectDelistingsByAbsence,
  type AbsentRow,
  type DetectionPlan,
} from "./detectDelistingsByAbsence.js";
import {
  getEffectiveCatalogAbsenceThreshold,
  getEffectiveCatalogAbsenceGuardPercent,
  getEffectiveCatalogAbsenceGuardFloor,
} from "../appConfig/catalogAbsence.js";

export interface CatalogSyncDeps {
  catalogProvider: InstrumentCatalogProvider;
  // KZO-170 S4: market code stamped on every instrument + delisting row so the
  // composite-key persistence layer can isolate per-market state. The catalog
  // sync worker invokes `runCatalogSync` once per registered market.
  marketCode: MarketCode;
  persistence: Pick<Persistence, "upsertInstrumentCatalog">;
  log: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
}

/**
 * KZO-195 — orchestrator branches on `provider.supportsDelistingFeed`:
 *   - `true` (FinMind TW today): use the upstream delisting feed; no diff
 *     detection wired in.
 *   - `false` (AU via Twelve Data; US flips on later): wire the pure
 *     `detectDelistingsByAbsence` function as the persistence-layer
 *     `absenceDetection.categorize` callback. Provider's
 *     `fetchDelistingHistory()` may still be called and is expected to return
 *     [] today — combining is harmless and keeps the call path uniform.
 */
export async function runCatalogSync(deps: CatalogSyncDeps): Promise<CatalogSyncResult> {
  const { catalogProvider, marketCode, persistence, log } = deps;

  log.info({ marketCode }, "[catalog-sync] Fetching instrument catalog...");
  const rawCatalog = await catalogProvider.fetchInstrumentCatalog();
  log.info({ marketCode, rawCount: rawCatalog.length }, "[catalog-sync] Fetched raw rows");

  const deduped = deduplicateInstruments(rawCatalog);
  // KZO-170 S4: thread `marketCode` into the classifier path so US callers route
  // through the per-market allow-list instead of the TW substring scan.
  const catalog = buildCatalogInstruments(deduped, marketCode);
  const unmappable = catalog.filter((c) => c.instrumentType === null).length;
  log.info(
    { marketCode, dedupedCount: deduped.length, classified: catalog.length - unmappable, unmappable },
    "[catalog-sync] Classified",
  );

  log.info({ marketCode }, "[catalog-sync] Fetching delisting history...");
  const delistings = await catalogProvider.fetchDelistingHistory();
  log.info({ marketCode, delistingCount: delistings.length }, "[catalog-sync] Fetched delistings");

  const supportsFeed = catalogProvider.supportsDelistingFeed;
  const useAbsenceDetection = catalogProvider.absenceDetectionEnabled;
  const stampedDelistings = delistings.map((d) => ({
    ticker: d.ticker,
    name: d.name,
    date: d.date,
    marketCode,
    source: "provider_feed" as const,
  }));

  // KZO-195 iter 9 (Codex P1) — three-way gate:
  //   1. supportsFeed=true → provider-feed path (TW today). Persistence
  //      stamps `delisted_at` from upstream rows; no absence-detection state.
  //   2. supportsFeed=false && absenceDetectionEnabled=true → AU diff path.
  //      Persistence stamps `last_seen_in_catalog_at`, runs the detector,
  //      and bumps streaks / stamps absence-delistings.
  //   3. supportsFeed=false && absenceDetectionEnabled=false → bare upsert
  //      (US, Yahoo AU, future markets). No `last_seen_in_catalog_at`
  //      stamping, no streak bumps, no detector. The persistence layer
  //      already only stamps absence state when `options.absenceDetection`
  //      is provided, so omitting the option is sufficient.
  const result = supportsFeed
    ? await persistence.upsertInstrumentCatalog(catalog, stampedDelistings)
    : useAbsenceDetection
      ? await persistence.upsertInstrumentCatalog(catalog, stampedDelistings, {
          absenceDetection: {
            marketCode,
            categorize: (absent: AbsentRow[], prevCatalogSize: number): DetectionPlan =>
              detectDelistingsByAbsence(absent, {
                threshold: getEffectiveCatalogAbsenceThreshold(),
                guardPercent: getEffectiveCatalogAbsenceGuardPercent(),
                guardFloor: getEffectiveCatalogAbsenceGuardFloor(),
                prevCatalogSize,
              }),
          },
        })
      : await persistence.upsertInstrumentCatalog(catalog, stampedDelistings);

  log.info(
    {
      marketCode,
      upserted: result.upserted,
      delisted: result.delisted,
      absent: result.absent,
      guardTripped: result.guardTripped,
    },
    "[catalog-sync] Sync complete",
  );

  if (result.guardTripped) {
    log.warn(
      { marketCode, candidateCount: result.absent, absentTickers: result.absentTickers.slice(0, 50) },
      "[catalog-sync] mass-delisting guard tripped — skipped streak bump and stamp",
    );
  }

  return result;
}
