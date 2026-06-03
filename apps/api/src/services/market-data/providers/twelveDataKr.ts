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

interface KoreanExchangeSegment {
  exchange: "KRX" | "KOSDAQ";
  micCode: "XKRX" | "XKOS";
}

export function yahooSuffixHintFromKrCatalogEvidence(
  exchangeRaw: string | null | undefined,
  micCode: string | null | undefined,
): ".KS" | ".KQ" | null {
  const exchange = exchangeRaw?.trim().toUpperCase() ?? "";
  const mic = micCode?.trim().toUpperCase() ?? "";
  if (exchange === "KOSDAQ" || mic === "XKOS") return ".KQ";
  if (exchange === "KRX" || mic === "XKRX") return ".KS";
  return null;
}

export interface TwelveDataKrCatalogProviderConfig {
  apiKey: string;
  baseUrl: string;
  rateLimiter: RateLimiter;
  yahooFallback: InstrumentCatalogProvider;
}

const INCLUDED_KR_STOCK_TYPES = new Set(["Common Stock", "Preferred Stock", "REIT"]);
const KR_EXCHANGE_SEGMENTS: readonly KoreanExchangeSegment[] = [
  { exchange: "KRX", micCode: "XKRX" },
  { exchange: "KOSDAQ", micCode: "XKOS" },
];
const KR_CATALOG_REQUEST_COUNT = KR_EXCHANGE_SEGMENTS.length * 2;

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

  private async fetchListEndpoint<T>(
    path: "stocks" | "etf",
    exchange: KoreanExchangeSegment["exchange"],
  ): Promise<T[]> {
    const params = new URLSearchParams({
      exchange,
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

  private assertMicCode(
    path: "stocks" | "etf",
    row: { symbol: string; mic_code: string },
    expectedMicCode: KoreanExchangeSegment["micCode"],
  ): void {
    if (row.mic_code !== expectedMicCode) {
      throw new Error(
        `twelve_data_kr_mic_mismatch: /${path} row ${row.symbol} has mic_code='${row.mic_code}', expected '${expectedMicCode}'`,
      );
    }
  }

  private async fetchRowsForSegments<T extends { symbol: string; mic_code: string }>(
    path: "stocks" | "etf",
  ): Promise<T[]> {
    const out: T[] = [];
    for (const segment of KR_EXCHANGE_SEGMENTS) {
      this.assertCanConsume();
      const rows = await this.fetchListEndpoint<T>(path, segment.exchange);
      for (const row of rows) {
        this.assertMicCode(path, row, segment.micCode);
      }
      out.push(...rows);
    }
    return out;
  }

  async fetchInstrumentCatalog(): Promise<RawInstrumentInfo[]> {
    this.reserveCapacity(KR_CATALOG_REQUEST_COUNT);
    const today = new Date().toISOString().slice(0, 10);

    const stocksRaw = await this.fetchRowsForSegments<TwelveDataStockRow>("stocks");
    const etfsRaw = await this.fetchRowsForSegments<TwelveDataEtfRow>("etf");

    const out: RawInstrumentInfo[] = [];
    const etfTickers = new Set<string>();
    for (const row of etfsRaw) {
      const ticker = row.symbol.trim().toUpperCase();
      etfTickers.add(ticker);
      out.push({
        ticker,
        name: row.name,
        typeRaw: "KRX",
        industryCategory: "ETF",
        date: today,
        catalogExchangeRaw: row.exchange,
        catalogMicCode: row.mic_code,
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
