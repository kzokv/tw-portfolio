import YahooFinance from "yahoo-finance2";
import type {
  RawDailyBar,
  DividendRecord,
  RawInstrumentInfo,
  RawDelistingRecord,
  MarketDataProvider,
  InstrumentCatalogProvider,
  MarketDataFetchOptions,
} from "../types.js";
import { RateLimitedError } from "../types.js";
import type { RateLimiter } from "../rateLimiter.js";
import { MinRequestIntervalPacer } from "../minRequestIntervalPacer.js";

interface YahooChartQuote {
  date: Date | null;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
}
interface YahooChartDividend {
  amount: number;
  date: Date;
}
interface YahooChartResult {
  quotes: YahooChartQuote[];
  events?: { dividends?: YahooChartDividend[] };
}
interface YahooSearchQuote {
  symbol?: string;
  exchange?: string;
  fullExchangeName?: string;
  longname?: string;
  shortname?: string;
  quoteType?: string;
}
interface YahooSearchResult {
  quotes: YahooSearchQuote[];
}
interface YahooQuoteResult {
  symbol?: string;
  longName?: string;
  shortName?: string;
  quoteType?: string;
  exchange?: string;
  fullExchangeName?: string;
  currency?: string;
}

export interface YahooFinanceJpMarketDataProviderConfig {
  rateLimiter: RateLimiter;
  minRequestIntervalMs?: number | (() => number);
}

const TOKYO_TZ_OFFSET_MS = 9 * 60 * 60 * 1000;
const JP_HISTORY_START = "2000-01-04";

export function stripYahooJpSuffix(value: string): string {
  const normalized = value.trim().toUpperCase();
  return normalized.endsWith(".T") ? normalized.slice(0, -2) : normalized;
}

export function toYahooJpSymbol(ticker: string): string {
  return `${stripYahooJpSuffix(ticker)}.T`;
}

function shiftToTokyoDate(date: Date): string {
  const shifted = new Date(date.getTime() + TOKYO_TZ_OFFSET_MS);
  return shifted.toISOString().slice(0, 10);
}

