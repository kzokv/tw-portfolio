import { describe, expect, it } from "vitest";
import { sweepSlidingWindowBucket } from "../../src/routes/registerRoutes.js";

describe("sweepSlidingWindowBucket", () => {
  const t0 = 1_700_000_000_000;
  const windowMs = 5_000;

  it("evicts an entry whose timestamps are all stale", () => {
    // Arrange
    const bucket = new Map<string, number[]>([
      ["198.51.100.1", [t0 - 10_000, t0 - 9_000, t0 - 8_000]],
    ]);

    // Act
    sweepSlidingWindowBucket(bucket, windowMs, t0);

    // Assert
    expect(bucket.has("198.51.100.1")).toBe(false);
    expect(bucket.size).toBe(0);
  });

  it("retains an entry with mixed stale + recent timestamps (partial staleness does not evict)", () => {
    // Arrange — one stale, one fresh; the internal timestamp array is the rate-limiter's
    // concern, not the sweep's. The sweep only evicts when EVERY timestamp is stale.
    const bucket = new Map<string, number[]>([
      ["198.51.100.2", [t0 - 10_000, t0 - 2_000]],
    ]);

    // Act
    sweepSlidingWindowBucket(bucket, windowMs, t0);

    // Assert
    expect(bucket.has("198.51.100.2")).toBe(true);
    expect(bucket.size).toBe(1);
  });

  it("retains an entry whose timestamps are all fresh", () => {
    // Arrange
    const bucket = new Map<string, number[]>([
      ["198.51.100.3", [t0 - 1_000, t0 - 500, t0]],
    ]);

    // Act
    sweepSlidingWindowBucket(bucket, windowMs, t0);

    // Assert
    expect(bucket.has("198.51.100.3")).toBe(true);
    expect(bucket.size).toBe(1);
  });

  it("only evicts the stale IP's entry when multiple IPs are present", () => {
    // Arrange
    const bucket = new Map<string, number[]>([
      ["stale", [t0 - 10_000]],
      ["fresh", [t0 - 500]],
    ]);

    // Act
    sweepSlidingWindowBucket(bucket, windowMs, t0);

    // Assert
    expect(bucket.has("stale")).toBe(false);
    expect(bucket.has("fresh")).toBe(true);
    expect(bucket.size).toBe(1);
  });

  it("is a no-op on an empty map (no throw, map still empty)", () => {
    // Arrange
    const bucket = new Map<string, number[]>();

    // Act + Assert
    expect(() => sweepSlidingWindowBucket(bucket, windowMs, t0)).not.toThrow();
    expect(bucket.size).toBe(0);
  });
});
