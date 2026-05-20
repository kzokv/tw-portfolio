import YahooFinance from "yahoo-finance2";
import type { MarketCode } from "@vakwen/domain";
import type { TickerFundamentalsDto, TickerFundamentalsFieldDto } from "@vakwen/shared-types";
import { RateLimiter } from "../market-data/rateLimiter.js";
import { RateLimitedError } from "../market-data/types.js";
import { createEmptyTickerFundamentals, type FundamentalsProvider } from "./types.js";

type YahooFundamentalsProviderMarket = "TW" | "US" | "AU";

const QUERY_MODULES = [
  "price",
  "summaryDetail",
  "defaultKeyStatistics",
  "financialData",
] as const;

interface YahooFundamentalsProviderConfig {
  marketCode: YahooFundamentalsProviderMarket;
  rateLimiter?: RateLimiter;
}

export class YahooFundamentalsProvider implements FundamentalsProvider {
  readonly providerId: string;
  private readonly client: InstanceType<typeof YahooFinance>;
  private readonly marketCode: YahooFundamentalsProviderMarket;
  private readonly rateLimiter: RateLimiter;

  constructor(config: YahooFundamentalsProviderConfig) {
    this.marketCode = config.marketCode;
    this.providerId = `yahoo-finance-fundamentals-${config.marketCode.toLowerCase()}`;
    this.rateLimiter = config.rateLimiter ?? new RateLimiter(60, 60_000);
    this.client = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
  }

  async fetchFundamentals(input: { ticker: string; marketCode: MarketCode }): Promise<TickerFundamentalsDto> {
    if (input.marketCode !== this.marketCode) {
      return createEmptyTickerFundamentals();
    }
    if (!this.rateLimiter.canConsume(1)) {
      throw new RateLimitedError({ msUntilAvailable: this.rateLimiter.msUntilAvailable(1) });
    }
    this.rateLimiter.consume(1);

    const symbol = normalizeYahooSymbol(input.ticker, this.marketCode);
    const result = await this.client.quoteSummary(symbol, {
      formatted: false,
      modules: [...QUERY_MODULES],
    });
    const asOf = new Date().toISOString();
    const source = this.providerId;
    const summaryDetail = toRecord(result.summaryDetail);
    const defaultKeyStatistics = toRecord(result.defaultKeyStatistics);
    const financialData = toRecord(result.financialData);
    const price = toRecord(result.price);

    return {
      marketCap: field(firstNumber(price.marketCap, summaryDetail.marketCap), source, asOf),
      enterpriseValue: field(defaultKeyStatistics.enterpriseValue, source, asOf),
      priceEarningsRatio: field(summaryDetail.trailingPE, source, asOf),
      priceBookRatio: field(defaultKeyStatistics.priceToBook, source, asOf),
      dividendYield: field(summaryDetail.dividendYield, source, asOf),
      earningsPerShare: field(defaultKeyStatistics.trailingEps, source, asOf),
      revenueTrailingTwelveMonths: field(financialData.totalRevenue, source, asOf),
      netIncomeTrailingTwelveMonths: field(defaultKeyStatistics.netIncomeToCommon, source, asOf),
    };
  }
}

function normalizeYahooSymbol(ticker: string, marketCode: YahooFundamentalsProviderMarket): string {
  const normalized = ticker.trim().toUpperCase();
  if (marketCode === "TW") return normalized.endsWith(".TW") ? normalized : `${normalized}.TW`;
  if (marketCode === "AU") return normalized.endsWith(".AX") ? normalized : `${normalized}.AX`;
  return normalized;
}

function field(
  value: unknown,
  source: string,
  asOf: string,
): TickerFundamentalsFieldDto<number> {
  const numericValue = typeof value === "number" && Number.isFinite(value) ? value : null;
  return {
    value: numericValue,
    source: numericValue === null ? null : source,
    asOf: numericValue === null ? null : asOf,
  };
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

function toRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
