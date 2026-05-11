import { beforeEach, describe, expect, it } from "vitest";
import { MemoryPersistence } from "../../src/persistence/memory.js";
import { resolveQuoteSnapshots } from "../../src/services/market-data/quoteSnapshotService.js";

// Fixtures — realistic TWSE bars matching the KZO-87 design doc
const FIXTURE_BARS_2330 = [
  { ticker: "2330", barDate: "2026-03-28", open: 595, high: 600, low: 590, close: 598, volume: 25000000, source: "test", ingestedAt: "2026-03-28T18:00:00Z" },
  { ticker: "2330", barDate: "2026-03-27", open: 590, high: 596, low: 588, close: 595, volume: 22000000, source: "test", ingestedAt: "2026-03-27T18:00:00Z" },
  { ticker: "2330", barDate: "2026-03-26", open: 585, high: 592, low: 583, close: 590, volume: 20000000, source: "test", ingestedAt: "2026-03-26T18:00:00Z" },
];

// Single-bar ticker — derived fields must all be null
const FIXTURE_BARS_2317 = [
  { ticker: "2317", barDate: "2026-03-28", open: 108, high: 110, low: 107, close: 109, volume: 15000000, source: "test", ingestedAt: "2026-03-28T18:00:00Z" },
];

// Division guard — previousClose=0 must produce null change/changePercent, not Infinity/NaN
const FIXTURE_BARS_ZEROPREV = [
  { ticker: "ZEROPREV", barDate: "2026-03-28", open: 0, high: 0, low: 0, close: 5, volume: 100, source: "test", ingestedAt: "2026-03-28T18:00:00Z" },
  { ticker: "ZEROPREV", barDate: "2026-03-27", open: 0, high: 0, low: 0, close: 0, volume: 100, source: "test", ingestedAt: "2026-03-27T18:00:00Z" },
];

// KZO-191: US/AU fixtures for multi-market provisional coverage
const FIXTURE_BARS_AAPL = [
  { ticker: "AAPL", barDate: "2026-03-27", open: 170, high: 173, low: 169, close: 172, volume: 50000000, source: "test", ingestedAt: "2026-03-27T22:00:00Z" },
];

const FIXTURE_BARS_BHP = [
  { ticker: "BHP", barDate: "2026-03-25", open: 44, high: 45, low: 43.5, close: 44.5, volume: 8000000, source: "test", ingestedAt: "2026-03-25T07:00:00Z" },
];

const EMPTY_SETTLED = new Map<string, string>();

