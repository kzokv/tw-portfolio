import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetMarketDataPriceBuckets,
  assertMarketDataPriceRateLimit,
} from "../../src/lib/marketDataPriceRateLimit.js";

describe("assertMarketDataPriceRateLimit", () => {
  beforeEach(() => {
    _resetMarketDataPriceBuckets();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    _resetMarketDataPriceBuckets();
  });

  it("allows up to 30 requests from the same IP within one minute", () => {
    const ip = "198.51.100.30";

    for (let i = 0; i < 30; i += 1) {
      expect(() => assertMarketDataPriceRateLimit(ip)).not.toThrow();
    }
  });

  it("rejects the 31st request with a 429", () => {
    const ip = "198.51.100.31";
    for (let i = 0; i < 30; i += 1) {
      assertMarketDataPriceRateLimit(ip);
    }

    let thrown: unknown = null;
    try {
      assertMarketDataPriceRateLimit(ip);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeTruthy();
    const err = thrown as Error & { statusCode?: number; code?: string };
    expect(err.statusCode).toBe(429);
    expect(err.code).toBe("rate_limit_exceeded");
  });

  it("maintains separate budgets per IP", () => {
    for (let i = 0; i < 30; i += 1) {
      assertMarketDataPriceRateLimit("203.0.113.10");
    }

    expect(() => assertMarketDataPriceRateLimit("203.0.113.11")).not.toThrow();
  });

  it("releases budget after the window slides past", () => {
    const ip = "203.0.113.12";
    const t0 = 1_700_000_000_000;

    vi.spyOn(Date, "now").mockReturnValue(t0);
    for (let i = 0; i < 30; i += 1) {
      assertMarketDataPriceRateLimit(ip);
    }
    expect(() => assertMarketDataPriceRateLimit(ip)).toThrowError();

    vi.spyOn(Date, "now").mockReturnValue(t0 + 60_001);
    expect(() => assertMarketDataPriceRateLimit(ip)).not.toThrow();
  });
});
