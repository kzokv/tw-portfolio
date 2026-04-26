/**
 * Unit tests for MockFrankfurterFxRateProvider.
 *
 * Verifies:
 *  - `calls` array records fetchRatesForBase + args and reserveCapacity + n
 *  - Returned rates are deterministic (USD/TWD=31.5, USD/AUD=1.4, derived inverses per spec)
 *  - All entries stamp source: 'frankfurter'
 *  - Date-range expansion is correct (inclusive of both endpoints)
 *  - FxRate shape is structurally complete
 */
import { describe, expect, it, beforeEach } from "vitest";
import { MockFrankfurterFxRateProvider } from "../../src/services/market-data/providers/mockFrankfurter.js";

describe("MockFrankfurterFxRateProvider — calls recording", () => {
  let mock: MockFrankfurterFxRateProvider;

  beforeEach(() => {
    mock = new MockFrankfurterFxRateProvider();
  });

  it("starts with an empty calls array", () => {
    expect(mock.calls).toHaveLength(0);
  });

  it("records fetchRatesForBase call with correct args", async () => {
    await mock.fetchRatesForBase("USD", "2026-04-01", "2026-04-03");

    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0]).toMatchObject({
      method: "fetchRatesForBase",
    });
    // Verify args are captured (base, fromDate, toDate)
    const call = mock.calls[0]!;
    expect(JSON.stringify(call)).toContain("USD");
  });

  it("records fetchRatesForBase call with optional quotes filter", async () => {
    await mock.fetchRatesForBase("USD", "2026-04-01", "2026-04-01", ["TWD"]);

    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0]).toMatchObject({ method: "fetchRatesForBase" });
  });

  it("records reserveCapacity call with n", () => {
    mock.reserveCapacity(3);

    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0]).toMatchObject({ method: "reserveCapacity", n: 3 });
  });

  it("accumulates multiple calls in order", async () => {
    mock.reserveCapacity(2);
    await mock.fetchRatesForBase("USD", "2026-04-01", "2026-04-01");
    await mock.fetchRatesForBase("TWD", "2026-04-01", "2026-04-01");

    expect(mock.calls).toHaveLength(3);
    expect(mock.calls[0]).toMatchObject({ method: "reserveCapacity" });
    expect(mock.calls[1]).toMatchObject({ method: "fetchRatesForBase" });
    expect(mock.calls[2]).toMatchObject({ method: "fetchRatesForBase" });
  });
});

describe("MockFrankfurterFxRateProvider — deterministic rates", () => {
  let mock: MockFrankfurterFxRateProvider;

  beforeEach(() => {
    mock = new MockFrankfurterFxRateProvider();
  });

  it("returns source: 'frankfurter' on every entry", async () => {
    const results = await mock.fetchRatesForBase("USD", "2026-04-01", "2026-04-03");

    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.source).toBe("frankfurter");
    }
  });

  it("returns structurally complete FxRate objects", async () => {
    const results = await mock.fetchRatesForBase("USD", "2026-04-01", "2026-04-01");

    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(typeof r.date).toBe("string");
      expect(typeof r.baseCurrency).toBe("string");
      expect(typeof r.quoteCurrency).toBe("string");
      expect(typeof r.rate).toBe("number");
      expect(r.rate).toBeGreaterThan(0);
      expect(r.source).toBe("frankfurter");
    }
  });

  it("USD base: includes USD/TWD rate of 31.5", async () => {
    const results = await mock.fetchRatesForBase("USD", "2026-04-01", "2026-04-01");

    const twdRate = results.find((r) => r.baseCurrency === "USD" && r.quoteCurrency === "TWD");
    expect(twdRate).toBeDefined();
    expect(twdRate!.rate).toBe(31.5);
  });

  it("USD base: includes USD/AUD rate of 1.4", async () => {
    const results = await mock.fetchRatesForBase("USD", "2026-04-01", "2026-04-01");

    const audRate = results.find((r) => r.baseCurrency === "USD" && r.quoteCurrency === "AUD");
    expect(audRate).toBeDefined();
    expect(audRate!.rate).toBe(1.4);
  });

  it("every entry has baseCurrency matching the requested base", async () => {
    const results = await mock.fetchRatesForBase("TWD", "2026-04-01", "2026-04-01");

    for (const r of results) {
      expect(r.baseCurrency).toBe("TWD");
    }
  });
});

describe("MockFrankfurterFxRateProvider — date-range expansion", () => {
  let mock: MockFrankfurterFxRateProvider;

  beforeEach(() => {
    mock = new MockFrankfurterFxRateProvider();
  });

  it("returns entries for every date in the inclusive range", async () => {
    const results = await mock.fetchRatesForBase("USD", "2026-04-01", "2026-04-03");

    const dates = new Set(results.map((r) => r.date));
    expect(dates.has("2026-04-01")).toBe(true);
    expect(dates.has("2026-04-02")).toBe(true);
    expect(dates.has("2026-04-03")).toBe(true);
  });

  it("includes both start and end dates (inclusive)", async () => {
    const results = await mock.fetchRatesForBase("USD", "2026-04-24", "2026-04-25");

    const dates = new Set(results.map((r) => r.date));
    expect(dates.has("2026-04-24")).toBe(true);
    expect(dates.has("2026-04-25")).toBe(true);
  });

  it("returns a single date's worth of entries when startDate === endDate", async () => {
    const results = await mock.fetchRatesForBase("USD", "2026-04-01", "2026-04-01");

    const dates = new Set(results.map((r) => r.date));
    expect(dates.size).toBe(1);
    expect(dates.has("2026-04-01")).toBe(true);
  });

  it("returns entries for a 30-day range (matching the seed window)", async () => {
    const results = await mock.fetchRatesForBase("USD", "2026-03-27", "2026-04-25");

    const dates = new Set(results.map((r) => r.date));
    // 30-day range: 2026-03-27 to 2026-04-25 = 30 days
    expect(dates.size).toBe(30);
  });
});

describe("MockFrankfurterFxRateProvider — quotes filter", () => {
  let mock: MockFrankfurterFxRateProvider;

  beforeEach(() => {
    mock = new MockFrankfurterFxRateProvider();
  });

  it("filters to requested quotes when quotes array is provided", async () => {
    const results = await mock.fetchRatesForBase("USD", "2026-04-01", "2026-04-01", ["TWD"]);

    expect(results.every((r) => r.quoteCurrency === "TWD")).toBe(true);
  });

  it("returns all quotes when no filter provided", async () => {
    const results = await mock.fetchRatesForBase("USD", "2026-04-01", "2026-04-01");

    const quotes = new Set(results.map((r) => r.quoteCurrency));
    expect(quotes.size).toBeGreaterThan(1);
  });

  it("returns all quotes when empty quotes array is provided (parity with real provider)", async () => {
    const results = await mock.fetchRatesForBase("USD", "2026-04-01", "2026-04-01", []);

    const quotes = new Set(results.map((r) => r.quoteCurrency));
    expect(quotes.size).toBeGreaterThan(1);
  });
});
