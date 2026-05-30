import type {
  RawInstrumentInfo,
  RawDelistingRecord,
  InstrumentCatalogProvider,
} from "../types.js";

interface MockFixtureRow {
  symbol: string;
  name: string;
  type: string;
  endpoint: "stocks" | "etf";
}

const MOCK_TD_KR_FIXTURE: ReadonlyArray<MockFixtureRow> = [
  { symbol: "005930", name: "Samsung Electronics Co., Ltd.", type: "Common Stock", endpoint: "stocks" },
  { symbol: "005935", name: "Samsung Electronics Co., Ltd. Preferred", type: "Preferred Stock", endpoint: "stocks" },
  { symbol: "088260", name: "ESR Kendall Square REIT", type: "REIT", endpoint: "stocks" },
  { symbol: "069500", name: "KODEX 200 ETF", type: "ETF", endpoint: "etf" },
  { symbol: "035900", name: "JYP Entertainment Corporation", type: "Common Stock", endpoint: "stocks" },
  { symbol: "580001", name: "KRX Sample ETN", type: "ETN", endpoint: "stocks" },
  { symbol: "550001", name: "KRX Sample Warrant", type: "Warrant", endpoint: "stocks" },
];

const INCLUDED_KR_STOCK_TYPES = new Set(["Common Stock", "Preferred Stock", "REIT"]);

export const MOCK_TD_KR_CATALOG_TICKERS: ReadonlyArray<string> = MOCK_TD_KR_FIXTURE
  .filter((row) => row.endpoint === "etf" || INCLUDED_KR_STOCK_TYPES.has(row.type))
  .map((row) => row.symbol);

export interface MockTwelveDataKrCatalogProviderConfig {
  yahooFallback: InstrumentCatalogProvider;
}

export class MockTwelveDataKrCatalogProvider implements InstrumentCatalogProvider {
  readonly providerId = "twelve-data-kr";
  readonly supportsMetadataEnrichment = true;
  readonly supportsDelistingFeed = false;
  readonly absenceDetectionEnabled = true;
  readonly calls: Array<{
    method: string;
    ticker?: string;
    query?: string;
    n?: number;
  }> = [];

  private readonly yahooFallback: InstrumentCatalogProvider;
  private _nextSearchError: Error | null = null;

  constructor(config: MockTwelveDataKrCatalogProviderConfig) {
    this.yahooFallback = config.yahooFallback;
  }

  _setNextSearchError(err: Error | null): void {
    this._nextSearchError = err;
  }

  reserveCapacity(n: number): void {
    this.calls.push({ method: "reserveCapacity", n });
  }

  async fetchInstrumentCatalog(): Promise<RawInstrumentInfo[]> {
    this.calls.push({ method: "fetchInstrumentCatalog" });
    const today = new Date().toISOString().slice(0, 10);
    const out: RawInstrumentInfo[] = [];
    const etfTickers = new Set<string>();

    for (const row of MOCK_TD_KR_FIXTURE) {
      if (row.endpoint !== "etf") continue;
      etfTickers.add(row.symbol);
      out.push({
        ticker: row.symbol,
        name: row.name,
        typeRaw: "KRX",
        industryCategory: "ETF",
        date: today,
      });
    }

    for (const row of MOCK_TD_KR_FIXTURE) {
      if (row.endpoint !== "stocks") continue;
      if (!INCLUDED_KR_STOCK_TYPES.has(row.type)) continue;
      if (etfTickers.has(row.symbol)) continue;
      out.push({
        ticker: row.symbol,
        name: row.name,
        typeRaw: "KRX",
        industryCategory: row.type,
        date: today,
      });
    }

    return out;
  }

  async fetchDelistingHistory(): Promise<RawDelistingRecord[]> {
    this.calls.push({ method: "fetchDelistingHistory" });
    return [];
  }

  async fetchInstrumentMetadata(ticker: string): Promise<RawInstrumentInfo | null> {
    this.calls.push({ method: "fetchInstrumentMetadata", ticker });
    return this.yahooFallback.fetchInstrumentMetadata(ticker);
  }

  async searchInstruments(query: string): Promise<RawInstrumentInfo[]> {
    this.calls.push({ method: "searchInstruments", query });
    if (this._nextSearchError) {
      const err = this._nextSearchError;
      this._nextSearchError = null;
      throw err;
    }
    return this.yahooFallback.searchInstruments(query);
  }
}
