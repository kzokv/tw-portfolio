import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryPersistence } from "../../src/persistence/memory.js";
import {
  _resetAppConfigCache,
  refresh,
  setAppConfigCachePersistence,
} from "../../src/services/appConfig/cache.js";
import { resolveQuoteSnapshots } from "../../src/services/market-data/quoteSnapshotService.js";
import { seedCache } from "./appConfig/_helpers.js";

const FULL_BAR = "full_bar" as const;

// Fixtures — realistic TWSE bars matching the KZO-87 design doc
const FIXTURE_BARS_2330 = [
  { ticker: "2330", barDate: "2026-03-28", open: 595, high: 600, low: 590, close: 598, volume: 25000000, quality: FULL_BAR, source: "test", ingestedAt: "2026-03-28T18:00:00Z" },
  { ticker: "2330", barDate: "2026-03-27", open: 590, high: 596, low: 588, close: 595, volume: 22000000, quality: FULL_BAR, source: "test", ingestedAt: "2026-03-27T18:00:00Z" },
  { ticker: "2330", barDate: "2026-03-26", open: 585, high: 592, low: 583, close: 590, volume: 20000000, quality: FULL_BAR, source: "test", ingestedAt: "2026-03-26T18:00:00Z" },
];

// Single-bar ticker — derived fields must all be null
const FIXTURE_BARS_2317 = [
  { ticker: "2317", barDate: "2026-03-28", open: 108, high: 110, low: 107, close: 109, volume: 15000000, quality: FULL_BAR, source: "test", ingestedAt: "2026-03-28T18:00:00Z" },
];

// Division guard — previousClose=0 must produce null change/changePercent, not Infinity/NaN
const FIXTURE_BARS_ZEROPREV = [
  { ticker: "ZEROPREV", barDate: "2026-03-28", open: 0, high: 0, low: 0, close: 5, volume: 100, quality: FULL_BAR, source: "test", ingestedAt: "2026-03-28T18:00:00Z" },
  { ticker: "ZEROPREV", barDate: "2026-03-27", open: 0, high: 0, low: 0, close: 0, volume: 100, quality: FULL_BAR, source: "test", ingestedAt: "2026-03-27T18:00:00Z" },
];

// KZO-191: US/AU fixtures for multi-market provisional coverage
const FIXTURE_BARS_AAPL = [
  { ticker: "AAPL", marketCode: "US", barDate: "2026-03-27", open: 170, high: 173, low: 169, close: 172, volume: 50000000, quality: FULL_BAR, source: "test", ingestedAt: "2026-03-27T22:00:00Z" },
];

const FIXTURE_BARS_BHP = [
  { ticker: "BHP", marketCode: "AU", barDate: "2026-03-25", open: 44, high: 45, low: 43.5, close: 44.5, volume: 8000000, quality: FULL_BAR, source: "test", ingestedAt: "2026-03-25T07:00:00Z" },
];

const EMPTY_SETTLED = new Map<string, string>();

function tradingCalendarWithDates(dates: ReadonlyArray<string>) {
  const tradingDates = new Set(dates);
  return {
    isTradingDay: async (_market: string, date: string) => tradingDates.has(date),
    getTradingDates: async () => tradingDates,
  };
}

async function seedEodhdFallbackSnapshot(
  persistence: MemoryPersistence,
  input: {
    ticker?: string;
    marketDate: string;
    close: number;
    previousClose: number | null;
    fetchedAt?: string;
  },
) {
  const ticker = input.ticker ?? "ETPMAG";
  const policy = await persistence.upsertQuoteFallbackPolicy({
    ticker,
    marketCode: "AU",
    provider: "eodhd",
    priceType: "eod_close",
    providerSymbol: `${ticker}.AU`,
    reason: "Yahoo AU delayed close",
  });
  await persistence.upsertQuoteFallbackSnapshot({
    policyId: policy.id,
    ticker,
    marketCode: "AU",
    provider: "eodhd",
    priceType: "eod_close",
    providerSymbol: `${ticker}.AU`,
    marketDate: input.marketDate,
    close: input.close,
    previousClose: input.previousClose,
    currency: "AUD",
    currencySource: "provider",
    source: "eodhd-eod",
    fetchedAt: input.fetchedAt ?? `${input.marketDate}T07:15:00.000Z`,
  });
}

