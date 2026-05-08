import type { FastifyInstance } from "fastify";
import { Env } from "@tw-portfolio/config";
import { routeError } from "./routeError.js";
import { sweepSlidingWindowBucket } from "./slidingWindowBucket.js";
import {
  getEffectiveMarketDataPriceWindowMs,
  getEffectiveMarketDataPriceLimit,
} from "../services/appConfig/rateLimits.js";

const marketDataPriceBuckets = new Map<string, number[]>();

export function assertMarketDataPriceRateLimit(ip: string): void {
  // KZO-198: read live (DB override → env). Each request resolves the
  // effective window/limit so admin overrides take effect within cache TTL.
  const windowMs = getEffectiveMarketDataPriceWindowMs();
  const limit = getEffectiveMarketDataPriceLimit();
  const now = Date.now();
  const recent = (marketDataPriceBuckets.get(ip) ?? []).filter(
    (timestamp) => now - timestamp < windowMs,
  );
  if (recent.length >= limit) {
    throw routeError(429, "rate_limit_exceeded", "rate limit exceeded");
  }
  recent.push(now);
  marketDataPriceBuckets.set(ip, recent);
}

export function _resetMarketDataPriceBuckets(): void {
  marketDataPriceBuckets.clear();
}

export function registerMarketDataPriceEviction(app: FastifyInstance): void {
  // KZO-198 / fastify-eviction-lifecycle-pattern.md: the `setInterval`
  // CADENCE (interval argument) stays at boot-time env — load-bearing rule.
  // The sweep CALLBACK reads the effective window via the resolver so when
  // an admin extends the window, in-flight entries that are still within
  // the live window are not prematurely evicted.
  const timer = setInterval(
    () => sweepSlidingWindowBucket(marketDataPriceBuckets, getEffectiveMarketDataPriceWindowMs()),
    Env.MARKET_DATA_PRICE_WINDOW_MS,
  );
  app.addHook("onClose", () => { clearInterval(timer); });
}
