import type {
  RawInstrumentInfo,
  RawDelistingRecord,
  InstrumentCatalogProvider,
} from "../types.js";
import { getEffectiveJpCatalogInclusionConfig } from "../../appConfig/jpCatalog.js";
import type { JpCatalogStockType } from "@vakwen/shared-types";

interface MockFixtureRow {
  symbol: string;
  name: string;
  type: string;
  endpoint: "stocks" | "etf";
  currency: string;
  exchange: string;
  micCode: string;
}

const MOCK_TD_JP_FIXTURE: ReadonlyArray<MockFixtureRow> = [
  { symbol: "7203", name: "Toyota Motor Corporation", type: "Common Stock", endpoint: "stocks", currency: "JPY", exchange: "JPX", micCode: "XJPX" },
  { symbol: "9432", name: "Nippon Telegraph and Telephone Corporation", type: "Common Stock", endpoint: "stocks", currency: "JPY", exchange: "JPX", micCode: "XJPX" },
  { symbol: "8951", name: "Nippon Building Fund Inc.", type: "REIT", endpoint: "stocks", currency: "JPY", exchange: "JPX", micCode: "XJPX" },
  { symbol: "1306", name: "NEXT FUNDS TOPIX Exchange Traded Fund", type: "ETF", endpoint: "etf", currency: "JPY", exchange: "JPX", micCode: "XJPX" },
  { symbol: "130A", name: "VERITAS In Silico Inc.", type: "Common Stock", endpoint: "stocks", currency: "JPY", exchange: "JPX", micCode: "XJPX" },
  { symbol: "133A", name: "Global X US Tech Top 20 ETF", type: "ETF", endpoint: "etf", currency: "JPY", exchange: "JPX", micCode: "XJPX" },
  { symbol: "7203@JP", name: "Toyota unsupported @ sample", type: "Common Stock", endpoint: "stocks", currency: "JPY", exchange: "JPX", micCode: "XJPX" },
  { symbol: "8306ADR", name: "Mitsubishi UFJ Depositary Receipt", type: "Depositary Receipt", endpoint: "stocks", currency: "JPY", exchange: "JPX", micCode: "XJPX" },
  { symbol: "9999", name: "Unsupported Tokyo Warrant", type: "Warrant", endpoint: "stocks", currency: "JPY", exchange: "JPX", micCode: "XJPX" },
  { symbol: "USJP", name: "Wrong currency sample", type: "Common Stock", endpoint: "stocks", currency: "USD", exchange: "JPX", micCode: "XJPX" },
  { symbol: "OSKA", name: "Wrong MIC sample", type: "Common Stock", endpoint: "stocks", currency: "JPY", exchange: "OSE", micCode: "XOSE" },
];

const JP_SYMBOL_RE = /^[0-9A-Z]+$/;
const JP_RELAXED_AT_SYMBOL_RE = /^[0-9A-Z@]+$/;

function normalizeJpSymbol(value: string): string {
  return value.trim().toUpperCase();
}

function hasSupportedJpSymbol(value: string, includeAtSymbols: boolean): boolean {
  const symbol = normalizeJpSymbol(value);
  return includeAtSymbols ? JP_RELAXED_AT_SYMBOL_RE.test(symbol) : JP_SYMBOL_RE.test(symbol);
}

function isJpxJpyRow(row: MockFixtureRow): boolean {
  return row.currency === "JPY"
    && row.exchange === "JPX"
    && row.micCode === "XJPX";
}

function isIncludedStockRow(row: MockFixtureRow): boolean {
  if (!isJpxJpyRow(row)) return false;
  const symbol = normalizeJpSymbol(row.symbol);
  const config = getEffectiveJpCatalogInclusionConfig();
  if (!hasSupportedJpSymbol(symbol, config.includeAtSymbols)) return false;
  if (!config.includeAtSymbols && symbol.includes("@")) return false;
  if (row.type === "Depositary Receipt" && !config.includeDepositaryReceipts) return false;
  return config.allowedStockTypes.has(row.type as JpCatalogStockType);
}

function isIncludedEtfRow(row: MockFixtureRow): boolean {
  if (!isJpxJpyRow(row)) return false;
  const symbol = normalizeJpSymbol(row.symbol);
  const config = getEffectiveJpCatalogInclusionConfig();
  if (!hasSupportedJpSymbol(symbol, config.includeAtSymbols)) return false;
  return config.includeAtSymbols || !symbol.includes("@");
}

export const MOCK_TD_JP_CATALOG_TICKERS: ReadonlyArray<string> = MOCK_TD_JP_FIXTURE
  .filter((row) => row.endpoint === "etf" ? isIncludedEtfRow(row) : isIncludedStockRow(row))
  .map((row) => normalizeJpSymbol(row.symbol));

export interface MockTwelveDataJpCatalogProviderConfig {
  yahooFallback: InstrumentCatalogProvider;
}

export class MockTwelveDataJpCatalogProvider implements InstrumentCatalogProvider {
  readonly providerId = "twelve-data-jp";
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

  constructor(config: MockTwelveDataJpCatalogProviderConfig) {
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

    for (const row of MOCK_TD_JP_FIXTURE) {
      if (row.endpoint !== "etf" || !isIncludedEtfRow(row)) continue;
      const ticker = normalizeJpSymbol(row.symbol);
      etfTickers.add(ticker);
      out.push({
        ticker,
        name: row.name,
        typeRaw: "JPX",
        industryCategory: "ETF",
        date: today,
        catalogExchangeRaw: row.exchange,
        catalogMicCode: row.micCode,
      });
    }

    for (const row of MOCK_TD_JP_FIXTURE) {
      if (row.endpoint !== "stocks" || !isIncludedStockRow(row)) continue;
      const ticker = normalizeJpSymbol(row.symbol);
      if (etfTickers.has(ticker)) continue;
      out.push({
        ticker,
        name: row.name,
        typeRaw: "JPX",
        industryCategory: row.type,
        date: today,
        catalogExchangeRaw: row.exchange,
        catalogMicCode: row.micCode,
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