describe("resolveQuoteSnapshots", () => {
  let persistence: MemoryPersistence;

  beforeEach(async () => {
    _resetAppConfigCache();
    persistence = new MemoryPersistence();
    await persistence.init();
  });

  afterEach(() => {
    _resetAppConfigCache();
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
    expect(result["2330"]!.priceState.basis).toBe("today_close");

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

  it("TC-U10b: cross-listed bare ticker keeps AU and US snapshots separate", async () => {
    persistence._seedDailyBars([
      { ticker: "BHP", marketCode: "AU", barDate: "2026-03-28", open: 44, high: 45, low: 43, close: 44.5, volume: 8000000, quality: FULL_BAR, source: "au", ingestedAt: "2026-03-28T07:00:00Z" },
      { ticker: "BHP", marketCode: "AU", barDate: "2026-03-27", open: 43, high: 44, low: 42, close: 43.5, volume: 7000000, quality: FULL_BAR, source: "au", ingestedAt: "2026-03-27T07:00:00Z" },
      { ticker: "BHP", marketCode: "US", barDate: "2026-03-28", open: 58, high: 59, low: 57, close: 58.25, volume: 3000000, quality: FULL_BAR, source: "us", ingestedAt: "2026-03-28T22:00:00Z" },
      { ticker: "BHP", marketCode: "US", barDate: "2026-03-27", open: 57, high: 58, low: 56, close: 57.25, volume: 2800000, quality: FULL_BAR, source: "us", ingestedAt: "2026-03-27T22:00:00Z" },
    ]);

    const result = await resolveQuoteSnapshots(
      [{ ticker: "BHP", marketCode: "AU" }, { ticker: "BHP", marketCode: "US" }],
      persistence,
      new Map([["AU", "2026-03-28"], ["US", "2026-03-28"]]),
    );

    expect(result["BHP:AU"]?.close).toBe(44.5);
    expect(result["BHP:AU"]?.previousClose).toBe(43.5);
    expect(result["BHP:AU"]?.source).toBe("au");
    expect(result["BHP:US"]?.close).toBe(58.25);
    expect(result["BHP:US"]?.previousClose).toBe(57.25);
    expect(result["BHP:US"]?.source).toBe("us");
    expect(result["BHP"]).toBeUndefined();
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

  it("uses the intraday overlay for held tickers during open regular sessions", async () => {
    persistence._seedDailyBars([
      { ticker: "2330", marketCode: "TW", barDate: "2026-06-16", open: 995, high: 1000, low: 990, close: 998, volume: 100, quality: FULL_BAR, source: "daily", ingestedAt: "2026-06-16T13:40:00.000Z" },
      { ticker: "2330", marketCode: "TW", barDate: "2026-06-13", open: 980, high: 985, low: 975, close: 982, volume: 100, quality: FULL_BAR, source: "daily", ingestedAt: "2026-06-13T13:40:00.000Z" },
    ]);
    await persistence.setLatestIntradayOverlay({
      ticker: "2330",
      marketCode: "TW",
      price: 1010,
      previousClose: 998,
      asOfDate: "2026-06-17",
      asOfTimestamp: "2026-06-17T01:15:00.000Z",
      observedAt: "2026-06-17T01:16:00.000Z",
      sourceKind: "intraday_yahoo_chart",
      source: "yahoo-finance-chart",
      currency: "TWD",
    });

    const result = await resolveQuoteSnapshots(
      [{ ticker: "2330", marketCode: "TW" }],
      persistence,
      new Map([["TW", "2026-06-16"]]),
      {
        mode: "displayed",
        now: new Date("2026-06-17T01:18:00.000Z"),
        heldPairs: new Set(["2330:TW"]),
        tradingCalendar: {
          isTradingDay: async () => true,
        },
      },
    );

    expect(result["2330"]?.close).toBe(1010);
    expect(result["2330"]?.dailyCompatibleClose).toBe(998);
    expect(result["2330"]?.priceState.basis).toBe("intraday");
    expect(result["2330"]?.priceState.chipState).toBe("open_fresh");
  });

  it("marks open-session intraday overlays as delayed after the freshness tolerance", async () => {
    persistence._seedDailyBars([
      { ticker: "2330", marketCode: "TW", barDate: "2026-06-16", open: 995, high: 1000, low: 990, close: 998, volume: 100, quality: FULL_BAR, source: "daily", ingestedAt: "2026-06-16T13:40:00.000Z" },
      { ticker: "2330", marketCode: "TW", barDate: "2026-06-13", open: 980, high: 985, low: 975, close: 982, volume: 100, quality: FULL_BAR, source: "daily", ingestedAt: "2026-06-13T13:40:00.000Z" },
    ]);
    await persistence.setLatestIntradayOverlay({
      ticker: "2330",
      marketCode: "TW",
      price: 1005,
      previousClose: 998,
      asOfDate: "2026-06-17",
      asOfTimestamp: "2026-06-17T01:00:00.000Z",
      observedAt: "2026-06-17T01:01:00.000Z",
      sourceKind: "intraday_yahoo_chart",
      source: "yahoo-finance-chart",
      currency: "TWD",
    });

    const result = await resolveQuoteSnapshots(
      [{ ticker: "2330", marketCode: "TW" }],
      persistence,
      new Map([["TW", "2026-06-16"]]),
      {
        mode: "displayed",
        now: new Date("2026-06-17T01:30:00.000Z"),
        heldPairs: new Set(["2330:TW"]),
        tradingCalendar: {
          isTradingDay: async () => true,
        },
      },
    );

    expect(result["2330"]?.close).toBe(1005);
    expect(result["2330"]?.priceState.basis).toBe("delayed_intraday");
    expect(result["2330"]?.priceState.chipState).toBe("open_delayed");
  });

  it("uses previous close while the market is open when no same-day overlay exists", async () => {
    persistence._seedDailyBars([
      { ticker: "2330", marketCode: "TW", barDate: "2026-06-16", open: 995, high: 1000, low: 990, close: 998, volume: 100, quality: FULL_BAR, source: "daily", ingestedAt: "2026-06-16T13:40:00.000Z" },
      { ticker: "2330", marketCode: "TW", barDate: "2026-06-13", open: 980, high: 985, low: 975, close: 982, volume: 100, quality: FULL_BAR, source: "daily", ingestedAt: "2026-06-13T13:40:00.000Z" },
    ]);

    const result = await resolveQuoteSnapshots(
      [{ ticker: "2330", marketCode: "TW" }],
      persistence,
      new Map([["TW", "2026-06-16"]]),
      {
        mode: "displayed",
        now: new Date("2026-06-17T01:18:00.000Z"),
        heldPairs: new Set(["2330:TW"]),
        tradingCalendar: {
          isTradingDay: async () => true,
        },
      },
    );

    expect(result["2330"]?.close).toBe(998);
    expect(result["2330"]?.priceState.marketState).toBe("open");
    expect(result["2330"]?.priceState.basis).toBe("previous_close");
    expect(result["2330"]?.priceState.chipState).toBe("open_previous_close");
  });

  it("keeps same-day provisional daily bars from masking open-session intraday state", async () => {
    persistence._seedDailyBars([
      { ticker: "QAU", marketCode: "AU", barDate: "2026-06-19", open: 34.1, high: 34.2, low: 33.2, close: 33.27, volume: 100, quality: FULL_BAR, source: "yahoo-finance-au", ingestedAt: "2026-06-19T01:00:00.000Z" },
      { ticker: "QAU", marketCode: "AU", barDate: "2026-06-18", open: 34, high: 34.3, low: 33.9, close: 34.17, volume: 100, quality: FULL_BAR, source: "yahoo-finance-au", ingestedAt: "2026-06-18T07:00:00.000Z" },
    ]);
    await persistence.setLatestIntradayOverlay({
      ticker: "QAU",
      marketCode: "AU",
      price: 33.25,
      previousClose: 34.17,
      asOfDate: "2026-06-19",
      asOfTimestamp: "2026-06-19T01:00:42.000Z",
      observedAt: "2026-06-19T01:01:00.000Z",
      sourceKind: "intraday_yahoo_chart",
      source: "yahoo-finance-chart",
      currency: "AUD",
    });

    const result = await resolveQuoteSnapshots(
      [{ ticker: "QAU", marketCode: "AU" }],
      persistence,
      new Map([["AU", "2026-06-18"]]),
      {
        mode: "displayed",
        now: new Date("2026-06-19T01:05:00.000Z"),
        heldPairs: new Set(["QAU:AU"]),
        tradingCalendar: {
          isTradingDay: async () => true,
        },
      },
    );

    expect(result["QAU"]?.close).toBe(33.25);
    expect(result["QAU"]?.dailyCompatibleClose).toBe(33.27);
    expect(result["QAU"]?.previousClose).toBe(34.17);
    expect(result["QAU"]?.priceState.marketState).toBe("open");
    expect(result["QAU"]?.priceState.basis).toBe("intraday");
    expect(result["QAU"]?.priceState.chipState).toBe("open_fresh");
    expect(result["QAU"]?.priceState.sourceKind).toBe("intraday_yahoo_chart");
  });

  it("uses a fresh EODHD fallback snapshot for displayed held AU valuation and suppresses Yahoo prices", async () => {
    persistence._seedDailyBars([
      { ticker: "ETPMAG", marketCode: "AU", barDate: "2026-06-19", open: 8.9, high: 9.1, low: 8.8, close: 9.05, volume: 100, quality: FULL_BAR, source: "yahoo-finance-au", ingestedAt: "2026-06-19T01:00:00.000Z" },
      { ticker: "ETPMAG", marketCode: "AU", barDate: "2026-06-18", open: 8.5, high: 8.7, low: 8.4, close: 8.65, volume: 100, quality: FULL_BAR, source: "yahoo-finance-au", ingestedAt: "2026-06-18T07:00:00.000Z" },
    ]);
    await persistence.setLatestIntradayOverlay({
      ticker: "ETPMAG",
      marketCode: "AU",
      price: 9.12,
      previousClose: 8.65,
      asOfDate: "2026-06-19",
      asOfTimestamp: "2026-06-19T01:00:42.000Z",
      observedAt: "2026-06-19T01:01:00.000Z",
      sourceKind: "intraday_yahoo_chart",
      source: "yahoo-finance-chart",
      currency: "AUD",
      providerSymbol: "ETPMAG.AX",
    });
    await seedEodhdFallbackSnapshot(persistence, {
      marketDate: "2026-06-19",
      close: 8.12,
      previousClose: 8.01,
    });

    const result = await resolveQuoteSnapshots(
      [{ ticker: "ETPMAG", marketCode: "AU" }],
      persistence,
      new Map([["AU", "2026-06-19"]]),
      {
        mode: "displayed",
        now: new Date("2026-06-19T07:00:00.000Z"),
        heldPairs: new Set(["ETPMAG:AU"]),
        tradingCalendar: tradingCalendarWithDates(["2026-06-18", "2026-06-19"]),
      },
    );

    expect(result["ETPMAG:AU"]?.close).toBe(8.12);
    expect(result["ETPMAG:AU"]?.dailyCompatibleClose).toBe(8.12);
    expect(result["ETPMAG:AU"]?.previousClose).toBe(8.01);
    expect(result["ETPMAG:AU"]?.change).toBeCloseTo(0.11, 4);
    expect(result["ETPMAG:AU"]?.changePercent).toBeCloseTo((0.11 / 8.01) * 100, 4);
    expect(result["ETPMAG:AU"]?.source).toBe("eodhd-eod");
    expect(result["ETPMAG:AU"]?.priceState).toEqual(expect.objectContaining({
      basis: "fallback_eod_close",
      chipState: "fallback_eod",
      sourceKind: "eodhd_eod",
      sourceId: "eodhd",
      providerSymbol: "ETPMAG.AU",
      yahooSymbol: null,
      fallbackProvider: "eodhd",
      fallbackStale: false,
    }));
  });

  it("keeps fallback valuation but withholds daily change while the AU fallback close is stale during the open session", async () => {
    await seedEodhdFallbackSnapshot(persistence, {
      marketDate: "2026-06-18",
      close: 8.12,
      previousClose: 8.01,
    });

    const result = await resolveQuoteSnapshots(
      [{ ticker: "ETPMAG", marketCode: "AU" }],
      persistence,
      new Map([["AU", "2026-06-19"]]),
      {
        mode: "displayed",
        now: new Date("2026-06-19T01:05:00.000Z"),
        heldPairs: new Set(["ETPMAG:AU"]),
        tradingCalendar: tradingCalendarWithDates(["2026-06-18", "2026-06-19"]),
      },
    );

    expect(result["ETPMAG:AU"]?.close).toBe(8.12);
    expect(result["ETPMAG:AU"]?.previousClose).toBeNull();
    expect(result["ETPMAG:AU"]?.change).toBeNull();
    expect(result["ETPMAG:AU"]?.changePercent).toBeNull();
    expect(result["ETPMAG:AU"]?.priceState).toEqual(expect.objectContaining({
      basis: "fallback_eod_close",
      chipState: "fallback_stale",
      marketState: "open",
      fallbackStale: true,
    }));
  });

  it("returns unavailable when an active fallback policy has no snapshot instead of leaking Yahoo prices", async () => {
    persistence._seedDailyBars([
      { ticker: "ETPMAG", marketCode: "AU", barDate: "2026-06-19", open: 8.9, high: 9.1, low: 8.8, close: 9.05, volume: 100, quality: FULL_BAR, source: "yahoo-finance-au", ingestedAt: "2026-06-19T01:00:00.000Z" },
      { ticker: "ETPMAG", marketCode: "AU", barDate: "2026-06-18", open: 8.5, high: 8.7, low: 8.4, close: 8.65, volume: 100, quality: FULL_BAR, source: "yahoo-finance-au", ingestedAt: "2026-06-18T07:00:00.000Z" },
    ]);
    await persistence.upsertQuoteFallbackPolicy({
      ticker: "ETPMAG",
      marketCode: "AU",
      provider: "eodhd",
      priceType: "eod_close",
      providerSymbol: "ETPMAG.AU",
      reason: "Yahoo AU delayed close",
    });

    const result = await resolveQuoteSnapshots(
      [{ ticker: "ETPMAG", marketCode: "AU" }],
      persistence,
      new Map([["AU", "2026-06-19"]]),
      {
        mode: "displayed",
        now: new Date("2026-06-19T07:00:00.000Z"),
        heldPairs: new Set(["ETPMAG:AU"]),
        tradingCalendar: tradingCalendarWithDates(["2026-06-18", "2026-06-19"]),
      },
    );

    expect(result["ETPMAG:AU"]).toBeNull();
    expect(result["ETPMAG"]).toBeNull();
  });

  it("keeps stale close state while the market is open when the latest bar is older than settled", async () => {
    persistence._seedDailyBars([
      { ticker: "AAPL", marketCode: "US", barDate: "2026-06-18", open: 195, high: 198, low: 194, close: 197, volume: 100, quality: FULL_BAR, source: "daily", ingestedAt: "2026-06-18T22:00:00.000Z" },
      { ticker: "AAPL", marketCode: "US", barDate: "2026-06-17", open: 193, high: 196, low: 192, close: 195, volume: 100, quality: FULL_BAR, source: "daily", ingestedAt: "2026-06-17T22:00:00.000Z" },
    ]);

    const result = await resolveQuoteSnapshots(
      [{ ticker: "AAPL", marketCode: "US" }],
      persistence,
      new Map([["US", "2026-06-19"]]),
      {
        mode: "displayed",
        now: new Date("2026-06-22T14:00:00.000Z"),
        heldPairs: new Set(["AAPL:US"]),
        tradingCalendar: {
          isTradingDay: async () => true,
        },
      },
    );

    expect(result["AAPL"]?.priceState.marketState).toBe("open");
    expect(result["AAPL"]?.priceState.basis).toBe("stale_close");
    expect(result["AAPL"]?.priceState.chipState).toBe("stale");
  });

  it("keeps intraday overlays enabled during open sessions when regular-session-only is disabled", async () => {
    await seedCache(
      { tickerPriceRegularSessionOnly: false },
      { _resetAppConfigCache, refresh, setAppConfigCachePersistence },
    );
    persistence._seedDailyBars([
      { ticker: "2330", marketCode: "TW", barDate: "2026-06-16", open: 995, high: 1000, low: 990, close: 998, volume: 100, quality: FULL_BAR, source: "daily", ingestedAt: "2026-06-16T13:40:00.000Z" },
      { ticker: "2330", marketCode: "TW", barDate: "2026-06-13", open: 980, high: 985, low: 975, close: 982, volume: 100, quality: FULL_BAR, source: "daily", ingestedAt: "2026-06-13T13:40:00.000Z" },
    ]);
    await persistence.setLatestIntradayOverlay({
      ticker: "2330",
      marketCode: "TW",
      price: 1015,
      previousClose: 998,
      asOfDate: "2026-06-17",
      asOfTimestamp: "2026-06-17T01:15:00.000Z",
      observedAt: "2026-06-17T01:16:00.000Z",
      sourceKind: "intraday_yahoo_chart",
      source: "yahoo-finance-chart",
      currency: "TWD",
    });

    const result = await resolveQuoteSnapshots(
      [{ ticker: "2330", marketCode: "TW" }],
      persistence,
      new Map([["TW", "2026-06-16"]]),
      {
        mode: "displayed",
        now: new Date("2026-06-17T01:18:00.000Z"),
        heldPairs: new Set(["2330:TW"]),
        tradingCalendar: {
          isTradingDay: async () => true,
        },
      },
    );

    expect(result["2330"]?.close).toBe(1015);
    expect(result["2330"]?.priceState.sourceKind).toBe("intraday_yahoo_chart");
  });

  it("uses same-day intraday overlay as pending today close after market close when daily bar has not landed", async () => {
    persistence._seedDailyBars([
      { ticker: "2330", marketCode: "TW", barDate: "2026-06-17", open: 2355, high: 2385, low: 2350, close: 2385, volume: 100, quality: FULL_BAR, source: "daily", ingestedAt: "2026-06-17T13:40:00.000Z" },
      { ticker: "2330", marketCode: "TW", barDate: "2026-06-16", open: 2375, high: 2400, low: 2350, close: 2400, volume: 100, quality: FULL_BAR, source: "daily", ingestedAt: "2026-06-16T13:40:00.000Z" },
    ]);
    await persistence.setLatestIntradayOverlay({
      ticker: "2330",
      marketCode: "TW",
      price: 2410,
      previousClose: null,
      asOfDate: "2026-06-18",
      asOfTimestamp: "2026-06-18T05:30:00.000Z",
      observedAt: "2026-06-18T05:31:00.000Z",
      sourceKind: "intraday_yahoo_chart",
      source: "yahoo-finance-chart",
      currency: "TWD",
    });

    const result = await resolveQuoteSnapshots(
      [{ ticker: "2330", marketCode: "TW" }],
      persistence,
      new Map([["TW", "2026-06-18"]]),
      {
        mode: "displayed",
        now: new Date("2026-06-18T06:00:00.000Z"),
        heldPairs: new Set(["2330:TW"]),
        tradingCalendar: tradingCalendarWithDates(["2026-06-17", "2026-06-18"]),
      },
    );

    expect(result["2330"]?.close).toBe(2410);
    expect(result["2330"]?.previousClose).toBe(2385);
    expect(result["2330"]?.change).toBe(25);
    expect(result["2330"]?.changePercent).toBeCloseTo((25 / 2385) * 100, 4);
    expect(result["2330"]?.asOf).toBe("2026-06-18T05:30:00.000Z");
    expect(result["2330"]?.dailyCompatibleClose).toBe(2385);
    expect(result["2330"]?.priceState.marketState).toBe("closed");
    expect(result["2330"]?.priceState.basis).toBe("pending_today_close");
    expect(result["2330"]?.priceState.chipState).toBe("closed_pending");
    expect(result["2330"]?.priceState.sourceKind).toBe("intraday_yahoo_chart");
  });

  it("uses latest daily close as pending today close after market close when no overlay exists", async () => {
    persistence._seedDailyBars([
      { ticker: "2330", marketCode: "TW", barDate: "2026-06-17", open: 2355, high: 2385, low: 2350, close: 2385, volume: 100, quality: FULL_BAR, source: "daily", ingestedAt: "2026-06-17T13:40:00.000Z" },
      { ticker: "2330", marketCode: "TW", barDate: "2026-06-16", open: 2375, high: 2400, low: 2350, close: 2400, volume: 100, quality: FULL_BAR, source: "daily", ingestedAt: "2026-06-16T13:40:00.000Z" },
    ]);

    const result = await resolveQuoteSnapshots(
      [{ ticker: "2330", marketCode: "TW" }],
      persistence,
      new Map([["TW", "2026-06-18"]]),
      {
        mode: "displayed",
        now: new Date("2026-06-18T06:00:00.000Z"),
        heldPairs: new Set(["2330:TW"]),
        tradingCalendar: tradingCalendarWithDates(["2026-06-17", "2026-06-18"]),
      },
    );

    expect(result["2330"]?.close).toBe(2385);
    expect(result["2330"]?.dailyCompatibleClose).toBe(2385);
    expect(result["2330"]?.priceState.marketState).toBe("closed");
    expect(result["2330"]?.priceState.basis).toBe("pending_today_close");
    expect(result["2330"]?.priceState.chipState).toBe("closed_pending");
    expect(result["2330"]?.priceState.sourceKind).toBe("primary_daily");
  });

  it("does not mark the prior trading day's close as pending before today's market opens", async () => {
    persistence._seedDailyBars([
      { ticker: "3714", marketCode: "TW", barDate: "2026-06-19", open: 70.9, high: 72.2, low: 70.5, close: 71.5, volume: 100, quality: FULL_BAR, source: "daily", ingestedAt: "2026-06-19T13:40:00.000Z" },
      { ticker: "3714", marketCode: "TW", barDate: "2026-06-18", open: 66.8, high: 68.1, low: 66.4, close: 67.2, volume: 100, quality: FULL_BAR, source: "daily", ingestedAt: "2026-06-18T13:40:00.000Z" },
    ]);

    const result = await resolveQuoteSnapshots(
      [{ ticker: "3714", marketCode: "TW" }],
      persistence,
      new Map([["TW", "2026-06-19"]]),
      {
        mode: "displayed",
        now: new Date("2026-06-22T00:00:00.000Z"),
        heldPairs: new Set(["3714:TW"]),
        tradingCalendar: tradingCalendarWithDates(["2026-06-19", "2026-06-22"]),
      },
    );

    expect(result["3714"]?.close).toBe(71.5);
    expect(result["3714"]?.priceState.marketState).toBe("closed");
    expect(result["3714"]?.priceState.basis).toBe("today_close");
    expect(result["3714"]?.priceState.chipState).toBe("closed");
  });

  it("keeps close refresh pending after close when intraday overlays are disabled", async () => {
    await seedCache(
      { tickerPriceIntradayEnabled: false },
      { _resetAppConfigCache, refresh, setAppConfigCachePersistence },
    );
    persistence._seedDailyBars([
      { ticker: "3714", marketCode: "TW", barDate: "2026-06-18", open: 66.8, high: 68.1, low: 66.4, close: 67.2, volume: 100, quality: FULL_BAR, source: "daily", ingestedAt: "2026-06-18T13:40:00.000Z" },
      { ticker: "3714", marketCode: "TW", barDate: "2026-06-17", open: 65.1, high: 67.5, low: 64.9, close: 66.5, volume: 100, quality: FULL_BAR, source: "daily", ingestedAt: "2026-06-17T13:40:00.000Z" },
    ]);

    const result = await resolveQuoteSnapshots(
      [{ ticker: "3714", marketCode: "TW" }],
      persistence,
      new Map([["TW", "2026-06-22"]]),
      {
        mode: "displayed",
        now: new Date("2026-06-22T06:05:00.000Z"),
        heldPairs: new Set(["3714:TW"]),
        tradingCalendar: tradingCalendarWithDates(["2026-06-18", "2026-06-22"]),
      },
    );

    expect(result["3714"]?.close).toBe(67.2);
    expect(result["3714"]?.priceState.marketState).toBe("closed");
    expect(result["3714"]?.priceState.basis).toBe("pending_today_close");
    expect(result["3714"]?.priceState.chipState).toBe("closed_pending");
    expect(result["3714"]?.priceState.sourceKind).toBe("primary_daily");
  });

  it("ignores older overlays and uses latest daily close as pending today close after market close", async () => {
    persistence._seedDailyBars([
      { ticker: "2330", marketCode: "TW", barDate: "2026-06-17", open: 2355, high: 2385, low: 2350, close: 2385, volume: 100, quality: FULL_BAR, source: "daily", ingestedAt: "2026-06-17T13:40:00.000Z" },
      { ticker: "2330", marketCode: "TW", barDate: "2026-06-16", open: 2375, high: 2400, low: 2350, close: 2400, volume: 100, quality: FULL_BAR, source: "daily", ingestedAt: "2026-06-16T13:40:00.000Z" },
    ]);
    await persistence.setLatestIntradayOverlay({
      ticker: "2330",
      marketCode: "TW",
      price: 2405,
      previousClose: 2385,
      asOfDate: "2026-06-17",
      asOfTimestamp: "2026-06-17T05:30:00.000Z",
      observedAt: "2026-06-17T05:31:00.000Z",
      sourceKind: "intraday_yahoo_chart",
      source: "yahoo-finance-chart",
      currency: "TWD",
    });

    const result = await resolveQuoteSnapshots(
      [{ ticker: "2330", marketCode: "TW" }],
      persistence,
      new Map([["TW", "2026-06-18"]]),
      {
        mode: "displayed",
        now: new Date("2026-06-18T06:00:00.000Z"),
        heldPairs: new Set(["2330:TW"]),
        tradingCalendar: {
          isTradingDay: async () => true,
        },
      },
    );

    expect(result["2330"]?.close).toBe(2385);
    expect(result["2330"]?.dailyCompatibleClose).toBe(2385);
    expect(result["2330"]?.priceState.marketState).toBe("closed");
    expect(result["2330"]?.priceState.basis).toBe("pending_today_close");
    expect(result["2330"]?.priceState.chipState).toBe("closed_pending");
    expect(result["2330"]?.priceState.sourceKind).toBe("primary_daily");
  });

  it("keeps the latest quote price pending after close until today's daily close lands", async () => {
    persistence._seedDailyBars([
      { ticker: "3714", marketCode: "TW", barDate: "2026-06-18", open: 66.8, high: 68.1, low: 66.4, close: 67.2, volume: 100, quality: FULL_BAR, source: "daily", ingestedAt: "2026-06-18T13:40:00.000Z" },
      { ticker: "3714", marketCode: "TW", barDate: "2026-06-17", open: 65.1, high: 67.5, low: 64.9, close: 66.5, volume: 100, quality: FULL_BAR, source: "daily", ingestedAt: "2026-06-17T13:40:00.000Z" },
    ]);
    await persistence.setLatestIntradayOverlay({
      ticker: "3714",
      marketCode: "TW",
      price: 71.5,
      previousClose: 67.2,
      asOfDate: "2026-06-22",
      asOfTimestamp: "2026-06-22T05:20:00.000Z",
      observedAt: "2026-06-22T05:21:00.000Z",
      sourceKind: "intraday_yahoo_chart",
      source: "yahoo-finance-chart",
      currency: "TWD",
    });

    const result = await resolveQuoteSnapshots(
      [{ ticker: "3714", marketCode: "TW" }],
      persistence,
      new Map([["TW", "2026-06-22"]]),
      {
        mode: "displayed",
        now: new Date("2026-06-22T06:05:00.000Z"),
        heldPairs: new Set(["3714:TW"]),
        tradingCalendar: tradingCalendarWithDates(["2026-06-18", "2026-06-22"]),
      },
    );

    expect(result["3714"]?.close).toBe(71.5);
    expect(result["3714"]?.previousClose).toBe(67.2);
    expect(result["3714"]?.change).toBeCloseTo(4.3, 4);
    expect(result["3714"]?.changePercent).toBeCloseTo((4.3 / 67.2) * 100, 4);
    expect(result["3714"]?.dailyCompatibleClose).toBe(67.2);
    expect(result["3714"]?.priceState.marketState).toBe("closed");
    expect(result["3714"]?.priceState.basis).toBe("pending_today_close");
    expect(result["3714"]?.priceState.chipState).toBe("closed_pending");
    expect(result["3714"]?.priceState.sourceKind).toBe("intraday_yahoo_chart");
  });

  it("keeps older multi-session daily gaps stale instead of closed pending after market close", async () => {
    persistence._seedDailyBars([
      { ticker: "3714", marketCode: "TW", barDate: "2026-06-17", open: 65.1, high: 67.5, low: 64.9, close: 66.5, volume: 100, quality: FULL_BAR, source: "daily", ingestedAt: "2026-06-17T13:40:00.000Z" },
      { ticker: "3714", marketCode: "TW", barDate: "2026-06-16", open: 64.5, high: 65.5, low: 63.8, close: 65.1, volume: 100, quality: FULL_BAR, source: "daily", ingestedAt: "2026-06-16T13:40:00.000Z" },
    ]);

    const result = await resolveQuoteSnapshots(
      [{ ticker: "3714", marketCode: "TW" }],
      persistence,
      new Map([["TW", "2026-06-22"]]),
      {
        mode: "displayed",
        now: new Date("2026-06-22T06:05:00.000Z"),
        heldPairs: new Set(["3714:TW"]),
        tradingCalendar: tradingCalendarWithDates(["2026-06-18", "2026-06-22"]),
      },
    );

    expect(result["3714"]?.close).toBe(66.5);
    expect(result["3714"]?.priceState.marketState).toBe("closed");
    expect(result["3714"]?.priceState.basis).toBe("stale_close");
    expect(result["3714"]?.priceState.chipState).toBe("stale");
  });

  it("prefers same-day daily bars over intraday overlays after close", async () => {
    persistence._seedDailyBars([
      { ticker: "2330", marketCode: "TW", barDate: "2026-06-18", open: 2390, high: 2420, low: 2385, close: 2410, volume: 100, quality: FULL_BAR, source: "daily", ingestedAt: "2026-06-18T13:40:00.000Z" },
      { ticker: "2330", marketCode: "TW", barDate: "2026-06-17", open: 2355, high: 2385, low: 2350, close: 2385, volume: 100, quality: FULL_BAR, source: "daily", ingestedAt: "2026-06-17T13:40:00.000Z" },
    ]);
    await persistence.setLatestIntradayOverlay({
      ticker: "2330",
      marketCode: "TW",
      price: 2405,
      previousClose: 2385,
      asOfDate: "2026-06-18",
      asOfTimestamp: "2026-06-18T05:25:00.000Z",
      observedAt: "2026-06-18T05:26:00.000Z",
      sourceKind: "intraday_yahoo_chart",
      source: "yahoo-finance-chart",
      currency: "TWD",
    });

    const result = await resolveQuoteSnapshots(
      [{ ticker: "2330", marketCode: "TW" }],
      persistence,
      new Map([["TW", "2026-06-18"]]),
      {
        mode: "displayed",
        now: new Date("2026-06-18T06:00:00.000Z"),
        heldPairs: new Set(["2330:TW"]),
        tradingCalendar: tradingCalendarWithDates(["2026-06-17", "2026-06-18"]),
      },
    );

    expect(result["2330"]?.close).toBe(2410);
    expect(result["2330"]?.dailyCompatibleClose).toBe(2410);
    expect(result["2330"]?.priceState.marketState).toBe("closed");
    expect(result["2330"]?.priceState.basis).toBe("today_close");
    expect(result["2330"]?.priceState.sourceKind).toBe("primary_daily");
  });

  it("treats same-day Yahoo close-only daily bars as today's closed price", async () => {
    persistence._seedDailyBars([
      { ticker: "3714", marketCode: "TW", barDate: "2026-06-22", open: 72.9, high: 72.9, low: 72.9, close: 72.9, volume: 0, quality: "close_only", source: "yahoo-chart-close", ingestedAt: "2026-06-22T06:10:00.000Z" },
      { ticker: "3714", marketCode: "TW", barDate: "2026-06-18", open: 66.8, high: 68.1, low: 66.4, close: 67.2, volume: 100, quality: FULL_BAR, source: "daily", ingestedAt: "2026-06-18T13:40:00.000Z" },
    ]);

    const result = await resolveQuoteSnapshots(
      [{ ticker: "3714", marketCode: "TW" }],
      persistence,
      new Map([["TW", "2026-06-22"]]),
      {
        mode: "displayed",
        now: new Date("2026-06-22T06:15:00.000Z"),
        heldPairs: new Set(["3714:TW"]),
        tradingCalendar: tradingCalendarWithDates(["2026-06-18", "2026-06-22"]),
      },
    );

    expect(result["3714"]?.close).toBe(72.9);
    expect(result["3714"]?.priceState).toEqual(expect.objectContaining({
      basis: "today_close",
      chipState: "closed",
      sourceKind: "yahoo_chart_close",
      sourceId: "yahoo-chart-close",
      quality: "close_only",
    }));
  });

  it("reports closed-session overlays as pending close when regular-session-only is disabled", async () => {
    await seedCache(
      { tickerPriceRegularSessionOnly: false },
      { _resetAppConfigCache, refresh, setAppConfigCachePersistence },
    );
    persistence._seedDailyBars([
      { ticker: "2330", marketCode: "TW", barDate: "2026-06-16", open: 995, high: 1000, low: 990, close: 998, volume: 100, quality: FULL_BAR, source: "daily", ingestedAt: "2026-06-16T13:40:00.000Z" },
      { ticker: "2330", marketCode: "TW", barDate: "2026-06-13", open: 980, high: 985, low: 975, close: 982, volume: 100, quality: FULL_BAR, source: "daily", ingestedAt: "2026-06-13T13:40:00.000Z" },
    ]);
    await persistence.setLatestIntradayOverlay({
      ticker: "2330",
      marketCode: "TW",
      price: 1015,
      previousClose: 998,
      asOfDate: "2026-06-17",
      asOfTimestamp: "2026-06-17T05:00:00.000Z",
      observedAt: "2026-06-17T05:00:10.000Z",
      sourceKind: "intraday_yahoo_chart",
      source: "yahoo-finance-chart",
      currency: "TWD",
    });

    const result = await resolveQuoteSnapshots(
      [{ ticker: "2330", marketCode: "TW" }],
      persistence,
      new Map([["TW", "2026-06-16"]]),
      {
        mode: "displayed",
        now: new Date("2026-06-17T07:00:00.000Z"),
        heldPairs: new Set(["2330:TW"]),
        tradingCalendar: {
          isTradingDay: async () => true,
        },
      },
    );

    expect(result["2330"]?.close).toBe(1015);
    expect(result["2330"]?.dailyCompatibleClose).toBe(998);
    expect(result["2330"]?.priceState.marketState).toBe("closed");
    expect(result["2330"]?.priceState.basis).toBe("pending_today_close");
    expect(result["2330"]?.priceState.chipState).toBe("closed_pending");
    expect(result["2330"]?.priceState.sourceKind).toBe("intraday_yahoo_chart");
  });
});
