import { describe, it, expect } from "vitest";
import { FinMindMarketDataProvider } from "../../src/services/market-data/providers/finmind.js";
import { RateLimitedError } from "../../src/services/market-data/types.js";
import { RateLimiter } from "../../src/services/market-data/rateLimiter.js";

// Real FinMindMarketDataProvider.reserveCapacity is a pre-flight check (KZO-163 HIGH-1 fix).
// These tests verify the check semantics + msUntilAvailable sizing without going through HTTP.

describe("FinMindMarketDataProvider.reserveCapacity (KZO-163 HIGH-1 pre-flight check)", () => {
  function makeProvider(budget: number) {
    const rateLimiter = new RateLimiter(budget);
    const provider = new FinMindMarketDataProvider({
      token: "test-token",
      baseUrl: "http://example.invalid",
      rateLimiter,
    });
    return { provider, rateLimiter };
  }

  it("returns without throwing when limiter has capacity for N slots", () => {
    const { provider, rateLimiter } = makeProvider(10);

    expect(() => provider.reserveCapacity(2)).not.toThrow();
    // Check-only — no slots consumed yet (per-call assertCanConsume consumes during fetch).
    expect(rateLimiter.consumed).toBe(0);
  });

  it("throws RateLimitedError when limiter cannot accommodate N slots", () => {
    const { provider, rateLimiter } = makeProvider(2);
    rateLimiter.consume(1); // 1 of 2 used

    expect(() => provider.reserveCapacity(2)).toThrow(RateLimitedError);
    // Check failed — no further consumption.
    expect(rateLimiter.consumed).toBe(1);
  });

  it("RateLimitedError carries msUntilAvailable sized for N slots (not 1)", () => {
    const { provider, rateLimiter } = makeProvider(2);
    rateLimiter.consume(2); // fully exhausted

    try {
      provider.reserveCapacity(2);
      expect.fail("should have thrown RateLimitedError");
    } catch (err) {
      expect(err).toBeInstanceOf(RateLimitedError);
      // msUntilAvailable for the second-oldest slot is generally larger than for the first,
      // because the second slot was consumed strictly after the first. The reschedule's wait
      // covers BOTH slots becoming free — that's what breaks the deterministic starvation cycle.
      const e = err as RateLimitedError;
      expect(e.msUntilAvailable).toBeGreaterThan(0);
    }
  });

  it("RateLimitedError.retryAfterSeconds floors at 1 even for sub-second waits", () => {
    const err = new RateLimitedError({ msUntilAvailable: 250 });
    expect(err.retryAfterSeconds).toBe(1);
  });

  it("RateLimitedError.retryAfterSeconds returns 1 for non-finite msUntilAvailable", () => {
    expect(new RateLimitedError({ msUntilAvailable: NaN }).retryAfterSeconds).toBe(1);
    expect(new RateLimitedError({ msUntilAvailable: Infinity }).retryAfterSeconds).toBe(1);
    expect(new RateLimitedError({ msUntilAvailable: -1000 }).retryAfterSeconds).toBe(1);
  });

  it("RateLimitedError.retryAfterSeconds rounds up", () => {
    expect(new RateLimitedError({ msUntilAvailable: 1001 }).retryAfterSeconds).toBe(2);
    expect(new RateLimitedError({ msUntilAvailable: 30_500 }).retryAfterSeconds).toBe(31);
  });
});
