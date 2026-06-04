import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { RateLimiter } from "../../src/services/market-data/rateLimiter.js";

describe("RateLimiter", () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = new RateLimiter(5, 1000); // 5 requests per 1 second for fast tests
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("canConsume", () => {
    it("allows requests within budget", () => {
      expect(limiter.canConsume(1)).toBe(true);
      expect(limiter.canConsume(5)).toBe(true);
    });

    it("rejects requests exceeding budget", () => {
      expect(limiter.canConsume(6)).toBe(false);
    });

    it("rejects when budget is partially consumed", () => {
      limiter.consume(3);
      expect(limiter.canConsume(3)).toBe(false);
      expect(limiter.canConsume(2)).toBe(true);
    });
  });

  describe("consume", () => {
    it("decrements available budget", () => {
      limiter.consume(3);
      expect(limiter.consumed).toBe(3);
      expect(limiter.canConsume(3)).toBe(false);
      expect(limiter.canConsume(2)).toBe(true);
    });

    it("tracks multiple consumptions", () => {
      limiter.consume(2);
      limiter.consume(2);
      expect(limiter.consumed).toBe(4);
      expect(limiter.canConsume(2)).toBe(false);
    });
  });

  describe("msUntilAvailable", () => {
    it("returns 0 when budget is available", () => {
      expect(limiter.msUntilAvailable(1)).toBe(0);
    });

    it("returns positive value when budget is exhausted", () => {
      limiter.consume(5);
      const ms = limiter.msUntilAvailable(1);
      expect(ms).toBeGreaterThan(0);
      expect(ms).toBeLessThanOrEqual(1000);
    });

    it("returns 0 after window expires", () => {
      limiter.consume(5);
      // Advance time past the window
      vi.spyOn(Date, "now").mockReturnValue(Date.now() + 1100);
      expect(limiter.msUntilAvailable(1)).toBe(0);
    });
  });

  describe("sliding window", () => {
    it("evicts expired requests from the window", () => {
      const start = Date.now();
      vi.spyOn(Date, "now").mockReturnValue(start);

      limiter.consume(5);
      expect(limiter.canConsume(1)).toBe(false);

      // Advance past window
      vi.spyOn(Date, "now").mockReturnValue(start + 1100);
      expect(limiter.canConsume(5)).toBe(true);
      expect(limiter.consumed).toBe(0);
    });
  });

  describe("_reset", () => {
    it("clears all state", () => {
      limiter.consume(5);
      expect(limiter.consumed).toBe(5);
      limiter._reset();
      expect(limiter.consumed).toBe(0);
      expect(limiter.canConsume(5)).toBe(true);
    });
  });

  describe("default budget", () => {
    it("defaults to 600 requests/hour", () => {
      const defaultLimiter = new RateLimiter();
      expect(defaultLimiter.canConsume(600)).toBe(true);
      expect(defaultLimiter.canConsume(601)).toBe(false);
    });
  });

  describe("dynamic budget", () => {
    it("uses the latest budget callback value for subsequent checks", () => {
      let budget = 3;
      const dynamicLimiter = new RateLimiter(() => budget, 1000);

      dynamicLimiter.consume(2);
      expect(dynamicLimiter.canConsume(1)).toBe(true);

      budget = 2;
      expect(dynamicLimiter.canConsume(1)).toBe(false);

      budget = 4;
      expect(dynamicLimiter.canConsume(2)).toBe(true);
    });
  });
});
