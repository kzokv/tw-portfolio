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

export function buildFundamentalsRegistry(env?: Pick<EnvConfig, "NODE_ENV" | "AU_PROVIDER_MOCK" | "YAHOO_AU_RATE_LIMIT_PER_MINUTE">): FundamentalsRegistry {
  if (env?.NODE_ENV !== "test" && !env?.AU_PROVIDER_MOCK) {
    const yahooLimiter = new RateLimiter(env?.YAHOO_AU_RATE_LIMIT_PER_MINUTE ?? 60, 60_000);
    return new Map<MarketCode, FundamentalsProvider>([
      ["TW", new YahooFundamentalsProvider({ marketCode: "TW", rateLimiter: yahooLimiter })],
      ["US", new YahooFundamentalsProvider({ marketCode: "US", rateLimiter: yahooLimiter })],
      ["AU", new YahooFundamentalsProvider({ marketCode: "AU", rateLimiter: yahooLimiter })],
    ]);
  }

  return new Map<MarketCode, FundamentalsProvider>([
    ["TW", new NullFundamentalsProvider("mock-fundamentals-tw")],
    ["US", new NullFundamentalsProvider("mock-fundamentals-us")],
    ["AU", new NullFundamentalsProvider("mock-fundamentals-au")],
  ]);
}
