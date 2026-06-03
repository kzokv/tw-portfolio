import type {
  RawDailyBar,
  DividendRecord,
  RawInstrumentInfo,
  RawDelistingRecord,
  MarketDataProvider,
  InstrumentCatalogProvider,
  MarketDataFetchOptions,
} from "../types.js";

interface MockKrTickerSpec {
  ticker: string;
  yahooSymbol: string;
  name: string;
  basePrice: number;
  industryCategory: "EQUITY" | "ETF";
}

const MOCK_KR_TICKERS: MockKrTickerSpec[] = [
  { ticker: "005930", yahooSymbol: "005930.KS", name: "Samsung Electronics Co., Ltd.", basePrice: 72_000, industryCategory: "EQUITY" },
  { ticker: "005935", yahooSymbol: "005935.KS", name: "Samsung Electronics Co., Ltd. Preferred", basePrice: 59_000, industryCategory: "EQUITY" },
  { ticker: "035900", yahooSymbol: "035900.KQ", name: "JYP Entertainment Corporation", basePrice: 80_000, industryCategory: "EQUITY" },
  { ticker: "069500", yahooSymbol: "069500.KS", name: "KODEX 200 ETF", basePrice: 38_000, industryCategory: "ETF" },
  { ticker: "088260", yahooSymbol: "088260.KS", name: "ESR Kendall Square REIT", basePrice: 4_200, industryCategory: "EQUITY" },
];

const DEFAULT_FIXTURE_START = "2024-01-02";

function stripKrSuffix(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (normalized.endsWith(".KS") || normalized.endsWith(".KQ")) return normalized.slice(0, -3);
  return normalized;
}

function generateMockKrBars(spec: MockKrTickerSpec, startDate: string, count = 30): RawDailyBar[] {
  const bars: RawDailyBar[] = [];
  const start = new Date(`${startDate}T00:00:00Z`);
  let calendarOffset = 0;
  for (let tradingDay = 0; tradingDay < count; calendarOffset++) {
    const date = new Date(start);
    date.setUTCDate(date.getUTCDate() + calendarOffset);
    const day = date.getUTCDay();
    if (day === 0 || day === 6) continue;
    const i = tradingDay;
    const price = spec.basePrice + i * 100;
    bars.push({
      ticker: spec.ticker,
      barDate: date.toISOString().slice(0, 10),
      open: price,
      high: price + 500,
      low: price - 400,
      close: price + 200,
      volume: 1_000_000 + i * 25_000,
      sourceId: "yahoo-finance-kr",
    });
    tradingDay++;
  }
  return bars;
}

const FIXTURE_DIVIDENDS_BY_TICKER: Record<string, ReadonlyArray<{ exDate: string; amount: number }>> = {
  "005930": [
    { exDate: "2024-03-28", amount: 361 },
    { exDate: "2024-06-27", amount: 361 },
    { exDate: "2024-09-27", amount: 361 },
    { exDate: "2024-12-27", amount: 361 },
  ],
  "069500": [
    { exDate: "2024-04-29", amount: 70 },
    { exDate: "2024-07-30", amount: 75 },
  ],
};

export class MockYahooFinanceKrMarketDataProvider implements MarketDataProvider, InstrumentCatalogProvider {
  readonly providerId = "yahoo-finance-kr";
  readonly supportsMetadataEnrichment = true;
  readonly supportsDelistingFeed = false;
  readonly absenceDetectionEnabled = false;
  readonly calls: Array<{
    method: string;
    ticker?: string;
    query?: string;
    startDate?: string;
    endDate?: string;
    n?: number;
  }> = [];

  private readonly fixtureStartDate: string;
  private _nextSearchError: Error | null = null;

  constructor(opts?: { fixtureStartDate?: string }) {
    this.fixtureStartDate = opts?.fixtureStartDate ?? DEFAULT_FIXTURE_START;
  }

  _setNextSearchError(err: Error | null): void {
    this._nextSearchError = err;
  }

  reserveCapacity(n: number): void {
    this.calls.push({ method: "reserveCapacity", n });
  }

  async fetchBars(
    ticker: string,
    startDate?: string,
    endDate?: string,
    _options?: MarketDataFetchOptions,
  ): Promise<RawDailyBar[]> {
    const bareTicker = stripKrSuffix(ticker);
    this.calls.push({
      method: "fetchBars",
      ticker: bareTicker,
      ...(startDate ? { startDate } : {}),
      ...(endDate ? { endDate } : {}),
    });
    const spec = MOCK_KR_TICKERS.find((t) => t.ticker === bareTicker);
    return spec ? generateMockKrBars(spec, this.fixtureStartDate) : [];
  }

  async fetchDividends(
    ticker: string,
    startDate?: string,
    endDate?: string,
    _options?: MarketDataFetchOptions,
  ): Promise<DividendRecord[]> {
    const bareTicker = stripKrSuffix(ticker);
    this.calls.push({
      method: "fetchDividends",
      ticker: bareTicker,
      ...(startDate ? { startDate } : {}),
      ...(endDate ? { endDate } : {}),
    });
    return (FIXTURE_DIVIDENDS_BY_TICKER[bareTicker] ?? []).map((d) => ({
      ticker: bareTicker,
      exDividendDate: d.exDate,
      paymentDate: d.exDate,
      cashDividendPerShare: d.amount,
      stockDividendPerShare: 0,
      sourceId: "yahoo-finance-kr",
    }));
  }

  async fetchInstrumentCatalog(): Promise<RawInstrumentInfo[]> {
    this.calls.push({ method: "fetchInstrumentCatalog" });
    return [];
  }

  async fetchDelistingHistory(): Promise<RawDelistingRecord[]> {
    this.calls.push({ method: "fetchDelistingHistory" });
    return [];
  }

  async fetchInstrumentMetadata(ticker: string): Promise<RawInstrumentInfo | null> {
    const bareTicker = stripKrSuffix(ticker);
    this.calls.push({ method: "fetchInstrumentMetadata", ticker: bareTicker });
    const spec = MOCK_KR_TICKERS.find((t) => t.ticker === bareTicker);
    if (!spec) return null;
    return {
      ticker: spec.ticker,
      name: spec.name,
      typeRaw: "KRX",
      industryCategory: spec.industryCategory,
      date: "2026-05-30",
    };
  }

  async searchInstruments(query: string): Promise<RawInstrumentInfo[]> {
    this.calls.push({ method: "searchInstruments", query });
    if (this._nextSearchError) {
      const err = this._nextSearchError;
      this._nextSearchError = null;
      throw err;
    }
    const q = query.trim().toUpperCase();
    if (q.length === 0) return [];
    return MOCK_KR_TICKERS
      .filter((t) => t.ticker.includes(q) || t.yahooSymbol.includes(q) || t.name.toUpperCase().includes(q))
      .slice(0, 7)
      .map((spec) => ({
        ticker: spec.ticker,
        name: spec.name,
        typeRaw: "KRX",
        industryCategory: spec.industryCategory,
        date: "2026-05-30",
      }));
  }
}
