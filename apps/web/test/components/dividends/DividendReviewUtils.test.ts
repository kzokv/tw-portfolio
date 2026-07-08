import { describe, expect, it } from "vitest";
import {
  bucketByGranularity,
  bucketedToChartData,
  computeCumulative,
  extractCurrencies,
  formatYAxis,
  resolvePresetDates,
} from "../../../components/dividends/dividendReviewUtils";

// ── resolvePresetDates ─────────────────────────────────────────────────────

describe("resolvePresetDates", () => {
  // Wednesday, 2026-04-15
  const today = new Date(Date.UTC(2026, 3, 15));

  it("yesterday returns single day", () => {
    expect(resolvePresetDates("yesterday", today)).toEqual({
      from: "2026-04-14",
      to: "2026-04-14",
    });
  });

  it("thisWeek returns Monday to today", () => {
    const result = resolvePresetDates("thisWeek", today);
    expect(result).toEqual({ from: "2026-04-13", to: "2026-04-15" });
  });

  it("thisWeek on Monday returns Monday to Monday", () => {
    const monday = new Date(Date.UTC(2026, 3, 13));
    expect(resolvePresetDates("thisWeek", monday)).toEqual({
      from: "2026-04-13",
      to: "2026-04-13",
    });
  });

  it("thisWeek on Sunday returns previous Monday to Sunday", () => {
    const sunday = new Date(Date.UTC(2026, 3, 19));
    expect(resolvePresetDates("thisWeek", sunday)).toEqual({
      from: "2026-04-13",
      to: "2026-04-19",
    });
  });

  it("last7Days returns 7-day range", () => {
    expect(resolvePresetDates("last7Days", today)).toEqual({
      from: "2026-04-09",
      to: "2026-04-15",
    });
  });

  it("last30Days returns 30-day range", () => {
    expect(resolvePresetDates("last30Days", today)).toEqual({
      from: "2026-03-17",
      to: "2026-04-15",
    });
  });

  it("thisMonth returns first to last day of current month", () => {
    expect(resolvePresetDates("thisMonth", today)).toEqual({
      from: "2026-04-01",
      to: "2026-04-30",
    });
  });

  it("lastMonth returns first to last day of previous month", () => {
    expect(resolvePresetDates("lastMonth", today)).toEqual({
      from: "2026-03-01",
      to: "2026-03-31",
    });
  });

  it("lastMonth in January wraps to December", () => {
    const jan = new Date(Date.UTC(2026, 0, 10));
    expect(resolvePresetDates("lastMonth", jan)).toEqual({
      from: "2025-12-01",
      to: "2025-12-31",
    });
  });

  it("currentQuarter returns quarter start to today", () => {
    // April is Q2
    expect(resolvePresetDates("currentQuarter", today)).toEqual({
      from: "2026-04-01",
      to: "2026-04-15",
    });
  });

  it("currentQuarter in January returns Q1 start to today", () => {
    const jan = new Date(Date.UTC(2026, 0, 20));
    expect(resolvePresetDates("currentQuarter", jan)).toEqual({
      from: "2026-01-01",
      to: "2026-01-20",
    });
  });

  it("lastQuarter returns previous full quarter", () => {
    // April = Q2 → last quarter is Q1
    expect(resolvePresetDates("lastQuarter", today)).toEqual({
      from: "2026-01-01",
      to: "2026-03-31",
    });
  });

  it("lastQuarter in Q1 wraps to Q4 of previous year", () => {
    const feb = new Date(Date.UTC(2026, 1, 10));
    expect(resolvePresetDates("lastQuarter", feb)).toEqual({
      from: "2025-10-01",
      to: "2025-12-31",
    });
  });

  it("currentYear returns full current year", () => {
    expect(resolvePresetDates("currentYear", today)).toEqual({
      from: "2026-01-01",
      to: "2026-12-31",
    });
  });

  it("lastYear returns full previous year", () => {
    expect(resolvePresetDates("lastYear", today)).toEqual({
      from: "2025-01-01",
      to: "2025-12-31",
    });
  });

  it("unspecified returns null dates", () => {
    expect(resolvePresetDates("unspecified", today)).toEqual({
      from: null,
      to: null,
    });
  });

  it("custom returns null dates", () => {
    expect(resolvePresetDates("custom", today)).toEqual({
      from: null,
      to: null,
    });
  });

  it("yearRange defers to explicit date filters", () => {
    expect(resolvePresetDates("yearRange", today)).toEqual({
      from: null,
      to: null,
    });
  });
});

// ── formatYAxis ────────────────────────────────────────────────────────────

