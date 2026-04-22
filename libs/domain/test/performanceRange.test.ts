// KZO-159 (158A): Parser, bounds resolver, and shared-schema tests for the
// dashboard-performance-range grammar.
//
// Coverage contract (scope-todo + qa-test-plan):
//   - 100% branch coverage of `parsePerformanceRange` (valid forms, bounds
//     violations, non-string input, case-sensitivity, negative guards).
//   - 100% branch coverage of `resolveRangeBounds` (each `kind` + `ALL`
//     with/without `earliestTradeDate` + invalid-input throw path).
//   - `isValidPerformanceRange` boolean wrapper coverage.
//   - `dashboardPerformanceRangesSchema` — one case per rejection message
//     (`ranges_list_too_short`, `ranges_list_too_long`,
//     `ranges_list_invalid_element`, `ranges_list_duplicate`) plus the
//     happy-path acceptance case.
//
// Pure unit tests. No I/O, no fixtures, no network.

import { describe, expect, it } from "vitest";
import {
  PERFORMANCE_RANGE_MAX_MONTHS,
  PERFORMANCE_RANGE_MAX_YEARS,
  PERFORMANCE_RANGE_REGEX,
  isValidPerformanceRange,
  parsePerformanceRange,
  resolveRangeBounds,
} from "../src/performanceRange.js";
import {
  DEFAULT_DASHBOARD_PERFORMANCE_RANGES,
  dashboardPerformanceRangesSchema,
} from "@tw-portfolio/shared-types";

describe("parsePerformanceRange — valid forms", () => {
  it("parses YTD", () => {
    expect(parsePerformanceRange("YTD")).toEqual({ kind: "ytd" });
  });

  it("parses ALL", () => {
    expect(parsePerformanceRange("ALL")).toEqual({ kind: "all" });
  });

  it("parses single-digit month range", () => {
    expect(parsePerformanceRange("1M")).toEqual({ kind: "month", n: 1 });
  });

  it("parses multi-digit month range", () => {
    expect(parsePerformanceRange("36M")).toEqual({ kind: "month", n: 36 });
  });

  it("parses month range at upper bound (240M)", () => {
    expect(parsePerformanceRange("240M")).toEqual({
      kind: "month",
      n: PERFORMANCE_RANGE_MAX_MONTHS,
    });
  });

  it("parses single-digit year range", () => {
    expect(parsePerformanceRange("1Y")).toEqual({ kind: "year", n: 1 });
  });

  it("parses multi-digit year range", () => {
    expect(parsePerformanceRange("10Y")).toEqual({ kind: "year", n: 10 });
  });

  it("parses year range at upper bound (50Y)", () => {
    expect(parsePerformanceRange("50Y")).toEqual({
      kind: "year",
      n: PERFORMANCE_RANGE_MAX_YEARS,
    });
  });
});

describe("parsePerformanceRange — invalid forms", () => {
  it("rejects month range above upper bound (241M)", () => {
    expect(parsePerformanceRange("241M")).toBeNull();
  });

  it("rejects year range above upper bound (51Y)", () => {
    expect(parsePerformanceRange("51Y")).toBeNull();
  });

  it("rejects zero month range (0M)", () => {
    expect(parsePerformanceRange("0M")).toBeNull();
  });

  it("rejects zero year range (0Y)", () => {
    expect(parsePerformanceRange("0Y")).toBeNull();
  });

  it("rejects negative month range (-1M)", () => {
    expect(parsePerformanceRange("-1M")).toBeNull();
  });

  it("rejects leading-zero month range (01M)", () => {
    expect(parsePerformanceRange("01M")).toBeNull();
  });

  it("rejects lowercase ytd", () => {
    expect(parsePerformanceRange("ytd")).toBeNull();
  });

  it("rejects lowercase all", () => {
    expect(parsePerformanceRange("all")).toBeNull();
  });

  it("rejects lowercase unit (5m)", () => {
    expect(parsePerformanceRange("5m")).toBeNull();
  });

  it("rejects lowercase unit (5y)", () => {
    expect(parsePerformanceRange("5y")).toBeNull();
  });

  it("rejects unknown unit (5D)", () => {
    expect(parsePerformanceRange("5D")).toBeNull();
  });

  it("rejects empty string", () => {
    expect(parsePerformanceRange("")).toBeNull();
  });

  it("rejects whitespace around otherwise-valid input", () => {
    expect(parsePerformanceRange(" 5M")).toBeNull();
    expect(parsePerformanceRange("5M ")).toBeNull();
    expect(parsePerformanceRange(" YTD")).toBeNull();
  });

  it("rejects bare number without unit", () => {
    expect(parsePerformanceRange("5")).toBeNull();
  });

  it("rejects decimal month range (1.5M)", () => {
    expect(parsePerformanceRange("1.5M")).toBeNull();
  });

  it("rejects non-string input (number)", () => {
    expect(parsePerformanceRange(5 as unknown as string)).toBeNull();
  });

  it("rejects non-string input (null)", () => {
    expect(parsePerformanceRange(null as unknown as string)).toBeNull();
  });

  it("rejects non-string input (undefined)", () => {
    expect(parsePerformanceRange(undefined as unknown as string)).toBeNull();
  });
});

