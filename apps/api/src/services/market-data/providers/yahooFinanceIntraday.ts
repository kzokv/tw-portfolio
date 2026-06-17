import YahooFinance from "yahoo-finance2";
import type { IntradayPriceOverlay, IntradaySourceKind } from "@vakwen/domain";
import { currencyFor } from "@vakwen/shared-types";
import { yahooSuffixHintFromKrCatalogEvidence } from "./twelveDataKr.js";
import type { InstrumentRow } from "../../../persistence/types.js";
import { marketLocalDateFromTimestamp, type RegularSessionMarketCode } from "../marketRegularSession.js";

export type YahooIntradayRange = "1d" | "5d";
export type YahooIntradayInterval = "1m" | "2m" | "5m" | "15m" | "30m" | "60m";

interface YahooChartQuote {
  date: Date | null;
  close: number | null;
}

interface YahooChartMeta {
  currency?: string;
  previousClose?: number | null;
  chartPreviousClose?: number | null;
}

interface YahooChartResult {
  quotes: YahooChartQuote[];
  meta?: YahooChartMeta;
}

interface KrResolutionPersistence {
  getProviderResolutionMapping(
    providerId: string,
    marketCode: "KR",
    sourceSymbol: string,
  ): Promise<{ resolvedSymbol: string } | null>;
  getInstrument(
    ticker: string,
    marketCode?: string,
  ): Promise<Pick<InstrumentRow, "catalogExchangeRaw" | "catalogMicCode" | "typeRaw"> | null>;
}

export interface YahooFinanceIntradayProviderConfig {
  range: YahooIntradayRange;
  interval: YahooIntradayInterval;
  persistence?: KrResolutionPersistence;
}

export interface YahooIntradayFetchInput {
  ticker: string;
  marketCode: RegularSessionMarketCode;
  now?: Date;
}

const SOURCE = "yahoo-finance-chart";
const SOURCE_KIND: IntradaySourceKind = "intraday_yahoo_chart";

const KR_SUFFIXES = [".KS", ".KQ"] as const;

function hasKrSuffix(symbol: string): boolean {
  const normalized = symbol.trim().toUpperCase();
  return KR_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}

function stripKrSuffix(symbol: string): string {
  const normalized = symbol.trim().toUpperCase();
  for (const suffix of KR_SUFFIXES) {
    if (normalized.endsWith(suffix)) return normalized.slice(0, -suffix.length);
  }
  return normalized;
}

export class YahooFinanceIntradayProvider {
  readonly providerId = SOURCE;
  private readonly client: InstanceType<typeof YahooFinance>;
  private readonly range: YahooIntradayRange;
  private readonly interval: YahooIntradayInterval;
  private readonly persistence?: KrResolutionPersistence;

  constructor(config: YahooFinanceIntradayProviderConfig) {
    this.client = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
    this.range = config.range;
    this.interval = config.interval;
    this.persistence = config.persistence;
  }

  async fetchLatestOverlay(input: YahooIntradayFetchInput): Promise<IntradayPriceOverlay | null> {
    const now = input.now ?? new Date();
    const symbol = await this.resolveSymbol(input.ticker, input.marketCode);
    const chart = this.client.chart.bind(this.client) as unknown as (
      symbol: string,
      queryOptions: Record<string, unknown>,
      moduleOptions?: { validateResult?: boolean },
    ) => Promise<unknown>;
    const result = await chart(
      symbol,
      {
        range: this.range,
        interval: this.interval,
        includePrePost: false,
      },
      { validateResult: false },
    ) as YahooChartResult;

    const latest = selectLatestSameMarketDateClose(result.quotes, input.marketCode, now);
    if (!latest) return null;

    return {
      ticker: input.ticker,
      marketCode: input.marketCode,
      price: latest.close,
      previousClose: normalizePreviousClose(result.meta),
      asOfDate: marketLocalDateFromTimestamp(input.marketCode, latest.date),
      asOfTimestamp: latest.date.toISOString(),
      observedAt: now.toISOString(),
      sourceKind: SOURCE_KIND,
      source: SOURCE,
      currency: result.meta?.currency?.trim().toUpperCase() || currencyFor(input.marketCode),
    };
  }

  private async resolveSymbol(ticker: string, marketCode: RegularSessionMarketCode): Promise<string> {
    const normalized = ticker.trim().toUpperCase();
    if (marketCode === "TW") return `${normalized}.TW`;
    if (marketCode === "US") return normalized;
    if (marketCode === "AU") return `${normalized}.AX`;
    return this.resolveKrSymbol(normalized);
  }

  private async resolveKrSymbol(ticker: string): Promise<string> {
    if (hasKrSuffix(ticker)) return ticker;
    const bare = stripKrSuffix(ticker);
    const mapped = await this.persistence?.getProviderResolutionMapping("yahoo-finance-kr", "KR", bare);
    if (mapped?.resolvedSymbol) return mapped.resolvedSymbol.trim().toUpperCase();
    const instrument = await this.persistence?.getInstrument(bare, "KR");
    const hintedSuffix = yahooSuffixHintFromKrCatalogEvidence(
      instrument?.catalogExchangeRaw ?? instrument?.typeRaw ?? null,
      instrument?.catalogMicCode ?? null,
    );
    return `${bare}${hintedSuffix ?? ".KS"}`;
  }
}

export function selectLatestSameMarketDateClose(
  quotes: ReadonlyArray<YahooChartQuote>,
  marketCode: RegularSessionMarketCode,
  now: Date,
): { close: number; date: Date } | null {
  const targetDate = marketLocalDateFromTimestamp(marketCode, now);
  for (let index = quotes.length - 1; index >= 0; index -= 1) {
    const quote = quotes[index];
    if (!quote?.date || quote.close === null) continue;
    if (marketLocalDateFromTimestamp(marketCode, quote.date) !== targetDate) continue;
    return { close: quote.close, date: quote.date };
  }
  return null;
}

function normalizePreviousClose(meta: YahooChartMeta | undefined): number | null {
  const value = meta?.previousClose ?? meta?.chartPreviousClose ?? null;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
