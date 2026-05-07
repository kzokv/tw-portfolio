import type { EnvConfig } from "@tw-portfolio/config";
import type { MarketCode } from "@tw-portfolio/domain";
import type { FxRateProvider, InstrumentCatalogProvider, MarketDataProvider } from "./types.js";
import { RateLimiter } from "./rateLimiter.js";
import {
  FinMindMarketDataProvider,
  FinMindUsStockMarketDataProvider,
  FrankfurterFxRateProvider,
  MockFinMindMarketDataProvider,
  MockFinMindUsStockMarketDataProvider,
  MockFrankfurterFxRateProvider,
  MockTwelveDataAuCatalogProvider,
  MockYahooFinanceAuMarketDataProvider,
  TwelveDataAuCatalogProvider,
  YahooFinanceAuMarketDataProvider,
} from "./providers/index.js";

/**
 * Per-market registry of data + catalog providers. KZO-163 — single composition root that
 * collapses the previous duplicate construction sites in `pgBoss.ts` and `registerRoutes.ts`.
 * Both maps may register the same instance under a single market when one provider class
 * implements both interfaces (FinMind does today).
 *
 * KZO-164 — `fxRate` is a singleton field (NOT a per-market Map) because there is one FX
 * provider for the whole app. A `Map<MarketCode, FxRateProvider>` would be a degenerate
 * single-entry map.
 */
export interface MarketDataRegistry {
  marketData: Map<MarketCode, MarketDataProvider>;
  catalog: Map<MarketCode, InstrumentCatalogProvider>;
  fxRate: FxRateProvider;
}

/**
 * Build the per-market provider registry from runtime env config. Centralizes the
 * `Env.FINMIND_API_TOKEN ? real : mock` selection that was duplicated in `pgBoss.ts` and
 * `registerRoutes.ts`. Even when a token is set, the rate limiter and base URL are still
 * threaded through so behavior is uniform across dev/prod.
 *
 * KZO-164 — also constructs the singleton `fxRate` provider, branching on
 * `env.FX_PROVIDER_MOCK` so tests/dev can opt into the deterministic mock.
 */
export function buildMarketDataRegistry(env: EnvConfig): MarketDataRegistry {
  const finmindLimiter = new RateLimiter(env.FINMIND_RATE_LIMIT_PER_HOUR);

  const finmindProvider: MarketDataProvider & InstrumentCatalogProvider = env.FINMIND_API_TOKEN
    ? new FinMindMarketDataProvider({
        token: env.FINMIND_API_TOKEN,
        baseUrl: env.FINMIND_BASE_URL,
        rateLimiter: finmindLimiter,
      })
    : new MockFinMindMarketDataProvider();

  // KZO-170 S9: US-stock provider, parallel to TW. Real branch shares the same
  // `finmindLimiter` instance — both TW and US dispatch against FinMind's single
  // per-hour budget, so the limiter must be shared for the budget contract to hold.
  // Mock branch uses `MockFinMindUsStockMarketDataProvider` with its default fixture
  // start (`2024-01-02`); tests that exercise truncation use the constructor variant
  // with `fixtureStartDate` directly rather than going through the registry.
  const usStockProvider: MarketDataProvider & InstrumentCatalogProvider = env.FINMIND_API_TOKEN
    ? new FinMindUsStockMarketDataProvider({
        token: env.FINMIND_API_TOKEN,
        baseUrl: env.FINMIND_BASE_URL,
        rateLimiter: finmindLimiter,
      })
    : new MockFinMindUsStockMarketDataProvider();

  const marketData = new Map<MarketCode, MarketDataProvider>();
  const catalog = new Map<MarketCode, InstrumentCatalogProvider>();

  // Same instance registered under both interfaces — FinMind covers TW for both today.
  marketData.set("TW", finmindProvider);
  catalog.set("TW", finmindProvider);

  // KZO-170 S9: US covers price + catalog. Dividends + delistings are intentional
  // empty implementations — see `FinMindUsStockMarketDataProvider` JSDoc for the
  // FinMind v4 dataset gap and KZO-187 (US dividend ingestion follow-up).
  marketData.set("US", usStockProvider);
  catalog.set("US", usStockProvider);

  // KZO-172: AU bars/dividends/metadata/search via yahoo-finance2. Yahoo does NOT share
  // the FinMind 600/hr budget — it has its own self-imposed precautionary ceiling
  // (`YAHOO_AU_RATE_LIMIT_PER_MINUTE`, default 60/min from spike §5).
  //
  // KZO-194: AU catalog is now owned by `TwelveDataAuCatalogProvider` (free-tier
  // `/stocks?exchange=ASX` + `/etf?exchange=ASX`). Yahoo's `fetchInstrumentCatalog()`
  // returns `[]`. The TD provider composes the Yahoo provider as `yahooFallback` so
  // `fetchInstrumentMetadata` + `searchInstruments` keep working for tickers TD's bulk
  // catalog doesn't enumerate (e.g. LICs).
  const yahooAuLimiter = new RateLimiter(env.YAHOO_AU_RATE_LIMIT_PER_MINUTE, 60_000);
  const yahooAuProvider: MarketDataProvider & InstrumentCatalogProvider = env.AU_PROVIDER_MOCK
    ? new MockYahooFinanceAuMarketDataProvider()
    : new YahooFinanceAuMarketDataProvider({ rateLimiter: yahooAuLimiter });

  const twelveDataAuRateLimiter = new RateLimiter(env.TWELVE_DATA_RATE_LIMIT_PER_MINUTE, 60_000);
  const twelveDataAuCatalog: InstrumentCatalogProvider =
    env.AU_CATALOG_PROVIDER_MOCK || !env.TWELVE_DATA_API_KEY
      ? new MockTwelveDataAuCatalogProvider({ yahooFallback: yahooAuProvider })
      : new TwelveDataAuCatalogProvider({
          apiKey: env.TWELVE_DATA_API_KEY,
          baseUrl: env.TWELVE_DATA_BASE_URL,
          rateLimiter: twelveDataAuRateLimiter,
          yahooFallback: yahooAuProvider,
        });

  marketData.set("AU", yahooAuProvider);
  catalog.set("AU", twelveDataAuCatalog);

  const fxRate: FxRateProvider = env.FX_PROVIDER_MOCK
    ? new MockFrankfurterFxRateProvider()
    : new FrankfurterFxRateProvider({ baseUrl: env.FRANKFURTER_BASE_URL });

  return { marketData, catalog, fxRate };
}