describe("PERFORMANCE_RANGE_REGEX exported constant", () => {
  it("matches valid range strings", () => {
    expect(PERFORMANCE_RANGE_REGEX.test("YTD")).toBe(true);
    expect(PERFORMANCE_RANGE_REGEX.test("ALL")).toBe(true);
    expect(PERFORMANCE_RANGE_REGEX.test("5M")).toBe(true);
    expect(PERFORMANCE_RANGE_REGEX.test("10Y")).toBe(true);
  });

  it("exports bounds constants matching spec (240 months, 50 years)", () => {
    expect(PERFORMANCE_RANGE_MAX_MONTHS).toBe(240);
    expect(PERFORMANCE_RANGE_MAX_YEARS).toBe(50);
  });
});

describe("isValidPerformanceRange", () => {
  it("returns true for valid ranges", () => {
    expect(isValidPerformanceRange("YTD")).toBe(true);
    expect(isValidPerformanceRange("ALL")).toBe(true);
    expect(isValidPerformanceRange("3M")).toBe(true);
    expect(isValidPerformanceRange("1Y")).toBe(true);
  });

  it("returns false for invalid ranges", () => {
    expect(isValidPerformanceRange("")).toBe(false);
    expect(isValidPerformanceRange("ytd")).toBe(false);
    expect(isValidPerformanceRange("241M")).toBe(false);
    expect(isValidPerformanceRange("51Y")).toBe(false);
  });
});

describe("resolveRangeBounds — valid cases", () => {
  it("resolves YTD to January 1 of the asOf year", () => {
    expect(resolveRangeBounds("YTD", "2026-04-22")).toEqual({
      startDate: "2026-01-01",
      endDate: "2026-04-22",
    });
  });

  it("resolves ALL with earliestTradeDate", () => {
    expect(resolveRangeBounds("ALL", "2026-04-22", "2022-03-15")).toEqual({
      startDate: "2022-03-15",
      endDate: "2026-04-22",
    });
  });

  it("resolves ALL without earliestTradeDate (startDate == endDate)", () => {
    expect(resolveRangeBounds("ALL", "2026-04-22")).toEqual({
      startDate: "2026-04-22",
      endDate: "2026-04-22",
    });
  });

  it("resolves 1M to asOf minus 1 month (UTC)", () => {
    expect(resolveRangeBounds("1M", "2026-04-22")).toEqual({
      startDate: "2026-03-22",
      endDate: "2026-04-22",
    });
  });

  it("resolves 3M to asOf minus 3 months", () => {
    expect(resolveRangeBounds("3M", "2026-04-22")).toEqual({
      startDate: "2026-01-22",
      endDate: "2026-04-22",
    });
  });

  it("resolves 12M crossing a year boundary", () => {
    expect(resolveRangeBounds("12M", "2026-04-22")).toEqual({
      startDate: "2025-04-22",
      endDate: "2026-04-22",
    });
  });

  it("resolves 1Y to asOf minus 1 year", () => {
    expect(resolveRangeBounds("1Y", "2026-04-22")).toEqual({
      startDate: "2025-04-22",
      endDate: "2026-04-22",
    });
  });

  it("resolves 5Y to asOf minus 5 years", () => {
    expect(resolveRangeBounds("5Y", "2026-04-22")).toEqual({
      startDate: "2021-04-22",
      endDate: "2026-04-22",
    });
  });

  it("resolves range at upper month bound (240M)", () => {
    expect(resolveRangeBounds("240M", "2026-04-22")).toEqual({
      startDate: "2006-04-22",
      endDate: "2026-04-22",
    });
  });

  it("resolves range at upper year bound (50Y)", () => {
    expect(resolveRangeBounds("50Y", "2026-04-22")).toEqual({
      startDate: "1976-04-22",
      endDate: "2026-04-22",
    });
  });

  it("accepts asOf with full ISO timestamp and normalizes to date-only", () => {
    expect(resolveRangeBounds("1M", "2026-04-22T15:30:00.000Z")).toEqual({
      startDate: "2026-03-22",
      endDate: "2026-04-22",
    });
  });

  it("normalizes earliestTradeDate ISO timestamp to date-only", () => {
    expect(
      resolveRangeBounds("ALL", "2026-04-22", "2022-03-15T10:00:00.000Z"),
    ).toEqual({
      startDate: "2022-03-15",
      endDate: "2026-04-22",
    });
  });
});

