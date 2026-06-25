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

export type YahooIntradayRejectionReason =
  | "provider_no_data"
  | "no_quotes_returned"
  | "no_valid_close_quotes"
  | "no_same_day_valid_close";

export interface YahooIntradayDiagnosticQuote {
  timestamp: string;
  value: number;
}

export interface YahooIntradayDiagnostic {
  ticker: string;
  marketCode: RegularSessionMarketCode;
  resolvedProviderSymbol: string;
  chartOptions: {
    period1: string;
    period2: string;
    interval: YahooIntradayInterval;
    includePrePost: false;
  };
  quoteCounts: {
    total: number;
    timestamped: number;
    nonNullClose: number;
    validClose: number;
    sameDayValidClose: number;
  };
  firstValidClose: YahooIntradayDiagnosticQuote | null;
  lastValidClose: YahooIntradayDiagnosticQuote | null;
  metaCurrency: string | null;
  metaPreviousClose: number | null;
  rejectionReason: YahooIntradayRejectionReason;
}

export interface YahooIntradayFetchResult {
  overlay: IntradayPriceOverlay | null;
  diagnostic?: YahooIntradayDiagnostic;
}

interface YahooIntradayPersistence {
  getProviderResolutionMapping?(
    providerId: string,
    marketCode: "KR",
    sourceSymbol: string,
  ): Promise<{ resolvedSymbol: string } | null>;
  getInstrument?(
    ticker: string,
    marketCode?: string,
  ): Promise<Pick<InstrumentRow, "catalogExchangeRaw" | "catalogMicCode" | "typeRaw"> | null>;
}

export interface YahooFinanceIntradayProviderConfig {
  range: YahooIntradayRange;
  interval: YahooIntradayInterval;
  persistence?: YahooIntradayPersistence;
}

export interface YahooIntradayFetchInput {
  ticker: string;
  marketCode: RegularSessionMarketCode;
  now?: Date;
}

interface YahooChartOptions extends Record<string, unknown> {
  period1: Date;
  period2: Date;
  interval: YahooIntradayInterval;
  includePrePost: false;
}

const SOURCE = "yahoo-finance-chart";
const SOURCE_KIND: IntradaySourceKind = "yahoo_chart";

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
  private readonly persistence?: YahooIntradayPersistence;

  constructor(config: YahooFinanceIntradayProviderConfig) {
    this.client = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
    this.range = config.range;
    this.interval = config.interval;
    this.persistence = config.persistence;
  }

  async fetchLatestOverlay(input: YahooIntradayFetchInput): Promise<IntradayPriceOverlay | null> {
    return (await this.fetchLatestOverlayResult(input)).overlay;
  }

  async fetchLatestOverlayResult(input: YahooIntradayFetchInput): Promise<YahooIntradayFetchResult> {
    const now = input.now ?? new Date();
    const symbol = await this.resolveSymbol(input.ticker, input.marketCode);
    const chartOptions = buildYahooChartOptions(this.range, this.interval, now);
    const chart = this.client.chart.bind(this.client) as unknown as (
      symbol: string,
      queryOptions: Record<string, unknown>,
      moduleOptions?: { validateResult?: boolean },
    ) => Promise<unknown>;
    let result: YahooChartResult;
    try {
      result = await chart(
        symbol,
        chartOptions,
        { validateResult: false },
      ) as YahooChartResult;
    } catch (error) {
      if (isYahooNoDataError(error)) {
        return {
          overlay: null,
          diagnostic: buildYahooIntradayDiagnostic({
            ticker: input.ticker,
            marketCode: input.marketCode,
            providerSymbol: symbol,
            chartOptions,
            quotes: [],
            meta: undefined,
            now,
            rejectionReason: "provider_no_data",
          }),
        };
      }
      throw error;
    }

    const latest = selectLatestSameMarketDateClose(result.quotes, input.marketCode, now);
    if (!latest) {
      return {
        overlay: null,
        diagnostic: buildYahooIntradayDiagnostic({
          ticker: input.ticker,
          marketCode: input.marketCode,
          providerSymbol: symbol,
          chartOptions,
          quotes: result.quotes,
          meta: result.meta,
          now,
          rejectionReason: inferYahooIntradayRejectionReason(result.quotes, input.marketCode, now),
        }),
      };
    }

    return {
      overlay: {
        ticker: input.ticker,
        marketCode: input.marketCode,
        price: latest.close,
        previousClose: normalizePreviousClose(result.meta),
        asOfDate: marketLocalDateFromTimestamp(input.marketCode, latest.date),
        asOfTimestamp: latest.date.toISOString(),
        observedAt: now.toISOString(),
        sourceKind: SOURCE_KIND,
        source: SOURCE,
        providerSymbol: symbol,
        currency: result.meta?.currency?.trim().toUpperCase() || currencyFor(input.marketCode),
      },
    };
  }

  private async resolveSymbol(ticker: string, marketCode: RegularSessionMarketCode): Promise<string> {
    const normalized = ticker.trim().toUpperCase();
    if (marketCode === "TW") return this.resolveTwSymbol(normalized);
    if (marketCode === "US") return normalized;
    if (marketCode === "AU") return `${normalized}.AX`;
    if (marketCode === "JP") return normalized.endsWith(".T") ? normalized : `${normalized}.T`;
    return this.resolveKrSymbol(normalized);
  }

  private async resolveTwSymbol(ticker: string): Promise<string> {
    if (ticker.endsWith(".TW") || ticker.endsWith(".TWO")) return ticker;
    const instrument = await this.persistence?.getInstrument?.(ticker, "TW");
    return `${ticker}${isTpexInstrument(instrument) ? ".TWO" : ".TW"}`;
  }

  private async resolveKrSymbol(ticker: string): Promise<string> {
    if (hasKrSuffix(ticker)) return ticker;
    const bare = stripKrSuffix(ticker);
    const mapped = await this.persistence?.getProviderResolutionMapping?.("yahoo-finance-kr", "KR", bare);
    if (mapped?.resolvedSymbol) return mapped.resolvedSymbol.trim().toUpperCase();
    const instrument = await this.persistence?.getInstrument?.(bare, "KR");
    const hintedSuffix = yahooSuffixHintFromKrCatalogEvidence(
      instrument?.catalogExchangeRaw ?? instrument?.typeRaw ?? null,
      instrument?.catalogMicCode ?? null,
    );
    return `${bare}${hintedSuffix ?? ".KS"}`;
  }
}