describe("resolveQuoteSnapshots", () => {
  let persistence: MemoryPersistence;

  beforeEach(async () => {
    persistence = new MemoryPersistence();
    await persistence.init();
  });

  it("TC-U1: 2+ bars → all derived fields populated for both tickers", async () => {
    persistence._seedDailyBars([...FIXTURE_BARS_2330, ...FIXTURE_BARS_2317]);

    const result = await resolveQuoteSnapshots(
      [{ ticker: "2330", marketCode: "TW" }, { ticker: "2317", marketCode: "TW" }],
      persistence,
      new Map([["TW", "2026-03-28"]]),
    );

    // 2330: 3 days → latest=598, previous=595
    expect(result["2330"]).not.toBeNull();
    expect(result["2330"]!.close).toBe(598);
    expect(result["2330"]!.previousClose).toBe(595);
    expect(result["2330"]!.change).toBe(3);
    expect(result["2330"]!.changePercent).toBeCloseTo((3 / 595) * 100, 4);
    expect(result["2330"]!.asOf).toBe("2026-03-28");
    expect(result["2330"]!.source).toBe("test");

    // 2317: 1 day → null derived fields
    expect(result["2317"]).not.toBeNull();
    expect(result["2317"]!.close).toBe(109);
    expect(result["2317"]!.previousClose).toBeNull();
    expect(result["2317"]!.change).toBeNull();
    expect(result["2317"]!.changePercent).toBeNull();
  });

  it("TC-U2: single bar → null previousClose, change, changePercent", async () => {
    persistence._seedDailyBars(FIXTURE_BARS_2317);

    const result = await resolveQuoteSnapshots(
      [{ ticker: "2317", marketCode: "TW" }],
      persistence,
      new Map([["TW", "2026-03-28"]]),
    );

    expect(result["2317"]).not.toBeNull();
    expect(result["2317"]!.close).toBe(109);
    expect(result["2317"]!.previousClose).toBeNull();
    expect(result["2317"]!.change).toBeNull();
    expect(result["2317"]!.changePercent).toBeNull();
    expect(result["2317"]!.asOf).toBe("2026-03-28");
  });

  it("TC-U3: zero bars → null snapshot for ticker", async () => {
    // No bars seeded for "9999"
    const result = await resolveQuoteSnapshots(
      [{ ticker: "9999", marketCode: "TW" }],
      persistence,
      EMPTY_SETTLED,
    );

    expect(result["9999"]).toBeNull();
  });

  it("TC-U4: mixed tickers — some with bars, some without", async () => {
    persistence._seedDailyBars(FIXTURE_BARS_2330); // 2330 has data, 9999 does not

    const result = await resolveQuoteSnapshots(
      [{ ticker: "2330", marketCode: "TW" }, { ticker: "9999", marketCode: "TW" }],
      persistence,
      new Map([["TW", "2026-03-28"]]),
    );

    expect(result["2330"]).not.toBeNull();
    expect(result["2330"]!.close).toBe(598);
    expect(result["9999"]).toBeNull();
  });

  it("TC-U5: TW ticker, barDate < settledByMarket('TW') → isProvisional=true", async () => {
    // Latest bar 2026-03-28; settled 2026-03-30 (e.g. Monday after) → stale → provisional
    persistence._seedDailyBars(FIXTURE_BARS_2330);

    const result = await resolveQuoteSnapshots(
      [{ ticker: "2330", marketCode: "TW" }],
      persistence,
      new Map([["TW", "2026-03-30"]]),
    );

    expect(result["2330"]!.isProvisional).toBe(true);
  });

  it("TC-U6: TW ticker, barDate == settledByMarket('TW') → isProvisional=false", async () => {
    // Latest bar 2026-03-28; settled 2026-03-28 → current → not provisional
    persistence._seedDailyBars(FIXTURE_BARS_2330);

    const result = await resolveQuoteSnapshots(
      [{ ticker: "2330", marketCode: "TW" }],
      persistence,
      new Map([["TW", "2026-03-28"]]),
    );

    expect(result["2330"]!.isProvisional).toBe(false);
  });

  it("TC-U7: changePercent division guard — previousClose=0 → null change and changePercent", async () => {
    persistence._seedDailyBars(FIXTURE_BARS_ZEROPREV);

    const result = await resolveQuoteSnapshots(
      [{ ticker: "ZEROPREV", marketCode: "TW" }],
      persistence,
      new Map([["TW", "2026-03-28"]]),
    );

    expect(result["ZEROPREV"]).not.toBeNull();
    expect(result["ZEROPREV"]!.close).toBe(5);
    expect(result["ZEROPREV"]!.previousClose).toBe(0);
    // Division by zero guard: change and changePercent must be null, not Infinity or NaN
    expect(result["ZEROPREV"]!.change).toBeNull();
    expect(result["ZEROPREV"]!.changePercent).toBeNull();
  });

  it("TC-U8: empty pairs array → empty result object", async () => {
    persistence._seedDailyBars(FIXTURE_BARS_2330);

    const result = await resolveQuoteSnapshots([], persistence, EMPTY_SETTLED);

    expect(result).toEqual({});
  });

  // KZO-191: multi-market provisional coverage

  it("TC-U9 (KZO-191): US ticker, barDate == settledByMarket('US') → isProvisional=false", async () => {
    persistence._seedDailyBars(FIXTURE_BARS_AAPL);

    const result = await resolveQuoteSnapshots(
      [{ ticker: "AAPL", marketCode: "US" }],
      persistence,
      new Map([["US", "2026-03-27"]]),
    );

    expect(result["AAPL"]!.isProvisional).toBe(false);
  });

  it("TC-U10 (KZO-191): AU ticker, barDate < settledByMarket('AU') → isProvisional=true", async () => {
    persistence._seedDailyBars(FIXTURE_BARS_BHP);

    const result = await resolveQuoteSnapshots(
      [{ ticker: "BHP", marketCode: "AU" }],
      persistence,
      new Map([["AU", "2026-03-27"]]),
    );

    expect(result["BHP"]!.isProvisional).toBe(true);
  });

  it("TC-U11 (KZO-191): pair without marketCode → isProvisional=false regardless of settledByMarket", async () => {
    // Mirrors the GET /quotes path: caller has no store context, passes pairs
    // with no marketCode. Also covers the manual-instrument fallback.
    persistence._seedDailyBars(FIXTURE_BARS_2330);

    const result = await resolveQuoteSnapshots(
      [{ ticker: "2330" }],
      persistence,
      // Even with a non-matching market in the map, missing marketCode on the
      // pair short-circuits to false — no lookup happens.
      new Map([["TW", "2026-04-01"]]),
    );

    expect(result["2330"]).not.toBeNull();
    expect(result["2330"]!.close).toBe(598);
    expect(result["2330"]!.isProvisional).toBe(false);
  });
});
