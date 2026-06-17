import type { FastifyInstance } from "fastify";
import { routeError } from "./routeError.js";
import { sweepSlidingWindowBucket } from "./slidingWindowBucket.js";
import { getEffectiveTickerPriceFreshnessConfig } from "../services/appConfig/tickerPriceFreshness.js";

const refreshCloseBuckets = new Map<string, number[]>();

export function assertTickerPriceRefreshCloseRateLimit(key: string): void {
  const config = getEffectiveTickerPriceFreshnessConfig();
  const now = Date.now();
  const recent = (refreshCloseBuckets.get(key) ?? []).filter(
    (timestamp) => now - timestamp < config.refreshCloseRateLimitWindowMs,
  );
  if (recent.length >= config.refreshCloseRateLimitMax) {
    throw routeError(429, "rate_limit_exceeded", "rate limit exceeded");
  }
  recent.push(now);
  refreshCloseBuckets.set(key, recent);
}

export function _resetTickerPriceRefreshCloseBuckets(): void {
  refreshCloseBuckets.clear();
}

export function registerTickerPriceRefreshCloseEviction(app: FastifyInstance): void {
  const timer = setInterval(
    () => sweepSlidingWindowBucket(
      refreshCloseBuckets,
      getEffectiveTickerPriceFreshnessConfig().refreshCloseRateLimitWindowMs,
    ),
    getEffectiveTickerPriceFreshnessConfig().refreshCloseRateLimitWindowMs,
  );
  app.addHook("onClose", () => { clearInterval(timer); });
}
