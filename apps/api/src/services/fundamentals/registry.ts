import type { MarketCode } from "@vakwen/domain";
import type { TickerFundamentalsDto } from "@vakwen/shared-types";
import type { EnvConfig } from "@vakwen/config";
import { RateLimiter } from "../market-data/rateLimiter.js";
import { createEmptyTickerFundamentals, type FundamentalsProvider, type FundamentalsRegistry } from "./types.js";
import { YahooFundamentalsProvider } from "./yahooFinance.js";

class NullFundamentalsProvider implements FundamentalsProvider {
  constructor(readonly providerId: string) {}

  async fetchFundamentals(_input: { ticker: string; marketCode: MarketCode }): Promise<TickerFundamentalsDto> {
    return createEmptyTickerFundamentals();
  }
}

export function buildFundamentalsRegistry(env?: Pick<EnvConfig,
  "NODE_ENV"
  | "AU_PROVIDER_MOCK"
  | "KR_PROVIDER_MOCK"
  | "YAHOO_AU_RATE_LIMIT_PER_MINUTE"
  | "YAHOO_KR_RATE_LIMIT_PER_MINUTE"
>): FundamentalsRegistry {
  if (env?.NODE_ENV !== "test") {
    const yahooAuLimiter = new RateLimiter(env?.YAHOO_AU_RATE_LIMIT_PER_MINUTE ?? 60, 60_000);
    const yahooKrLimiter = new RateLimiter(env?.YAHOO_KR_RATE_LIMIT_PER_MINUTE ?? 60, 60_000);
    const auLikeProvider = env?.AU_PROVIDER_MOCK
      ? new NullFundamentalsProvider("mock-fundamentals-au")
      : new YahooFundamentalsProvider({ marketCode: "AU", rateLimiter: yahooAuLimiter });
    const krProvider = env?.KR_PROVIDER_MOCK
      ? new NullFundamentalsProvider("mock-fundamentals-kr")
      : new YahooFundamentalsProvider({ marketCode: "KR", rateLimiter: yahooKrLimiter });
    return new Map<MarketCode, FundamentalsProvider>([
      ["TW", env?.AU_PROVIDER_MOCK ? new NullFundamentalsProvider("mock-fundamentals-tw") : new YahooFundamentalsProvider({ marketCode: "TW", rateLimiter: yahooAuLimiter })],
      ["US", env?.AU_PROVIDER_MOCK ? new NullFundamentalsProvider("mock-fundamentals-us") : new YahooFundamentalsProvider({ marketCode: "US", rateLimiter: yahooAuLimiter })],
      ["AU", auLikeProvider],
      ["KR", krProvider],
    ]);
  }

  return new Map<MarketCode, FundamentalsProvider>([
    ["TW", new NullFundamentalsProvider("mock-fundamentals-tw")],
    ["US", new NullFundamentalsProvider("mock-fundamentals-us")],
    ["AU", new NullFundamentalsProvider("mock-fundamentals-au")],
    ["KR", new NullFundamentalsProvider("mock-fundamentals-kr")],
  ]);
}