function addDaysIsoDate(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function isJpYahooQuote(symbol: string, quote: YahooQuoteResult): boolean {
  const quotedSymbol = (quote.symbol ?? symbol).toUpperCase();
  const exchange = (quote.exchange ?? "").toUpperCase();
  const fullExchangeName = (quote.fullExchangeName ?? "").toUpperCase();
  const currency = (quote.currency ?? "").toUpperCase();
  return (
    quotedSymbol.endsWith(".T")
    && (
      currency === "JPY"
      || exchange === "JPX"
      || fullExchangeName.includes("TOKYO")
      || fullExchangeName.includes("JAPAN")
    )
  );
}

export class YahooFinanceJpMarketDataProvider implements MarketDataProvider, InstrumentCatalogProvider {
  readonly providerId = "yahoo-finance-jp";
  readonly supportsMetadataEnrichment = true;
  readonly supportsDelistingFeed = false;
  readonly absenceDetectionEnabled = false;
  private readonly rateLimiter: RateLimiter;
  private readonly client: InstanceType<typeof YahooFinance>;
  private readonly pacer: MinRequestIntervalPacer;

  constructor(config: YahooFinanceJpMarketDataProviderConfig) {
    this.rateLimiter = config.rateLimiter;
    this.client = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
    this.pacer = new MinRequestIntervalPacer(config.minRequestIntervalMs ?? 0);
  }

  private consumeOne(): void {
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

  private async quoteRaw(symbol: string): Promise<YahooQuoteResult> {
    await this.pacer.waitTurn();
    this.consumeOne();
    const quote = this.client.quote.bind(this.client) as unknown as (
      symbol: string,
      queryOptions?: Record<string, unknown>,
      moduleOptions?: { validateResult?: boolean },
    ) => Promise<unknown>;
    return await quote(symbol, {}, { validateResult: false }) as YahooQuoteResult;
  }

  private async chartRaw(symbol: string, options: Record<string, unknown>): Promise<YahooChartResult> {
    await this.pacer.waitTurn();
    this.consumeOne();
    const chart = this.client.chart.bind(this.client) as unknown as (
      symbol: string,
      queryOptions: Record<string, unknown>,
      moduleOptions?: { validateResult?: boolean },
    ) => Promise<unknown>;
    return await chart(symbol, options, { validateResult: false }) as YahooChartResult;
  }

  private async searchRaw(query: string): Promise<YahooSearchResult> {
    await this.pacer.waitTurn();
    this.consumeOne();
    const search = this.client.search.bind(this.client) as unknown as (
      query: string,
      queryOptions: Record<string, unknown>,
      moduleOptions?: { validateResult?: boolean },
    ) => Promise<unknown>;
    return await search(
      query,
      { quotesCount: 7, lang: "en-US", region: "JP" },
      { validateResult: false },
    ) as YahooSearchResult;
  }

  async fetchBars(
    ticker: string,
    startDate?: string,
    endDate?: string,
    _options?: MarketDataFetchOptions,
  ): Promise<RawDailyBar[]> {
    const bareTicker = stripYahooJpSuffix(ticker);
    const result = await this.chartRaw(toYahooJpSymbol(bareTicker), {
      period1: startDate ?? JP_HISTORY_START,
      ...(endDate ? { period2: addDaysIsoDate(endDate, 1) } : {}),
      interval: "1d",
    });

    return result.quotes
      .filter((q) =>
        q.date != null && q.open != null && q.high != null && q.low != null && q.close != null && q.volume != null,
      )
      .map((q) => ({
        ticker: bareTicker,
        barDate: shiftToTokyoDate(q.date as Date),
        open: q.open as number,
        high: q.high as number,
        low: q.low as number,
        close: q.close as number,
        volume: q.volume as number,
        sourceId: "yahoo-finance-jp",
      }));
  }

  async fetchDividends(
    ticker: string,
    startDate?: string,
    endDate?: string,
    _options?: MarketDataFetchOptions,
  ): Promise<DividendRecord[]> {
    const bareTicker = stripYahooJpSuffix(ticker);
    const result = await this.chartRaw(toYahooJpSymbol(bareTicker), {
      period1: startDate ?? JP_HISTORY_START,
      ...(endDate ? { period2: addDaysIsoDate(endDate, 1) } : {}),
      interval: "1d",
      events: "div",
    });

    return (result.events?.dividends ?? []).map((d) => {
      const exDate = shiftToTokyoDate(d.date);
      return {
        ticker: bareTicker,
        exDividendDate: exDate,
        paymentDate: exDate,
        cashDividendPerShare: d.amount,
        stockDividendPerShare: 0,
        sourceId: "yahoo-finance-jp",
      };
    });
  }

  async fetchInstrumentCatalog(): Promise<RawInstrumentInfo[]> {
    return [];
  }

  async fetchDelistingHistory(): Promise<RawDelistingRecord[]> {
    return [];
  }

  async fetchInstrumentMetadata(ticker: string): Promise<RawInstrumentInfo | null> {
    const bareTicker = stripYahooJpSuffix(ticker);
    try {
      const symbol = toYahooJpSymbol(bareTicker);
      const quote = await this.quoteRaw(symbol);
      if (!isJpYahooQuote(symbol, quote)) return null;
      return {
        ticker: bareTicker,
        name: quote.longName ?? quote.shortName ?? bareTicker,
        typeRaw: "JPX",
        industryCategory: quote.quoteType ?? "EQUITY",
        date: new Date().toISOString().slice(0, 10),
      };
    } catch (err) {
      if (err instanceof RateLimitedError) throw err;
      return null;
    }
  }

  async searchInstruments(query: string): Promise<RawInstrumentInfo[]> {
    const result = await this.searchRaw(query);
    const today = new Date().toISOString().slice(0, 10);
    const out = new Map<string, RawInstrumentInfo>();

    for (const q of result.quotes) {
      const symbol = typeof q.symbol === "string" ? q.symbol.toUpperCase() : "";
      if (!symbol.endsWith(".T")) continue;
      const exchange = typeof q.exchange === "string" ? q.exchange.toUpperCase() : "";
      const fullExchangeName = typeof q.fullExchangeName === "string" ? q.fullExchangeName.toUpperCase() : "";
      if (exchange !== "JPX" && !fullExchangeName.includes("TOKYO") && !fullExchangeName.includes("JAPAN")) {
        continue;
      }
      const ticker = stripYahooJpSuffix(symbol);
      const name = q.longname ?? q.shortname ?? ticker;
      out.set(ticker, {
        ticker,
        name,
        typeRaw: "JPX",
        industryCategory: q.quoteType ?? "EQUITY",
        date: today,
      });
    }

    return [...out.values()];
  }
}