describe("formatYAxis", () => {
  it("formats millions", () => {
    expect(formatYAxis(1_500_000)).toBe("1.5M");
  });

  it("formats exact million", () => {
    expect(formatYAxis(1_000_000)).toBe("1.0M");
  });

  it("formats thousands", () => {
    expect(formatYAxis(50_000)).toBe("50k");
  });

  it("formats exact thousand", () => {
    expect(formatYAxis(1_000)).toBe("1k");
  });

  it("passes through small numbers", () => {
    expect(formatYAxis(500)).toBe("500");
  });

  it("handles zero", () => {
    expect(formatYAxis(0)).toBe("0");
  });

  it("handles negative millions", () => {
    expect(formatYAxis(-2_000_000)).toBe("-2.0M");
  });

  it("handles negative thousands", () => {
    expect(formatYAxis(-5_000)).toBe("-5k");
  });
});

// ── bucketByGranularity ────────────────────────────────────────────────────

describe("bucketByGranularity", () => {
  const byMonth: Record<string, Record<string, { expected: number; received: number }>> = {
    "2026-01": { TWD: { expected: 100, received: 80 } },
    "2026-02": { TWD: { expected: 200, received: 150 } },
    "2026-03": { TWD: { expected: 300, received: 250 } },
    "2026-04": { TWD: { expected: 400, received: 350 } },
    "2026-07": { TWD: { expected: 500, received: 450 } },
  };

  it("month granularity is passthrough", () => {
    expect(bucketByGranularity(byMonth, "month")).toBe(byMonth);
  });

  it("quarter granularity groups by Q", () => {
    const result = bucketByGranularity(byMonth, "quarter");
    expect(result["2026-Q1"]).toEqual({ TWD: { expected: 600, received: 480 } });
    expect(result["2026-Q2"]).toEqual({ TWD: { expected: 400, received: 350 } });
    expect(result["2026-Q3"]).toEqual({ TWD: { expected: 500, received: 450 } });
  });

  it("year granularity groups all months", () => {
    const result = bucketByGranularity(byMonth, "year");
    expect(result["2026"]).toEqual({ TWD: { expected: 1500, received: 1280 } });
  });

  it("handles multiple currencies", () => {
    const multiCurrency = {
      "2026-01": { TWD: { expected: 100, received: 80 }, USD: { expected: 10, received: 8 } },
      "2026-02": { TWD: { expected: 200, received: 150 }, USD: { expected: 20, received: 15 } },
    };
    const result = bucketByGranularity(multiCurrency, "quarter");
    expect(result["2026-Q1"]).toEqual({
      TWD: { expected: 300, received: 230 },
      USD: { expected: 30, received: 23 },
    });
  });

  it("handles empty input", () => {
    expect(bucketByGranularity({}, "quarter")).toEqual({});
  });
});

// ── computeCumulative ──────────────────────────────────────────────────────

describe("computeCumulative", () => {
  it("produces running totals sorted chronologically", () => {
    const bucketed = {
      "2026-03": { TWD: { expected: 300, received: 250 } },
      "2026-01": { TWD: { expected: 100, received: 80 } },
      "2026-02": { TWD: { expected: 200, received: 150 } },
    };
    const result = computeCumulative(bucketed, "TWD");
    expect(result).toEqual([
      { label: "2026-01", expected: 100, received: 80 },
      { label: "2026-02", expected: 300, received: 230 },
      { label: "2026-03", expected: 600, received: 480 },
    ]);
  });

  it("returns zeros for missing currency", () => {
    const bucketed = {
      "2026-01": { TWD: { expected: 100, received: 80 } },
    };
    const result = computeCumulative(bucketed, "USD");
    expect(result).toEqual([{ label: "2026-01", expected: 0, received: 0 }]);
  });

  it("returns empty for empty input", () => {
    expect(computeCumulative({}, "TWD")).toEqual([]);
  });
});

// ── extractCurrencies ──────────────────────────────────────────────────────

describe("extractCurrencies", () => {
  it("extracts and sorts unique currencies", () => {
    const byMonth = {
      "2026-01": { TWD: { expected: 100, received: 80 }, USD: { expected: 10, received: 8 } },
      "2026-02": { TWD: { expected: 200, received: 150 } },
    };
    expect(extractCurrencies(byMonth)).toEqual(["TWD", "USD"]);
  });

  it("returns empty for empty input", () => {
    expect(extractCurrencies({})).toEqual([]);
  });
});

// ── bucketedToChartData ────────────────────────────────────────────────────

describe("bucketedToChartData", () => {
  it("converts bucketed data to chart points sorted by key", () => {
    const bucketed = {
      "2026-02": { TWD: { expected: 200, received: 150 } },
      "2026-01": { TWD: { expected: 100, received: 80 } },
    };
    expect(bucketedToChartData(bucketed, "TWD")).toEqual([
      { label: "2026-01", expected: 100, received: 80 },
      { label: "2026-02", expected: 200, received: 150 },
    ]);
  });

  it("returns zeros for missing currency", () => {
    const bucketed = {
      "2026-01": { TWD: { expected: 100, received: 80 } },
    };
    expect(bucketedToChartData(bucketed, "USD")).toEqual([
      { label: "2026-01", expected: 0, received: 0 },
    ]);
  });
});
