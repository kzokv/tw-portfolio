import type { FastifyInstance } from "fastify";
import { Env } from "@tw-portfolio/config";
import { routeError } from "./routeError.js";
import { sweepSlidingWindowBucket } from "./slidingWindowBucket.js";

/**
 * KZO-172 — per-IP sliding-window rate limiter for `GET /market-data/search`. Default
 * 20 requests/minute (`MARKET_DATA_SEARCH_RATE_LIMIT_PER_MINUTE`). Generous enough for
 * typeahead UX while keeping abuse off Yahoo's bounded budget.
 *
 * Pattern mirrors `marketDataPriceRateLimit.ts` exactly — same module-state shape,
 * same eviction lifecycle factory (`registerMarketDataSearchEviction(app)`) per
 * `.claude/rules/fastify-eviction-lifecycle-pattern.md`.
 *
 * Throws `429 rate_limit_exceeded` (per-client identity throttle). Distinct from the
 * `503 provider_rate_limited` the route emits when Yahoo's per-provider budget is
 * exhausted — see `.claude/rules/service-error-pattern.md` "Distinguishing per-client
 * vs upstream-budget rate limits".
 */
const marketDataSearchBuckets = new Map<string, number[]>();
const MARKET_DATA_SEARCH_WINDOW_MS = 60_000;

export function assertMarketDataSearchRateLimit(ip: string): void {
  // Read the limit at call time (not module load) so vitest's `vi.mock` of `Env` takes
  // effect before the first route hit. Same convention as the inviteStatus + anonymous-
  // share limiters in this directory.
  const limit = Env.MARKET_DATA_SEARCH_RATE_LIMIT_PER_MINUTE;
  const now = Date.now();
  const recent = (marketDataSearchBuckets.get(ip) ?? []).filter(
    (timestamp) => now - timestamp < MARKET_DATA_SEARCH_WINDOW_MS,
  );
  if (recent.length >= limit) {
    throw routeError(429, "rate_limit_exceeded", "rate limit exceeded");
  }
  recent.push(now);
  marketDataSearchBuckets.set(ip, recent);
}

/** @internal — test-only helper to reset the per-IP buckets between test runs. */
export function _resetMarketDataSearchBuckets(): void {
  marketDataSearchBuckets.clear();
}

export function registerMarketDataSearchEviction(app: FastifyInstance): void {
  const timer = setInterval(
    () => sweepSlidingWindowBucket(marketDataSearchBuckets, MARKET_DATA_SEARCH_WINDOW_MS),
    MARKET_DATA_SEARCH_WINDOW_MS,
  );
  app.addHook("onClose", () => {
    clearInterval(timer);
  });
}
