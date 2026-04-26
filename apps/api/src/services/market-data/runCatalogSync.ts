import type { InstrumentCatalogProvider } from "./types.js";
import type { Persistence, CatalogSyncResult } from "../../persistence/types.js";
import { deduplicateInstruments, buildCatalogInstruments } from "./catalogSync.js";

export interface CatalogSyncDeps {
  catalogProvider: InstrumentCatalogProvider;
  persistence: Pick<Persistence, "upsertInstrumentCatalog">;
  log: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
}

export async function runCatalogSync(deps: CatalogSyncDeps): Promise<CatalogSyncResult> {
  const { catalogProvider, persistence, log } = deps;

  log.info("[catalog-sync] Fetching instrument catalog...");
  const rawCatalog = await catalogProvider.fetchInstrumentCatalog();
  log.info(`[catalog-sync] Fetched ${rawCatalog.length} raw rows`);

  const deduped = deduplicateInstruments(rawCatalog);
  const catalog = buildCatalogInstruments(deduped);
  const unmappable = catalog.filter((c) => c.instrumentType === null).length;
  log.info(`[catalog-sync] Deduped: ${deduped.length}, classified: ${catalog.length - unmappable}, unmappable: ${unmappable}`);

  log.info("[catalog-sync] Fetching delisting history...");
  const delistings = await catalogProvider.fetchDelistingHistory();
  log.info(`[catalog-sync] Fetched ${delistings.length} delisting records`);

  const result = await persistence.upsertInstrumentCatalog(
    catalog,
    delistings.map((d) => ({ ticker: d.ticker, name: d.name, date: d.date })),
  );

  log.info(`[catalog-sync] Sync complete: upserted=${result.upserted}, delisted=${result.delisted}`);
  return result;
}
