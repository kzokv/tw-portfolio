import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  YahooFinanceIntradayProvider,
  buildYahooChartOptions,
  selectLatestSameMarketDateClose,
} from "../../../src/services/market-data/providers/yahooFinanceIntraday.js";
import { YahooChartCloseProvider } from "../../../src/services/market-data/providers/yahooChartClose.js";
import { parseTwseStockDayRow, TwseStockDayCloseProvider } from "../../../src/services/market-data/providers/twseStockDayClose.js";
import { RateLimitedError } from "../../../src/services/market-data/types.js";

interface SdkStub {
  chart: ReturnType<typeof vi.fn>;
}

let activeSdkStub: SdkStub | null = null;

vi.mock("yahoo-finance2", () => {
  class FakeYahooFinance {
    chart(...args: unknown[]) {
      return (activeSdkStub!.chart as unknown as (...callArgs: unknown[]) => unknown)(...args);
    }
  }
  return { default: FakeYahooFinance };
});

describe("yahooFinanceIntradayProvider", () => {
  beforeEach(() => {
    activeSdkStub = { chart: vi.fn() };
  });

  afterEach(() => {
    activeSdkStub = null;
    vi.restoreAllMocks();
  });

  it("extracts the latest same-market-date non-null close and stamps a stable sourceKind", async () => {
    activeSdkStub!.chart.mockResolvedValue({
      meta: { currency: "USD", previousClose: 210.11 },
      quotes: [
        { date: new Date("2026-06-16T20:00:00.000Z"), close: 209.1 },
        { date: new Date("2026-06-17T13:30:00.000Z"), close: null },
        { date: new Date("2026-06-17T15:05:00.000Z"), close: 212.45 },
      ],
    });

    const provider = new YahooFinanceIntradayProvider({ range: "1d", interval: "1m" });
    const overlay = await provider.fetchLatestOverlay({
      ticker: "AAPL",
      marketCode: "US",
      now: new Date("2026-06-17T15:06:00.000Z"),
    });

    expect(overlay).toMatchObject({
      ticker: "AAPL",
      marketCode: "US",
      price: 212.45,
      previousClose: 210.11,
      asOfDate: "2026-06-17",
      sourceKind: "yahoo_chart",
      source: "yahoo-finance-chart",
      providerSymbol: "AAPL",
      currency: "USD",
    });
    expect(activeSdkStub!.chart).toHaveBeenCalledWith(
      "AAPL",
      expect.objectContaining({
        includePrePost: false,
        interval: "1m",
        period1: new Date("2026-06-16T15:06:00.000Z"),
        period2: new Date("2026-06-17T15:06:00.000Z"),
      }),
      { validateResult: false },
    );
    expect(activeSdkStub!.chart.mock.calls[0]?.[1]).not.toHaveProperty("range");
  });

  it("converts configured chart ranges to SDK period options", () => {
    const now = new Date("2026-06-17T15:06:00.000Z");

    expect(buildYahooChartOptions("5d", "15m", now)).toEqual({
      period1: new Date("2026-06-12T15:06:00.000Z"),
      period2: now,
      interval: "15m",
      includePrePost: false,
    });
  });

  it("prefers KR durable symbol mappings over inferred suffixes", async () => {
    activeSdkStub!.chart.mockResolvedValue({
      meta: { currency: "KRW", previousClose: 72000 },
      quotes: [{ date: new Date("2026-06-17T01:02:00.000Z"), close: 72100 }],
    });
    const persistence = {
      getProviderResolutionMapping: vi.fn().mockResolvedValue({ resolvedSymbol: "005930.KQ" }),
      getInstrument: vi.fn().mockResolvedValue(null),
    };

    const provider = new YahooFinanceIntradayProvider({
      range: "1d",
      interval: "1m",
      persistence,
    });
    await provider.fetchLatestOverlay({
      ticker: "005930",
      marketCode: "KR",
      now: new Date("2026-06-17T01:03:00.000Z"),
    });

    expect(persistence.getProviderResolutionMapping).toHaveBeenCalledWith(
      "yahoo-finance-kr",
      "KR",
      "005930",
    );
    expect(activeSdkStub!.chart).toHaveBeenCalledWith(
      "005930.KQ",
      expect.any(Object),
      { validateResult: false },
    );
  });

  it("resolves TW TPEx instruments to Yahoo `.TWO` symbols", async () => {
    activeSdkStub!.chart.mockResolvedValue({
      meta: { currency: "TWD", previousClose: 86.1 },
      quotes: [{ date: new Date("2026-06-17T02:02:00.000Z"), close: 94.7 }],
    });
    const persistence = {
      getInstrument: vi.fn().mockResolvedValue({ typeRaw: "tpex", catalogExchangeRaw: null, catalogMicCode: null }),
    };
    const provider = new YahooFinanceIntradayProvider({
      range: "1d",
      interval: "1m",
      persistence,
    });

    const overlay = await provider.fetchLatestOverlay({
      ticker: "6548",
      marketCode: "TW",
      now: new Date("2026-06-17T02:03:00.000Z"),
    });

    expect(persistence.getInstrument).toHaveBeenCalledWith("6548", "TW");
    expect(activeSdkStub!.chart).toHaveBeenCalledWith(
      "6548.TWO",
      expect.any(Object),
      { validateResult: false },
    );
    expect(overlay).toMatchObject({
      ticker: "6548",
      marketCode: "TW",
      price: 94.7,
      previousClose: 86.1,
      providerSymbol: "6548.TWO",
    });
  });

  it("keeps TWSE instruments on Yahoo `.TW` symbols", async () => {
    activeSdkStub!.chart.mockResolvedValue({
      meta: { currency: "TWD", previousClose: 2410 },
      quotes: [{ date: new Date("2026-06-17T02:02:00.000Z"), close: 2495 }],
    });
    const persistence = {
      getInstrument: vi.fn().mockResolvedValue({ typeRaw: "twse", catalogExchangeRaw: null, catalogMicCode: null }),
    };
    const provider = new YahooFinanceIntradayProvider({
      range: "1d",
      interval: "1m",
      persistence,
    });

    await provider.fetchLatestOverlay({
      ticker: "2330",
      marketCode: "TW",
      now: new Date("2026-06-17T02:03:00.000Z"),
    });

    expect(activeSdkStub!.chart).toHaveBeenCalledWith(
      "2330.TW",
      expect.any(Object),
      { validateResult: false },
    );
  });

  it("returns null instead of throwing on permanent Yahoo no-data responses", async () => {
    activeSdkStub!.chart.mockRejectedValue(new Error("No data found, symbol may be delisted"));
    const provider = new YahooFinanceIntradayProvider({ range: "1d", interval: "1m" });

    await expect(provider.fetchLatestOverlay({
      ticker: "MISSING",
      marketCode: "US",
      now: new Date("2026-06-17T15:06:00.000Z"),
    })).resolves.toBeNull();
  });

  it("returns null when no same-market-date close exists", () => {
    const selected = selectLatestSameMarketDateClose(
      [{ date: new Date("2026-06-16T05:00:00.000Z"), close: 100 }],
      "TW",
      new Date("2026-06-17T05:05:00.000Z"),
    );
    expect(selected).toBeNull();
  });

  it("ignores timestamped Yahoo quotes without finite numeric closes", async () => {
    activeSdkStub!.chart.mockResolvedValue({
      meta: { currency: "AUD", previousClose: 89.74 },
      quotes: [
        { date: new Date("2026-06-23T01:00:00.000Z"), close: null },
        { date: new Date("2026-06-23T01:01:00.000Z"), close: Number.NaN },
      ],
    });
    const provider = new YahooFinanceIntradayProvider({ range: "1d", interval: "1m" });

    const result = await provider.fetchLatestOverlayResult({
      ticker: "ETPMAG",
      marketCode: "AU",
      now: new Date("2026-06-23T01:03:00.000Z"),
    });

    expect(result.overlay).toBeNull();
    expect(result.diagnostic).toMatchObject({
      quoteCounts: {
        total: 2,
        timestamped: 2,
        nonNullClose: 0,
        validClose: 0,
        sameDayValidClose: 0,
      },
      firstValidClose: null,
      lastValidClose: null,
      rejectionReason: "no_valid_close_quotes",
    });
  });

  it("summarizes Yahoo chart responses when no same-market-date close exists", async () => {
    activeSdkStub!.chart.mockResolvedValue({
      meta: { currency: "AUD", previousClose: 89.74 },
      quotes: [
        { date: new Date("2026-06-18T13:30:00.000Z"), close: 89.74 },
        { date: new Date("2026-06-22T13:30:00.000Z"), close: 87 },
      ],
    });
    const provider = new YahooFinanceIntradayProvider({ range: "5d", interval: "1m" });

    const result = await provider.fetchLatestOverlayResult({
      ticker: "ETPMAG",
      marketCode: "AU",
      now: new Date("2026-06-23T01:03:00.000Z"),
    });

    expect(result.overlay).toBeNull();
    expect(result.diagnostic).toEqual({
      ticker: "ETPMAG",
      marketCode: "AU",
      resolvedProviderSymbol: "ETPMAG.AX",
      chartOptions: {
        period1: "2026-06-18T01:03:00.000Z",
        period2: "2026-06-23T01:03:00.000Z",
        interval: "1m",
        includePrePost: false,
      },
      quoteCounts: {
        total: 2,
        timestamped: 2,
        nonNullClose: 2,
        validClose: 2,
        sameDayValidClose: 0,
      },
      firstValidClose: { timestamp: "2026-06-18T13:30:00.000Z", value: 89.74 },
      lastValidClose: { timestamp: "2026-06-22T13:30:00.000Z", value: 87 },
      metaCurrency: "AUD",
      metaPreviousClose: 89.74,
      rejectionReason: "no_same_day_valid_close",
    });
  });

  it("enforces the shared Yahoo chart request budget before close fallback calls Yahoo", async () => {
    const provider = new YahooChartCloseProvider({
      range: "1d",
      interval: "1m",
      requestBudget: {
        tryConsume: vi.fn().mockResolvedValue({ allowed: false, retryAfterMs: 12_000 }),
      },
    });

    await expect(provider.fetchCloseOnlyBar(
      "AAPL",
      "US",
      "2026-06-17",
      new Date("2026-06-17T21:00:00.000Z"),
    )).rejects.toBeInstanceOf(RateLimitedError);
    expect(activeSdkStub!.chart).not.toHaveBeenCalled();
  });

  it("selects Yahoo close fallback quotes for the requested bar date instead of current time", async () => {
    activeSdkStub!.chart.mockResolvedValue({
      meta: { currency: "USD", previousClose: 99 },
      quotes: [
        { date: new Date("2026-06-16T20:00:00.000Z"), close: 100 },
        { date: new Date("2026-06-17T14:00:00.000Z"), close: 110 },
      ],
    });
    const provider = new YahooChartCloseProvider({
      range: "5d",
      interval: "15m",
    });

    const bar = await provider.fetchCloseOnlyBar(
      "AAPL",
      "US",
      "2026-06-16",
      new Date("2026-06-17T14:30:00.000Z"),
    );

    expect(bar).toMatchObject({
      ticker: "AAPL",
      barDate: "2026-06-16",
      close: 100,
      quality: "close_only",
      source: "yahoo-chart-close",
    });
    expect(activeSdkStub!.chart).toHaveBeenCalledWith(
      "AAPL",
      expect.objectContaining({
        period2: new Date("2026-06-16T20:30:00.000Z"),
      }),
      { validateResult: false },
    );
  });

  it("queries Yahoo close fallback with the supplied post-close now for same-day US refresh", async () => {
    const now = new Date("2026-06-17T21:00:00.000Z");
    activeSdkStub!.chart.mockResolvedValue({
      meta: { currency: "USD", previousClose: 100 },
      quotes: [
        { date: new Date("2026-06-17T20:00:00.000Z"), close: 111 },
      ],
    });
    const provider = new YahooChartCloseProvider({
      range: "5d",
      interval: "15m",
    });

    const bar = await provider.fetchCloseOnlyBar(
      "AAPL",
      "US",
      "2026-06-17",
      now,
    );

    expect(bar).toMatchObject({
      ticker: "AAPL",
      barDate: "2026-06-17",
      close: 111,
      quality: "close_only",
      source: "yahoo-chart-close",
    });
    expect(activeSdkStub!.chart).toHaveBeenCalledWith(
      "AAPL",
      expect.objectContaining({
        period2: now,
      }),
      { validateResult: false },
    );
  });

  it("supports Yahoo close fallback for every regular-session market", async () => {
    const provider = new YahooChartCloseProvider({
      range: "5d",
      interval: "15m",
      persistence: {
        getInstrument: vi.fn().mockResolvedValue(null),
        getProviderResolutionMapping: vi.fn().mockResolvedValue(null),
      },
    });
    const cases = [
      { ticker: "2330", marketCode: "TW" as const, symbol: "2330.TW", quoteDate: "2026-06-17T06:00:00.000Z", close: 1010 },
      { ticker: "AAPL", marketCode: "US" as const, symbol: "AAPL", quoteDate: "2026-06-17T20:30:00.000Z", close: 111 },
      { ticker: "BHP", marketCode: "AU" as const, symbol: "BHP.AX", quoteDate: "2026-06-17T06:30:00.000Z", close: 48 },
      { ticker: "005930", marketCode: "KR" as const, symbol: "005930.KS", quoteDate: "2026-06-17T07:00:00.000Z", close: 72100 },
    ];

    for (const testCase of cases) {
      activeSdkStub!.chart.mockResolvedValueOnce({
        meta: { currency: "USD", previousClose: testCase.close - 1 },
        quotes: [{ date: new Date(testCase.quoteDate), close: testCase.close }],
      });

      const bar = await provider.fetchCloseOnlyBar(
        testCase.ticker,
        testCase.marketCode,
        "2026-06-17",
      );

      expect(bar).toMatchObject({
        ticker: testCase.ticker,
        barDate: "2026-06-17",
        close: testCase.close,
        quality: "close_only",
        source: "yahoo-chart-close",
      });
    }

    expect(activeSdkStub!.chart.mock.calls.map(([symbol]) => symbol)).toEqual(
      cases.map((testCase) => testCase.symbol),
    );
  });

  it("parses TWSE STOCK_DAY rows and synthesizes close-only bars", async () => {
    expect(parseTwseStockDayRow([["115/06/17", "1", "1", "1", "1", "1", "1,010", "1"]], "2026-06-17"))
      .toEqual({ date: "2026-06-17", close: "1,010" });

    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        stat: "OK",
        data: [["115/06/17", "1", "1", "1", "1", "1", "1,010", "1"]],
      }),
    });
    const provider = new TwseStockDayCloseProvider({ fetchImpl: fetchImpl as typeof fetch });
    const bar = await provider.fetchCloseOnlyBar("2330", "2026-06-17");

    expect(bar).toMatchObject({
      ticker: "2330",
      barDate: "2026-06-17",
      open: 1010,
      high: 1010,
      low: 1010,
      close: 1010,
      volume: 0,
      quality: "close_only",
      source: "twse-stock-day-close",
    });
  });
});
