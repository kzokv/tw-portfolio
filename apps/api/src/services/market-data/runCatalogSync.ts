import type { FinMindProvider } from "./types.js";
import type { Persistence, CatalogSyncResult } from "../../persistence/types.js";
import type { RateLimiter } from "./rateLimiter.js";
import { deduplicateInstruments, buildCatalogInstruments } from "./catalogSync.js";
import { routeError } from "../../lib/routeError.js";

export interface CatalogSyncDeps {
  finmind: FinMindProvider;
  rateLimiter: RateLimiter;
  persistence: Pick<Persistence, "upsertInstrumentCatalog">;
  log: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
}

export async function runCatalogSync(deps: CatalogSyncDeps): Promise<CatalogSyncResult> {
  const { finmind, rateLimiter, persistence, log } = deps;

  if (!rateLimiter.canConsume(2)) {
    throw routeError(429, "rate_limit_exceeded", "Rate limit budget insufficient for catalog sync (need 2 requests)");
  }
  rateLimiter.consume(2);

  log.info("[catalog-sync] Fetching instrument catalog from FinMind...");
  const rawCatalog = await finmind.fetchInstrumentCatalog();
  log.info(`[catalog-sync] Fetched ${rawCatalog.length} raw rows`);

  const deduped = deduplicateInstruments(rawCatalog);
  const catalog = buildCatalogInstruments(deduped);
  const unmappable = catalog.filter((c) => c.instrumentType === null).length;
  log.info(`[catalog-sync] Deduped: ${deduped.length}, classified: ${catalog.length - unmappable}, unmappable: ${unmappable}`);

  log.info("[catalog-sync] Fetching delisting history from FinMind...");
  const delistings = await finmind.fetchDelistingHistory();
  log.info(`[catalog-sync] Fetched ${delistings.length} delisting records`);

  const result = await persistence.upsertInstrumentCatalog(
    catalog,
    delistings.map((d) => ({ ticker: d.ticker, name: d.name, date: d.date })),
  );

  log.info(`[catalog-sync] Sync complete: upserted=${result.upserted}, delisted=${result.delisted}`);
  return result;
}