function isTpexInstrument(
  instrument: Pick<InstrumentRow, "catalogExchangeRaw" | "catalogMicCode" | "typeRaw"> | null | undefined,
): boolean {
  const evidence = [
    instrument?.typeRaw,
    instrument?.catalogExchangeRaw,
    instrument?.catalogMicCode,
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim().toUpperCase());

  return evidence.some((value) =>
    value === "TPEX"
    || value === "ROCO"
    || value === "TWO"
    || value.includes("TAIPEI EXCHANGE")
    || value.includes("TPEX"));
}

function isYahooNoDataError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes("no data found");
}

export function selectLatestSameMarketDateClose(
  quotes: ReadonlyArray<YahooChartQuote>,
  marketCode: RegularSessionMarketCode,
  now: Date,
): { close: number; date: Date } | null {
  const targetDate = marketLocalDateFromTimestamp(marketCode, now);
  for (let index = quotes.length - 1; index >= 0; index -= 1) {
    const quote = quotes[index];
    if (!quote?.date || typeof quote.close !== "number" || !Number.isFinite(quote.close)) continue;
    if (marketLocalDateFromTimestamp(marketCode, quote.date) !== targetDate) continue;
    return { close: quote.close, date: quote.date };
  }
  return null;
}

function normalizePreviousClose(meta: YahooChartMeta | undefined): number | null {
  const value = meta?.previousClose ?? meta?.chartPreviousClose ?? null;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function inferYahooIntradayRejectionReason(
  quotes: ReadonlyArray<YahooChartQuote>,
  marketCode: RegularSessionMarketCode,
  now: Date,
): YahooIntradayRejectionReason {
  if (quotes.length === 0) return "no_quotes_returned";
  const validCloses = quotes.filter((quote): quote is { date: Date; close: number } =>
    quote?.date instanceof Date
    && typeof quote.close === "number"
    && Number.isFinite(quote.close),
  );
  if (validCloses.length === 0) return "no_valid_close_quotes";
  const targetDate = marketLocalDateFromTimestamp(marketCode, now);
  const latest = validCloses[validCloses.length - 1]!;
  return marketLocalDateFromTimestamp(marketCode, latest.date) === targetDate
    ? "no_valid_close_quotes"
    : "no_same_day_valid_close";
}

function buildYahooIntradayDiagnostic(input: {
  ticker: string;
  marketCode: RegularSessionMarketCode;
  providerSymbol: string;
  chartOptions: YahooChartOptions;
  quotes: ReadonlyArray<YahooChartQuote>;
  meta: YahooChartMeta | undefined;
  now: Date;
  rejectionReason: YahooIntradayRejectionReason;
}): YahooIntradayDiagnostic {
  const validCloses = input.quotes.filter((quote): quote is { date: Date; close: number } =>
    quote?.date instanceof Date
    && typeof quote.close === "number"
    && Number.isFinite(quote.close),
  );
  const firstValidClose = validCloses[0] ?? null;
  const lastValidClose = validCloses[validCloses.length - 1] ?? null;
  const targetMarketDate = marketLocalDateFromTimestamp(input.marketCode, input.now);
  return {
    ticker: input.ticker,
    marketCode: input.marketCode,
    resolvedProviderSymbol: input.providerSymbol,
    chartOptions: {
      period1: input.chartOptions.period1.toISOString(),
      period2: input.chartOptions.period2.toISOString(),
      interval: input.chartOptions.interval,
      includePrePost: input.chartOptions.includePrePost,
    },
    quoteCounts: {
      total: input.quotes.length,
      timestamped: input.quotes.filter((quote) => quote?.date instanceof Date).length,
      nonNullClose: input.quotes.filter((quote) => typeof quote?.close === "number" && Number.isFinite(quote.close)).length,
      validClose: validCloses.length,
      sameDayValidClose: validCloses.filter((quote) => marketLocalDateFromTimestamp(input.marketCode, quote.date) === targetMarketDate).length,
    },
    firstValidClose: firstValidClose
      ? { timestamp: firstValidClose.date.toISOString(), value: firstValidClose.close }
      : null,
    lastValidClose: lastValidClose
      ? { timestamp: lastValidClose.date.toISOString(), value: lastValidClose.close }
      : null,
    metaCurrency: input.meta?.currency?.trim().toUpperCase() || null,
    metaPreviousClose: normalizePreviousClose(input.meta),
    rejectionReason: input.rejectionReason,
  };
}

export function buildYahooChartOptions(
  range: YahooIntradayRange,
  interval: YahooIntradayInterval,
  now: Date,
): YahooChartOptions {
  const rangeDays = range === "1d" ? 1 : 5;
  return {
    period1: new Date(now.getTime() - rangeDays * 24 * 60 * 60 * 1000),
    period2: now,
    interval,
    includePrePost: false,
  };
}