describe("resolveRangeBounds — invalid cases throw", () => {
  it("throws for invalid range string", () => {
    expect(() => resolveRangeBounds("bogus", "2026-04-22")).toThrow(
      /invalid performance range: bogus/,
    );
  });

  it("throws for out-of-bound month range", () => {
    expect(() => resolveRangeBounds("241M", "2026-04-22")).toThrow(
      /invalid performance range: 241M/,
    );
  });

  it("throws for out-of-bound year range", () => {
    expect(() => resolveRangeBounds("51Y", "2026-04-22")).toThrow(
      /invalid performance range: 51Y/,
    );
  });

  it("throws for empty string", () => {
    expect(() => resolveRangeBounds("", "2026-04-22")).toThrow(
      /invalid performance range:/,
    );
  });
});

describe("dashboardPerformanceRangesSchema — happy path", () => {
  it("accepts the DEFAULT_DASHBOARD_PERFORMANCE_RANGES list", () => {
    const result = dashboardPerformanceRangesSchema.safeParse([
      ...DEFAULT_DASHBOARD_PERFORMANCE_RANGES,
    ]);
    expect(result.success).toBe(true);
  });

  it("accepts a custom list of 4 valid ranges", () => {
    const result = dashboardPerformanceRangesSchema.safeParse([
      "1M",
      "6M",
      "YTD",
      "ALL",
    ]);
    expect(result.success).toBe(true);
  });

  it("accepts a list of 12 valid ranges (max size)", () => {
    const result = dashboardPerformanceRangesSchema.safeParse([
      "1M",
      "2M",
      "3M",
      "6M",
      "YTD",
      "1Y",
      "2Y",
      "3Y",
      "5Y",
      "10Y",
      "20Y",
      "ALL",
    ]);
    expect(result.success).toBe(true);
  });

  it("accepts a list of exactly 1 range (min size)", () => {
    const result = dashboardPerformanceRangesSchema.safeParse(["YTD"]);
    expect(result.success).toBe(true);
  });
});

describe("dashboardPerformanceRangesSchema — rejections", () => {
  it("rejects empty list with message ranges_list_too_short", () => {
    const result = dashboardPerformanceRangesSchema.safeParse([]);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.message);
      expect(messages).toContain("ranges_list_too_short");
    }
  });

  it("rejects list >12 with message ranges_list_too_long", () => {
    const thirteen = [
      "1M",
      "2M",
      "3M",
      "4M",
      "5M",
      "6M",
      "7M",
      "8M",
      "9M",
      "10M",
      "11M",
      "12M",
      "13M",
    ];
    const result = dashboardPerformanceRangesSchema.safeParse(thirteen);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.message);
      expect(messages).toContain("ranges_list_too_long");
    }
  });

  it("rejects list with an invalid element (lowercase) with message ranges_list_invalid_element", () => {
    const result = dashboardPerformanceRangesSchema.safeParse([
      "1M",
      "ytd",
      "1Y",
    ]);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.message);
      expect(messages).toContain("ranges_list_invalid_element");
    }
  });

  it("rejects list with an invalid element (out-of-bound year) with message ranges_list_invalid_element", () => {
    const result = dashboardPerformanceRangesSchema.safeParse([
      "1M",
      "51Y",
      "YTD",
    ]);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.message);
      expect(messages).toContain("ranges_list_invalid_element");
    }
  });

  it("rejects list with an invalid element (out-of-bound month) with message ranges_list_invalid_element", () => {
    const result = dashboardPerformanceRangesSchema.safeParse([
      "241M",
      "YTD",
    ]);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.message);
      expect(messages).toContain("ranges_list_invalid_element");
    }
  });

  it("rejects duplicate entries with message ranges_list_duplicate", () => {
    const result = dashboardPerformanceRangesSchema.safeParse([
      "1M",
      "YTD",
      "1M",
    ]);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.message);
      expect(messages).toContain("ranges_list_duplicate");
    }
  });

  it("rejects non-array input", () => {
    const result = dashboardPerformanceRangesSchema.safeParse(
      "1M" as unknown as string[],
    );
    expect(result.success).toBe(false);
  });

  it("rejects non-string array elements", () => {
    const result = dashboardPerformanceRangesSchema.safeParse([
      1 as unknown as string,
      "YTD",
    ]);
    expect(result.success).toBe(false);
  });
});
