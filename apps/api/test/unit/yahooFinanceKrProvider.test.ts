import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RateLimiter } from "../../src/services/market-data/rateLimiter.js";
import { RateLimitedError } from "../../src/services/market-data/types.js";

interface SdkStub {
  chart: ReturnType<typeof vi.fn>;
  quote: ReturnType<typeof vi.fn>;
  search: ReturnType<typeof vi.fn>;
}

let activeSdkStub: SdkStub | null = null;

function makeSdkStub(): SdkStub {
  return {
    chart: vi.fn(),
    quote: vi.fn(),
    search: vi.fn(),
  };
}

vi.mock("yahoo-finance2", () => {
  class FakeYahooFinance {
    chart = (...args: unknown[]) =>
      (activeSdkStub!.chart as unknown as (...a: unknown[]) => unknown)(...args);
    quote = (...args: unknown[]) =>
      (activeSdkStub!.quote as unknown as (...a: unknown[]) => unknown)(...args);
    search = (...args: unknown[]) =>
      (activeSdkStub!.search as unknown as (...a: unknown[]) => unknown)(...args);
  }
  return { default: FakeYahooFinance };
});

describe("MockYahooFinanceKrMarketDataProvider", () => {
  it("returns bare KRX tickers with KR provider source stamps", async () => {
    const { MockYahooFinanceKrMarketDataProvider } = await import(
      "../../src/services/market-data/providers/index.js"
    );
    const provider = new MockYahooFinanceKrMarketDataProvider();

    const bars = await provider.fetchBars("005930.KS");
    const dividends = await provider.fetchDividends("005930.KS");
    const metadata = await provider.fetchInstrumentMetadata("005930.KS");
    const search = await provider.searchInstruments("Samsung");

    expect(bars[0]).toMatchObject({ ticker: "005930", sourceId: "yahoo-finance-kr" });
    expect(dividends[0]).toMatchObject({ ticker: "005930", sourceId: "yahoo-finance-kr" });
    expect(metadata).toMatchObject({ ticker: "005930", typeRaw: "KRX" });
    expect(search.some((row) => row.ticker === "005930")).toBe(true);
  });
});

