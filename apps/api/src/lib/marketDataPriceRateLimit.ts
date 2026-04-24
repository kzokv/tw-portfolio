import type { FastifyInstance } from "fastify";
import { routeError } from "./routeError.js";
import { sweepSlidingWindowBucket } from "./slidingWindowBucket.js";

const marketDataPriceBuckets = new Map<string, number[]>();
const MARKET_DATA_PRICE_WINDOW_MS = 60_000;
const MARKET_DATA_PRICE_LIMIT = 30;

export function assertMarketDataPriceRateLimit(ip: string): void {
  const now = Date.now();
  const recent = (marketDataPriceBuckets.get(ip) ?? []).filter(
    (timestamp) => now - timestamp < MARKET_DATA_PRICE_WINDOW_MS,
  );
  if (recent.length >= MARKET_DATA_PRICE_LIMIT) {
    throw routeError(429, "rate_limit_exceeded", "rate limit exceeded");
  }
  recent.push(now);
  marketDataPriceBuckets.set(ip, recent);
}

export function _resetMarketDataPriceBuckets(): void {
  marketDataPriceBuckets.clear();
}

export function registerMarketDataPriceEviction(app: FastifyInstance): void {
  const timer = setInterval(
    () => sweepSlidingWindowBucket(marketDataPriceBuckets, MARKET_DATA_PRICE_WINDOW_MS),
    MARKET_DATA_PRICE_WINDOW_MS,
  );
  app.addHook("onClose", () => { clearInterval(timer); });
}
