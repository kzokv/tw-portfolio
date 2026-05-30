import type {
  RawInstrumentInfo,
  RawDelistingRecord,
  InstrumentCatalogProvider,
} from "../types.js";
import { RateLimitedError } from "../types.js";
import type { RateLimiter } from "../rateLimiter.js";
import { getEffectiveTwelveDataApiKey } from "../../appConfig/providerKeys.js";

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

export interface TwelveDataKrCatalogProviderConfig {
  apiKey: string;
  baseUrl: string;
  rateLimiter: RateLimiter;
  yahooFallback: InstrumentCatalogProvider;
}

const INCLUDED_KR_STOCK_TYPES = new Set(["Common Stock", "Preferred Stock", "REIT"]);

export class TwelveDataKrCatalogProvider implements InstrumentCatalogProvider {
  readonly providerId = "twelve-data-kr";
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

  constructor(config: TwelveDataKrCatalogProviderConfig) {
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
      exchange: "KRX",
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

  async fetchInstrumentCatalog(): Promise<RawInstrumentInfo[]> {
    this.reserveCapacity(2);
    const today = new Date().toISOString().slice(0, 10);

    this.assertCanConsume();
    const stocksRaw = await this.fetchListEndpoint<TwelveDataStockRow>("stocks");
    for (const row of stocksRaw) {
      if (row.mic_code !== "XKRX") {
        throw new Error(
          `twelve_data_kr_mic_mismatch: /stocks row ${row.symbol} has mic_code='${row.mic_code}', expected 'XKRX'`,
        );
      }
    }

    this.assertCanConsume();
    const etfsRaw = await this.fetchListEndpoint<TwelveDataEtfRow>("etf");

    const out: RawInstrumentInfo[] = [];
    const etfTickers = new Set<string>();
    for (const row of etfsRaw) {
      if (row.mic_code !== "XKRX") {
        throw new Error(
          `twelve_data_kr_mic_mismatch: /etf row ${row.symbol} has mic_code='${row.mic_code}', expected 'XKRX'`,
        );
      }
      const ticker = row.symbol.trim().toUpperCase();
      etfTickers.add(ticker);
      out.push({
        ticker,
        name: row.name,
        typeRaw: "KRX",
        industryCategory: "ETF",
        date: today,
      });
    }

    for (const row of stocksRaw) {
      if (!INCLUDED_KR_STOCK_TYPES.has(row.type)) continue;
      const ticker = row.symbol.trim().toUpperCase();
      if (etfTickers.has(ticker)) continue;
      out.push({
        ticker,
        name: row.name,
        typeRaw: "KRX",
        industryCategory: row.type,
        date: today,
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
