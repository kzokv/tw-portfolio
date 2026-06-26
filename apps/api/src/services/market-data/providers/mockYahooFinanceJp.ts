import type {
  RawDailyBar,
  DividendRecord,
  RawInstrumentInfo,
  RawDelistingRecord,
  MarketDataProvider,
  InstrumentCatalogProvider,
  MarketDataFetchOptions,
} from "../types.js";
import { stripYahooJpSuffix, toYahooJpSymbol } from "./yahooFinanceJp.js";

interface MockJpTickerSpec {
  ticker: string;
  name: string;
  basePrice: number;
  industryCategory: "EQUITY" | "ETF";
}

const MOCK_JP_TICKERS: MockJpTickerSpec[] = [
  { ticker: "7203", name: "Toyota Motor Corporation", basePrice: 3_200, industryCategory: "EQUITY" },
  { ticker: "9432", name: "Nippon Telegraph and Telephone Corporation", basePrice: 160, industryCategory: "EQUITY" },
  { ticker: "1306", name: "NEXT FUNDS TOPIX Exchange Traded Fund", basePrice: 3_000, industryCategory: "ETF" },
  { ticker: "130A", name: "VERITAS In Silico Inc.", basePrice: 1_000, industryCategory: "EQUITY" },
  { ticker: "133A", name: "Global X US Tech Top 20 ETF", basePrice: 1_100, industryCategory: "ETF" },
];

const DEFAULT_FIXTURE_START = "2024-01-04";

function generateMockJpBars(spec: MockJpTickerSpec, startDate: string, count = 30): RawDailyBar[] {
  const bars: RawDailyBar[] = [];
  const start = new Date(`${startDate}T00:00:00Z`);
  let calendarOffset = 0;
  for (let tradingDay = 0; tradingDay < count; calendarOffset++) {
    const date = new Date(start);
    date.setUTCDate(date.getUTCDate() + calendarOffset);
    const day = date.getUTCDay();
    if (day === 0 || day === 6) continue;
    const i = tradingDay;
    const price = spec.basePrice + i * 10;
    bars.push({
      ticker: spec.ticker,
      barDate: date.toISOString().slice(0, 10),
      open: price,
      high: price + 50,
      low: price - 40,
      close: price + 20,
      volume: 500_000 + i * 10_000,
      sourceId: "yahoo-finance-jp",
    });
    tradingDay++;
  }
  return bars;
}

const FIXTURE_DIVIDENDS_BY_TICKER: Record<string, ReadonlyArray<{ exDate: string; amount: number }>> = {
  "7203": [
    { exDate: "2024-03-28", amount: 45 },
    { exDate: "2024-09-27", amount: 45 },
  ],
  "1306": [
    { exDate: "2024-07-08", amount: 55 },
  ],
};

export class MockYahooFinanceJpMarketDataProvider implements MarketDataProvider, InstrumentCatalogProvider {
  readonly providerId = "yahoo-finance-jp";
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
    const bareTicker = stripYahooJpSuffix(ticker);
    this.calls.push({
      method: "fetchBars",
      ticker: bareTicker,
      ...(startDate ? { startDate } : {}),
      ...(endDate ? { endDate } : {}),
    });
    const spec = MOCK_JP_TICKERS.find((t) => t.ticker === bareTicker);
    return spec ? generateMockJpBars(spec, this.fixtureStartDate) : [];
  }

  async fetchDividends(
    ticker: string,
    startDate?: string,
    endDate?: string,
    _options?: MarketDataFetchOptions,
  ): Promise<DividendRecord[]> {
    const bareTicker = stripYahooJpSuffix(ticker);
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
      sourceId: "yahoo-finance-jp",
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
    const bareTicker = stripYahooJpSuffix(ticker);
    this.calls.push({ method: "fetchInstrumentMetadata", ticker: bareTicker });
    const spec = MOCK_JP_TICKERS.find((t) => t.ticker === bareTicker);
    if (!spec) return null;
    return {
      ticker: spec.ticker,
      name: spec.name,
      typeRaw: "JPX",
      industryCategory: spec.industryCategory,
      date: "2026-06-25",
    };
  }

  async searchInstruments(query: string): Promise<RawInstrumentInfo[]> {
    this.calls.push({ method: "searchInstruments", query });
    if (this._nextSearchError) {
      const err = this._nextSearchError;
      this._nextSearchError = null;
      throw err;
    }
    const q = stripYahooJpSuffix(query);
    if (q.length === 0) return [];
    return MOCK_JP_TICKERS
      .filter((t) => t.ticker.includes(q) || toYahooJpSymbol(t.ticker).includes(q) || t.name.toUpperCase().includes(q))
      .slice(0, 7)
      .map((spec) => ({
        ticker: spec.ticker,
        name: spec.name,
        typeRaw: "JPX",
        industryCategory: spec.industryCategory,
        date: "2026-06-25",
      }));
  }
}
