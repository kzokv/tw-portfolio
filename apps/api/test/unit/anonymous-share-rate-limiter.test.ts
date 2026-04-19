import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetAnonymousShareRateBuckets,
  assertAnonymousShareRateLimit,
} from "../../src/routes/registerRoutes.js";
import { routeError } from "../../src/lib/routeError.js";

describe("assertAnonymousShareRateLimit", () => {
  beforeEach(() => {
    _resetAnonymousShareRateBuckets();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    _resetAnonymousShareRateBuckets();
  });

  it("allows up to 30 requests from the same IP within the window", () => {
    // Arrange
    const ip = "198.51.100.1";

    // Act + Assert
    for (let i = 0; i < 30; i += 1) {
      expect(() => assertAnonymousShareRateLimit(ip)).not.toThrow();
    }
  });

  it("rejects the 31st request with a 429 rate_limit_exceeded error", () => {
    // Arrange
    const ip = "198.51.100.2";
    for (let i = 0; i < 30; i += 1) {
      assertAnonymousShareRateLimit(ip);
    }

    // Act
    let thrown: unknown = null;
    try {
      assertAnonymousShareRateLimit(ip);
    } catch (err) {
      thrown = err;
    }

    // Assert
    expect(thrown).toBeTruthy();
    const err = thrown as Error & { statusCode?: number; code?: string };
    expect(err.statusCode).toBe(429);
    expect(err.code).toBe("rate_limit_exceeded");
  });

  it("counts every invocation — invalid tokens are indistinguishable from valid at this layer", () => {
    // Arrange — this is a policy statement, not just behaviour: the rate limiter
    // must be called before any DB lookup so bad and good tokens share the budget.
    const ip = "198.51.100.3";
    for (let i = 0; i < 30; i += 1) {
      assertAnonymousShareRateLimit(ip);
    }

    // Act + Assert — the 31st hit from the same IP is blocked regardless of content.
    expect(() => assertAnonymousShareRateLimit(ip)).toThrowError();
  });

  it("maintains independent buckets per IP", () => {
    // Arrange
    for (let i = 0; i < 30; i += 1) {
      assertAnonymousShareRateLimit("10.0.0.1");
    }

    // Act + Assert — other IP still has a fresh budget
    expect(() => assertAnonymousShareRateLimit("10.0.0.2")).not.toThrow();
  });

  it("releases budget after the 5-minute window slides past", () => {
    // Arrange
    const ip = "203.0.113.5";
    const t0 = 1_700_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(t0);
    for (let i = 0; i < 30; i += 1) {
      assertAnonymousShareRateLimit(ip);
    }
    expect(() => assertAnonymousShareRateLimit(ip)).toThrowError();

    // Act — advance clock past the 5-minute window
    vi.spyOn(Date, "now").mockReturnValue(t0 + 300_001);

    // Assert
    expect(() => assertAnonymousShareRateLimit(ip)).not.toThrow();
  });

  it("_resetAnonymousShareRateBuckets clears all state", () => {
    // Arrange
    const ip = "198.51.100.10";
    for (let i = 0; i < 30; i += 1) {
      assertAnonymousShareRateLimit(ip);
    }
    expect(() => assertAnonymousShareRateLimit(ip)).toThrowError();

    // Act
    _resetAnonymousShareRateBuckets();

    // Assert
    expect(() => assertAnonymousShareRateLimit(ip)).not.toThrow();
  });

  it("routeError carries the 429 status and rate_limit_exceeded code as contract", () => {
    // Arrange — guard check: if this changes, the route handler must also update its Retry-After header.
    const err = routeError(429, "rate_limit_exceeded", "rate limit exceeded") as Error & {
      statusCode?: number;
      code?: string;
    };
    expect(err.statusCode).toBe(429);
    expect(err.code).toBe("rate_limit_exceeded");
  });
});