describe("YahooFinanceKrMarketDataProvider — real provider against mocked yahoo-finance2 SDK", () => {
  beforeEach(() => {
    activeSdkStub = makeSdkStub();
  });

  afterEach(() => {
    activeSdkStub = null;
    vi.restoreAllMocks();
  });

  async function makeProvider(rateLimitPerMinute = 60) {
    const { YahooFinanceKrMarketDataProvider } = await import(
      "../../src/services/market-data/providers/index.js"
    );
    return new YahooFinanceKrMarketDataProvider({
      rateLimiter: new RateLimiter(rateLimitPerMinute, 60_000),
    });
  }

  it("resolves bare KOSPI ticker to .KS, validates via quote(), then charts the suffixed symbol", async () => {
    activeSdkStub!.quote.mockResolvedValueOnce({
      symbol: "005930.KS",
      currency: "KRW",
      exchange: "KSC",
      longName: "Samsung Electronics Co., Ltd.",
      quoteType: "EQUITY",
    });
    activeSdkStub!.chart.mockResolvedValueOnce({
      quotes: [
        {
          date: new Date("2024-01-02T06:30:00Z"),
          open: 73000,
          high: 74000,
          low: 72000,
          close: 73500,
          volume: 1234567,
        },
      ],
      events: { dividends: [] },
    });

    const provider = await makeProvider();
    const bars = await provider.fetchBars("005930");

    expect(activeSdkStub!.quote).toHaveBeenCalledWith("005930.KS", {}, { validateResult: false });
    expect(activeSdkStub!.chart).toHaveBeenCalledWith(
      "005930.KS",
      expect.objectContaining({ interval: "1d" }),
      { validateResult: false },
    );
    expect(bars).toEqual([
      expect.objectContaining({
        ticker: "005930",
        barDate: "2024-01-02",
        close: 73500,
        sourceId: "yahoo-finance-kr",
      }),
    ]);
  });

  it("falls back from .KS to .KQ for KOSDAQ tickers and returns bare metadata", async () => {
    activeSdkStub!.quote
      .mockResolvedValueOnce({ symbol: "035900.KS", currency: "USD", exchange: "NYS" })
      .mockResolvedValueOnce({
        symbol: "035900.KQ",
        currency: "KRW",
        exchange: "KOE",
        shortName: "JYP Entertainment",
        quoteType: "EQUITY",
      });

    const provider = await makeProvider();
    const metadata = await provider.fetchInstrumentMetadata("035900");

    expect(activeSdkStub!.quote.mock.calls.map((call) => call[0])).toEqual(["035900.KS", "035900.KQ"]);
    expect(metadata).toMatchObject({
      ticker: "035900",
      name: "JYP Entertainment",
      typeRaw: "KRX",
      industryCategory: "EQUITY",
    });
  });

  it("searchInstruments filters to KR Yahoo suffixes and strips .KS/.KQ", async () => {
    activeSdkStub!.search.mockResolvedValueOnce({
      quotes: [
        { symbol: "005930.KS", exchange: "KSC", longname: "Samsung Electronics", quoteType: "EQUITY" },
        { symbol: "035900.KQ", exchange: "KOE", shortname: "JYP Entertainment", quoteType: "EQUITY" },
        { symbol: "SSNLF", exchange: "PNK", shortname: "Samsung OTC", quoteType: "EQUITY" },
      ],
    });

    const provider = await makeProvider();
    const results = await provider.searchInstruments("samsung");

    expect(results.map((row) => row.ticker)).toEqual(["005930", "035900"]);
    expect(results.every((row) => row.typeRaw === "KRX")).toBe(true);
  });

  it("supports chart_probe_v1 resolver mode by probing chart before quote", async () => {
    activeSdkStub!.chart.mockResolvedValueOnce({
      quotes: [
        {
          date: new Date("2024-01-03T06:30:00Z"),
          open: 74000,
          high: 75000,
          low: 73000,
          close: 74500,
          volume: 98765,
        },
      ],
      events: { dividends: [] },
    });
    activeSdkStub!.chart.mockResolvedValueOnce({
      quotes: [
        {
          date: new Date("2024-01-03T06:30:00Z"),
          open: 74000,
          high: 75000,
          low: 73000,
          close: 74500,
          volume: 98765,
        },
      ],
      events: { dividends: [] },
    });

    const provider = await makeProvider();
    const bars = await provider.fetchBars("005930", "2024-01-01", "2024-01-04", {
      resolverMode: "chart_probe_v1",
    });

    expect(activeSdkStub!.chart).toHaveBeenNthCalledWith(
      1,
      "005930.KS",
      expect.objectContaining({ interval: "1d", period1: "2000-01-04" }),
      { validateResult: false },
    );
    expect(activeSdkStub!.chart).toHaveBeenNthCalledWith(
      2,
      "005930.KS",
      expect.objectContaining({
        interval: "1d",
        period1: "2024-01-01",
        period2: "2024-01-04",
      }),
      { validateResult: false },
    );
    expect(activeSdkStub!.chart).toHaveBeenCalledWith(
      "005930.KS",
      expect.objectContaining({ interval: "1d", period1: "2024-01-01", period2: "2024-01-04" }),
      { validateResult: false },
    );
    expect(activeSdkStub!.quote).not.toHaveBeenCalled();
    expect(bars).toHaveLength(1);
    expect(bars[0]).toMatchObject({ ticker: "005930", close: 74500, sourceId: "yahoo-finance-kr" });
  });

  it("falls back across KR suffixes in chart_probe_v1 mode when first candidate lacks chart data", async () => {
    activeSdkStub!.chart.mockResolvedValueOnce({ quotes: [], events: { dividends: [] } });
    activeSdkStub!.chart.mockResolvedValueOnce({
      quotes: [
        {
          date: new Date("2024-01-03T06:30:00Z"),
          open: 5000,
          high: 5100,
          low: 4900,
          close: 5050,
          volume: 12345,
        },
      ],
      events: { dividends: [] },
    });
    activeSdkStub!.chart.mockResolvedValueOnce({
      quotes: [
        {
          date: new Date("2024-01-03T06:30:00Z"),
          open: 5000,
          high: 5100,
          low: 4900,
          close: 5050,
          volume: 12345,
        },
      ],
      events: { dividends: [] },
    });

    const provider = await makeProvider();
    const bars = await provider.fetchBars("035900", "2024-01-01", "2024-01-04", {
      resolverMode: "chart_probe_v1",
    });

    expect(activeSdkStub!.chart.mock.calls.map((call) => call[0])).toEqual([
      "035900.KS",
      "035900.KQ",
      "035900.KQ",
    ]);
    expect(activeSdkStub!.quote).not.toHaveBeenCalled();
    expect(bars).toHaveLength(1);
    expect(bars[0]).toMatchObject({ ticker: "035900", close: 5050, sourceId: "yahoo-finance-kr" });
  });

  it("reserveCapacity uses unresolved-symbol worst-case slots", async () => {
    const provider = await makeProvider(2);
    expect(() => provider.reserveCapacity(1)).toThrow(RateLimitedError);
  });
});
