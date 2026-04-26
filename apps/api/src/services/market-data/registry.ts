import type { EnvConfig } from "@tw-portfolio/config";
import type { MarketCode } from "@tw-portfolio/domain";
import type { InstrumentCatalogProvider, MarketDataProvider } from "./types.js";
import { RateLimiter } from "./rateLimiter.js";
import { FinMindMarketDataProvider, MockFinMindMarketDataProvider } from "./providers/index.js";

/**
 * Per-market registry of data + catalog providers. KZO-163 — single composition root that
 * collapses the previous duplicate construction sites in `pgBoss.ts` and `registerRoutes.ts`.
 * Both maps may register the same instance under a single market when one provider class
 * implements both interfaces (FinMind does today).
 */
export interface MarketDataRegistry {
  marketData: Map<MarketCode, MarketDataProvider>;
  catalog: Map<MarketCode, InstrumentCatalogProvider>;
}

/**
 * Build the per-market provider registry from runtime env config. Centralizes the
 * `Env.FINMIND_API_TOKEN ? real : mock` selection that was duplicated in `pgBoss.ts` and
 * `registerRoutes.ts`. Even when a token is set, the rate limiter and base URL are still
 * threaded through so behavior is uniform across dev/prod.
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

  return { marketData, catalog };
}
