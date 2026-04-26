import type { EnvConfig } from "@tw-portfolio/config";
import type { MarketCode } from "@tw-portfolio/domain";
import type { FxRateProvider, InstrumentCatalogProvider, MarketDataProvider } from "./types.js";
import { RateLimiter } from "./rateLimiter.js";
import {
  FinMindMarketDataProvider,
  FrankfurterFxRateProvider,
  MockFinMindMarketDataProvider,
  MockFrankfurterFxRateProvider,
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

  const marketData = new Map<MarketCode, MarketDataProvider>();
  const catalog = new Map<MarketCode, InstrumentCatalogProvider>();

  // Same instance registered under both interfaces — FinMind covers TW for both today.
  marketData.set("TW", finmindProvider);
  catalog.set("TW", finmindProvider);

  const fxRate: FxRateProvider = env.FX_PROVIDER_MOCK
    ? new MockFrankfurterFxRateProvider()
    : new FrankfurterFxRateProvider({ baseUrl: env.FRANKFURTER_BASE_URL });

  return { marketData, catalog, fxRate };
}
