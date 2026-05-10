import { describe, expect, it } from "vitest";
import { formatCooldownLabel } from "../../lib/formatCooldownLabel";

describe("formatCooldownLabel", () => {
  it("returns '0s' for zero", () => {
    expect(formatCooldownLabel(0)).toBe("0s");
  });

  it("returns '0s' for negative values", () => {
    expect(formatCooldownLabel(-1)).toBe("0s");
    expect(formatCooldownLabel(-10_000)).toBe("0s");
  });

  it("renders seconds (rounded) for ms ≤ 120_000", () => {
    expect(formatCooldownLabel(1_000)).toBe("1s");
    expect(formatCooldownLabel(60_000)).toBe("60s");
    expect(formatCooldownLabel(120_000)).toBe("120s");
  });

  it("rounds sub-second/sub-half values to nearest second", () => {
    expect(formatCooldownLabel(499)).toBe("0s");
    expect(formatCooldownLabel(500)).toBe("1s");
    expect(formatCooldownLabel(1_499)).toBe("1s");
    expect(formatCooldownLabel(1_500)).toBe("2s");
  });

  it("switches to minutes (rounded) for ms > 120_000", () => {
    expect(formatCooldownLabel(120_001)).toBe("2 min");
    expect(formatCooldownLabel(1_800_000)).toBe("30 min");
    expect(formatCooldownLabel(3_600_000)).toBe("60 min");
  });

  it("rounds minute boundaries to nearest minute", () => {
    // 2.5 min → 3 min
    expect(formatCooldownLabel(150_000)).toBe("3 min");
    // 2.49 min → 2 min
    expect(formatCooldownLabel(149_000)).toBe("2 min");
  });

  it("handles very large values without overflow", () => {
    expect(formatCooldownLabel(24 * 60 * 60 * 1000)).toBe("1440 min");
  });
});
