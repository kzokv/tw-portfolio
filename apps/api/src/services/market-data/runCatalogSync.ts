import type { MarketCode } from "@tw-portfolio/domain";
import type { InstrumentCatalogProvider } from "./types.js";
import type { Persistence, CatalogSyncResult } from "../../persistence/types.js";
import { deduplicateInstruments, buildCatalogInstruments } from "./catalogSync.js";

export interface CatalogSyncDeps {
  catalogProvider: InstrumentCatalogProvider;
  // KZO-170 S4: market code stamped on every instrument + delisting row so the
  // composite-key persistence layer can isolate per-market state. The catalog
  // sync worker invokes `runCatalogSync` once per registered market.
  marketCode: MarketCode;
  persistence: Pick<Persistence, "upsertInstrumentCatalog">;
  log: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
}

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

  const result = await persistence.upsertInstrumentCatalog(
    catalog,
    delistings.map((d) => ({ ticker: d.ticker, name: d.name, date: d.date, marketCode })),
  );

  log.info(
    { marketCode, upserted: result.upserted, delisted: result.delisted },
    "[catalog-sync] Sync complete",
  );
  return result;
}
