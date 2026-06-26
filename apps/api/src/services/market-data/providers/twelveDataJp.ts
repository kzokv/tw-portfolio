import type {
  RawInstrumentInfo,
  RawDelistingRecord,
  InstrumentCatalogProvider,
} from "../types.js";
import { RateLimitedError } from "../types.js";
import type { RateLimiter } from "../rateLimiter.js";
import { getEffectiveTwelveDataApiKey } from "../../appConfig/providerKeys.js";
import { getEffectiveJpCatalogInclusionConfig } from "../../appConfig/jpCatalog.js";
import type { JpCatalogStockType } from "@vakwen/shared-types";

interface TwelveDataStockRow {
  symbol: string;
  name: string;
  currency: string;
  exchange: string;
  mic_code: string;
  country: string;
  type: string;
}

interface TwelveDataEtfRow {
  symbol: string;
  name: string;
  currency: string;
  exchange: string;
  mic_code: string;
  country: string;
}

interface TwelveDataListResponse<T> {
  data: T[];
  status: string;
}

export interface TwelveDataJpCatalogProviderConfig {
  apiKey: string;
  baseUrl: string;
  rateLimiter: RateLimiter;
  yahooFallback: InstrumentCatalogProvider;
}

const JP_SYMBOL_RE = /^[0-9A-Z]+$/;
const JP_RELAXED_AT_SYMBOL_RE = /^[0-9A-Z@]+$/;
const JP_CATALOG_REQUEST_COUNT = 2;

function normalizeJpSymbol(value: string): string {
  return value.trim().toUpperCase();
}

function hasSupportedJpSymbol(value: string, includeAtSymbols: boolean): boolean {
  const symbol = normalizeJpSymbol(value);
  return includeAtSymbols ? JP_RELAXED_AT_SYMBOL_RE.test(symbol) : JP_SYMBOL_RE.test(symbol);
}

function isJpxJpyRow(row: { currency: string; exchange: string; mic_code: string }): boolean {
  return (
    row.currency === "JPY"
    && row.exchange === "JPX"
    && row.mic_code === "XJPX"
  );
}

export class TwelveDataJpCatalogProvider implements InstrumentCatalogProvider {
  readonly providerId = "twelve-data-jp";
  readonly supportsMetadataEnrichment = true;
  readonly supportsDelistingFeed = false;
  readonly absenceDetectionEnabled = true;
  private readonly bootstrapApiKey: string;
  private readonly baseUrl: string;
  private readonly rateLimiter: RateLimiter;
  private readonly yahooFallback: InstrumentCatalogProvider;

  private get apiKey(): string {
    return getEffectiveTwelveDataApiKey() ?? this.bootstrapApiKey;
  }

  constructor(config: TwelveDataJpCatalogProviderConfig) {
    this.bootstrapApiKey = config.apiKey;
    this.baseUrl = config.baseUrl;
    this.rateLimiter = config.rateLimiter;
    this.yahooFallback = config.yahooFallback;
  }

  private assertCanConsume(): void {
    if (!this.rateLimiter.canConsume(1)) {
      throw new RateLimitedError({ msUntilAvailable: this.rateLimiter.msUntilAvailable(1) });
    }
    this.rateLimiter.consume(1);
  }

  reserveCapacity(n: number): void {
    if (!this.rateLimiter.canConsume(n)) {
      throw new RateLimitedError({ msUntilAvailable: this.rateLimiter.msUntilAvailable(n) });
    }
  }

  private async fetchListEndpoint<T>(path: "stocks" | "etf"): Promise<T[]> {
    const params = new URLSearchParams({
      country: "Japan",
      apikey: this.apiKey,
    });
    const res = await fetch(`${this.baseUrl}/${path}?${params.toString()}`);
    if (res.status === 429) {
      throw new RateLimitedError({ msUntilAvailable: 60_000 });
    }
    if (!res.ok) {
      throw new Error(`Twelve Data API error: ${res.status} ${res.statusText}`);
    }
    const body = await res.json() as TwelveDataListResponse<T>;
    if (body.status && body.status !== "ok") {
      throw new Error(`Twelve Data API returned status ${body.status}`);
    }
    return body.data;
  }

  private isIncludedStockRow(row: TwelveDataStockRow): boolean {
    if (!isJpxJpyRow(row)) return false;
    const symbol = normalizeJpSymbol(row.symbol);
    const config = getEffectiveJpCatalogInclusionConfig();
    if (!hasSupportedJpSymbol(symbol, config.includeAtSymbols)) return false;
    if (!config.includeAtSymbols && symbol.includes("@")) return false;
    if (row.type === "Depositary Receipt" && !config.includeDepositaryReceipts) return false;
    return config.allowedStockTypes.has(row.type as JpCatalogStockType);
  }

  private isIncludedEtfRow(row: TwelveDataEtfRow): boolean {
    if (!isJpxJpyRow(row)) return false;
    const symbol = normalizeJpSymbol(row.symbol);
    const config = getEffectiveJpCatalogInclusionConfig();
    if (!hasSupportedJpSymbol(symbol, config.includeAtSymbols)) return false;
    return config.includeAtSymbols || !symbol.includes("@");
  }

  async fetchInstrumentCatalog(): Promise<RawInstrumentInfo[]> {
    this.reserveCapacity(JP_CATALOG_REQUEST_COUNT);
    const today = new Date().toISOString().slice(0, 10);
    this.assertCanConsume();
    const stocksRaw = await this.fetchListEndpoint<TwelveDataStockRow>("stocks");
    this.assertCanConsume();
    const etfsRaw = await this.fetchListEndpoint<TwelveDataEtfRow>("etf");

    const out: RawInstrumentInfo[] = [];
    const etfTickers = new Set<string>();
    for (const row of etfsRaw) {
      if (!this.isIncludedEtfRow(row)) continue;
      const ticker = normalizeJpSymbol(row.symbol);
      etfTickers.add(ticker);
      out.push({
        ticker,
        name: row.name,
        typeRaw: "JPX",
        industryCategory: "ETF",
        date: today,
        catalogExchangeRaw: row.exchange,
        catalogMicCode: row.mic_code,
      });
    }

    for (const row of stocksRaw) {
      if (!this.isIncludedStockRow(row)) continue;
      const ticker = normalizeJpSymbol(row.symbol);
      if (etfTickers.has(ticker)) continue;
      out.push({
        ticker,
        name: row.name,
        typeRaw: "JPX",
        industryCategory: row.type,
        date: today,
        catalogExchangeRaw: row.exchange,
        catalogMicCode: row.mic_code,
      });
    }

    return out;
  }

  async fetchDelistingHistory(): Promise<RawDelistingRecord[]> {
    return [];
  }

  async fetchInstrumentMetadata(ticker: string): Promise<RawInstrumentInfo | null> {
    return this.yahooFallback.fetchInstrumentMetadata(ticker);
  }

  async searchInstruments(query: string): Promise<RawInstrumentInfo[]> {
    return this.yahooFallback.searchInstruments(query);
  }
}
