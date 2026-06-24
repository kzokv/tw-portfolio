import type { EnvConfig } from "@vakwen/config";
import type { MarketCode } from "@vakwen/domain";
import type { Persistence } from "../../persistence/types.js";
import type { FxRateProvider, InstrumentCatalogProvider, MarketDataProvider } from "./types.js";
import { RateLimiter } from "./rateLimiter.js";
import {
  getEffectiveFinmindApiToken,
  getEffectiveTwelveDataApiKey,
} from "../appConfig/providerKeys.js";
import { getAppConfigCacheEntry } from "../appConfig/cache.js";
import {
  FinMindMarketDataProvider,
  FinMindUsStockMarketDataProvider,
  FrankfurterFxRateProvider,
  MockFinMindMarketDataProvider,
  MockFinMindUsStockMarketDataProvider,
  MockFrankfurterFxRateProvider,
  MockTwelveDataAuCatalogProvider,
  MockTwelveDataKrCatalogProvider,
  MockYahooFinanceAuMarketDataProvider,
  MockYahooFinanceKrMarketDataProvider,
  TwelveDataAuCatalogProvider,
  TwelveDataKrCatalogProvider,
  YahooFinanceAuMarketDataProvider,
  YahooFinanceKrMarketDataProvider,
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
 * KZO-200 — minimal logger shape consumed by `buildMarketDataRegistry`. Pino's
 * structured logger satisfies this; tests can pass a stub. Optional so call
 * sites that don't have a logger handy (e.g. legacy unit tests) keep working.
 */
interface RegistryLogger {
  info: (...args: unknown[]) => void;
}

/**
 * Build the per-market provider registry from runtime env config. Centralizes the
 * `Env.FINMIND_API_TOKEN ? real : mock` selection that was duplicated in `pgBoss.ts` and
 * `registerRoutes.ts`. Even when a token is set, the rate limiter and base URL are still
 * threaded through so behavior is uniform across dev/prod.
 *
 * KZO-164 — also constructs the singleton `fxRate` provider, branching on
 * `env.FX_PROVIDER_MOCK` so tests/dev can opt into the deterministic mock.
 *
 * KZO-200 — emits a per-provider `market_data_registry_provider_selected`
 * boot-time log with `branch ∈ {real, mock_forced_by_env, mock_no_key}` and
 * `bootstrapKeySource ∈ {app_config, env, null}`. This is the operational
 * signal that catches silent fallback (e.g. parsed `*_MOCK=true` while the
 * literal env var is `false`, or a DB-only API key that didn't reach the
 * resolver) — without it, the only symptom is "the catalog is the 5-row
 * mock fixture" with no provenance.
 */
export function buildMarketDataRegistry(
  env: EnvConfig,
  log?: RegistryLogger,
  persistence?: Pick<Persistence, "getInstrument" | "getProviderResolutionMapping">,
): MarketDataRegistry {
  function emit(
    providerId: string,
    branch: "real" | "mock_forced_by_env" | "mock_no_key",
    bootstrapKeySource: "app_config" | "env" | null,
  ): void {
    log?.info(
      { providerId, branch, bootstrapKeySource },
      "market_data_registry_provider_selected",
    );
  }

  const providerBudget = {
    finmindPerHour: () => getAppConfigCacheEntry()?.finmindProviderRateLimitPerHour ?? env.FINMIND_RATE_LIMIT_PER_HOUR,
    twelveDataPerMinute: () => getAppConfigCacheEntry()?.twelveDataProviderRateLimitPerMinute ?? env.TWELVE_DATA_RATE_LIMIT_PER_MINUTE,
    yahooAuPerMinute: () => getAppConfigCacheEntry()?.yahooAuProviderRateLimitPerMinute ?? env.YAHOO_AU_RATE_LIMIT_PER_MINUTE,
    yahooKrPerMinute: () => getAppConfigCacheEntry()?.yahooKrProviderRateLimitPerMinute ?? env.YAHOO_KR_RATE_LIMIT_PER_MINUTE,
    frankfurterPerMinute: () => getAppConfigCacheEntry()?.frankfurterProviderRateLimitPerMinute ?? env.FRANKFURTER_RATE_LIMIT_PER_MINUTE,
  };
  const providerMinRequestInterval = {
    yahooKrMs: () => getAppConfigCacheEntry()?.yahooKrProviderMinRequestIntervalMs ?? 1_000,
  };

  const finmindLimiter = new RateLimiter(providerBudget.finmindPerHour);

  // KZO-198: real-vs-mock gate consults the `app_config` cache (via the
  // resolver) BEFORE falling back to env. `buildApp` eagerly pre-warms the
  // cache before calling this function, so a fresh deploy whose API token
  // lives in `app_config.finmind_api_token` (rather than env) selects the
  // real provider on the first run instead of degrading to mock.
  // The provider's internal `get token()` re-reads per fetch (rotation
  // remains live; no client rebuild needed).
  // KZO-200: source-detection inspects the cache entry directly so the boot
  // log distinguishes "key came from app_config" vs "resolver fell back to
  // env." The resolver itself returns the env fallback when the cache has no
  // override, so calling `getEffective*()` alone can't tell the two apart.
  const finmindCacheHasKey =
    getAppConfigCacheEntry()?.finmindApiTokenEncrypted != null;
  const finmindBootstrapToken = getEffectiveFinmindApiToken() ?? env.FINMIND_API_TOKEN;
  const finmindKeySource: "app_config" | "env" | null = finmindCacheHasKey
    ? "app_config"
    : env.FINMIND_API_TOKEN
      ? "env"
      : null;

  const finmindProvider: MarketDataProvider & InstrumentCatalogProvider = finmindBootstrapToken
    ? new FinMindMarketDataProvider({
        token: finmindBootstrapToken,
        baseUrl: env.FINMIND_BASE_URL,
        rateLimiter: finmindLimiter,
      })
    : new MockFinMindMarketDataProvider();
  emit(
    "finmind-tw",
    finmindBootstrapToken ? "real" : "mock_no_key",
    finmindKeySource,
  );

  // KZO-170 S9: US-stock provider, parallel to TW. Real branch shares the same
  // `finmindLimiter` instance — both TW and US dispatch against FinMind's single
  // per-hour budget, so the limiter must be shared for the budget contract to hold.
  // Mock branch uses `MockFinMindUsStockMarketDataProvider` with its default fixture
  // start (`2024-01-02`); tests that exercise truncation use the constructor variant
  // with `fixtureStartDate` directly rather than going through the registry.
  const usStockProvider: MarketDataProvider & InstrumentCatalogProvider = finmindBootstrapToken
    ? new FinMindUsStockMarketDataProvider({
        token: finmindBootstrapToken,
        baseUrl: env.FINMIND_BASE_URL,
        rateLimiter: finmindLimiter,
      })
    : new MockFinMindUsStockMarketDataProvider();
  emit(
    "finmind-us",
    finmindBootstrapToken ? "real" : "mock_no_key",
    finmindKeySource,
  );

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
  const yahooAuLimiter = new RateLimiter(providerBudget.yahooAuPerMinute, 60_000);
  const yahooAuProvider: MarketDataProvider & InstrumentCatalogProvider = env.AU_PROVIDER_MOCK
    ? new MockYahooFinanceAuMarketDataProvider()
    : new YahooFinanceAuMarketDataProvider({ rateLimiter: yahooAuLimiter });
  // Yahoo AU has no API key — `bootstrapKeySource` is always null. Branch is
  // `mock_forced_by_env` when AU_PROVIDER_MOCK is true, otherwise `real`.
  emit(
    "yahoo-finance-au",
    env.AU_PROVIDER_MOCK ? "mock_forced_by_env" : "real",
    null,
  );

  const twelveDataRateLimiter = new RateLimiter(providerBudget.twelveDataPerMinute, 60_000);
  // KZO-198: same gate semantics as FinMind above — consult resolver first.
  // KZO-200: source-detection via the cache entry (see FinMind comment above).
  const twelveDataCacheHasKey =
    getAppConfigCacheEntry()?.twelveDataApiKeyEncrypted != null;
  const twelveDataBootstrapKey = getEffectiveTwelveDataApiKey() ?? env.TWELVE_DATA_API_KEY;
  const twelveDataKeySource: "app_config" | "env" | null = twelveDataCacheHasKey
    ? "app_config"
    : env.TWELVE_DATA_API_KEY
      ? "env"
      : null;
  const twelveDataAuCatalog: InstrumentCatalogProvider =
    env.AU_CATALOG_PROVIDER_MOCK || !twelveDataBootstrapKey
      ? new MockTwelveDataAuCatalogProvider({ yahooFallback: yahooAuProvider })
      : new TwelveDataAuCatalogProvider({
          apiKey: twelveDataBootstrapKey,
          baseUrl: env.TWELVE_DATA_BASE_URL,
          rateLimiter: twelveDataRateLimiter,
          yahooFallback: yahooAuProvider,
        });
  emit(
    "twelve-data-au",
    env.AU_CATALOG_PROVIDER_MOCK
      ? "mock_forced_by_env"
      : !twelveDataBootstrapKey
        ? "mock_no_key"
        : "real",
    twelveDataKeySource,
  );

  marketData.set("AU", yahooAuProvider);
  catalog.set("AU", twelveDataAuCatalog);

  // KR: free-provider parity mirrors AU. Twelve Data owns KRX catalog
  // enumeration (`/stocks?exchange=KRX` + `/etf?exchange=KRX`) while Yahoo
  // owns bars, cash dividends, metadata, and search via internal `.KS/.KQ`
  // suffix resolution. The shared Twelve Data limiter reflects the single
  // account-level free quota across AU + KR catalog endpoints.
  const yahooKrLimiter = new RateLimiter(providerBudget.yahooKrPerMinute, 60_000);
  const yahooKrProvider: MarketDataProvider & InstrumentCatalogProvider = env.KR_PROVIDER_MOCK
    ? new MockYahooFinanceKrMarketDataProvider()
    : new YahooFinanceKrMarketDataProvider({
        rateLimiter: yahooKrLimiter,
        minRequestIntervalMs: providerMinRequestInterval.yahooKrMs,
        resolverMode: env.YAHOO_KR_RESOLVER_MODE,
        persistence,
      });
  emit(
    "yahoo-finance-kr",
    env.KR_PROVIDER_MOCK ? "mock_forced_by_env" : "real",
    null,
  );

  const twelveDataKrCatalog: InstrumentCatalogProvider =
    env.KR_CATALOG_PROVIDER_MOCK || !twelveDataBootstrapKey
      ? new MockTwelveDataKrCatalogProvider({ yahooFallback: yahooKrProvider })
      : new TwelveDataKrCatalogProvider({
          apiKey: twelveDataBootstrapKey,
          baseUrl: env.TWELVE_DATA_BASE_URL,
          rateLimiter: twelveDataRateLimiter,
          yahooFallback: yahooKrProvider,
        });
  emit(
    "twelve-data-kr",
    env.KR_CATALOG_PROVIDER_MOCK
      ? "mock_forced_by_env"
      : !twelveDataBootstrapKey
        ? "mock_no_key"
        : "real",
    twelveDataKeySource,
  );

  marketData.set("KR", yahooKrProvider);
  catalog.set("KR", twelveDataKrCatalog);

  const fxRate: FxRateProvider = env.FX_PROVIDER_MOCK
    ? new MockFrankfurterFxRateProvider()
    : new FrankfurterFxRateProvider({
        baseUrl: env.FRANKFURTER_BASE_URL,
        rateLimiter: new RateLimiter(providerBudget.frankfurterPerMinute, 60_000),
      });
  // Frankfurter is keyless. Branch is `mock_forced_by_env` when
  // FX_PROVIDER_MOCK is true, otherwise `real`.
  emit(
    "frankfurter",
    env.FX_PROVIDER_MOCK ? "mock_forced_by_env" : "real",
    null,
  );

  return { marketData, catalog, fxRate };
}
