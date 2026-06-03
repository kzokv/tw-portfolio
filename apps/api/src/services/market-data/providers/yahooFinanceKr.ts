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

export interface YahooFinanceKrMarketDataProviderConfig {
  rateLimiter: RateLimiter;
  resolverMode?: YahooKrResolverMode;
}

export type YahooKrResolverMode = "chart_probe_v1" | "quote_first";

const DEFAULT_YAHOO_KR_RESOLVER_MODE: YahooKrResolverMode = "quote_first";

const SEOUL_TZ_OFFSET_MS = 9 * 60 * 60 * 1000;
const KR_SUFFIXES = [".KS", ".KQ"] as const;

function shiftToSeoulDate(date: Date): string {
  const shifted = new Date(date.getTime() + SEOUL_TZ_OFFSET_MS);
  return shifted.toISOString().slice(0, 10);
}

function stripKrSuffix(symbol: string): string {
  const normalized = symbol.trim().toUpperCase();
  for (const suffix of KR_SUFFIXES) {
    if (normalized.endsWith(suffix)) return normalized.slice(0, -suffix.length);
  }
  return normalized;
}

function hasKrSuffix(symbol: string): boolean {
  const normalized = symbol.trim().toUpperCase();
  return KR_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}

function isKrYahooQuote(symbol: string, quote: YahooQuoteResult): boolean {
  const quotedSymbol = (quote.symbol ?? symbol).toUpperCase();
  const exchange = (quote.exchange ?? "").toUpperCase();
  const fullExchangeName = (quote.fullExchangeName ?? "").toUpperCase();
  const currency = (quote.currency ?? "").toUpperCase();
  return (
    hasKrSuffix(quotedSymbol)
    && (
      currency === "KRW"
      || exchange === "KSC"
      || exchange === "KOE"
      || fullExchangeName.includes("KOREA")
      || fullExchangeName.includes("KOSDAQ")
    )
  );
}

export class YahooFinanceKrMarketDataProvider implements MarketDataProvider, InstrumentCatalogProvider {
  readonly providerId = "yahoo-finance-kr";
  readonly supportsMetadataEnrichment = true;
  readonly supportsDelistingFeed = false;
  readonly absenceDetectionEnabled = false;
  private readonly rateLimiter: RateLimiter;
  private readonly client: InstanceType<typeof YahooFinance>;
  private readonly symbolCache = new Map<string, string>();
  private readonly resolverMode: YahooKrResolverMode;

  constructor(config: YahooFinanceKrMarketDataProviderConfig) {
    this.rateLimiter = config.rateLimiter;
    this.client = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
    this.resolverMode = config.resolverMode ?? DEFAULT_YAHOO_KR_RESOLVER_MODE;
  }

  private consumeOne(): void {
    if (!this.rateLimiter.canConsume(1)) {
      throw new RateLimitedError({ msUntilAvailable: this.rateLimiter.msUntilAvailable(1) });
    }
    this.rateLimiter.consume(1);
  }

  /**
   * Worst-case unresolved bare ticker costs two `quote()` probes plus the final
   * chart/search call. Cached symbols usually cost one upstream call, but workers
   * need a conservative pre-flight bound to avoid deterministic starvation.
   */
  reserveCapacity(n: number): void {
    const slots = n * 3;
    if (!this.rateLimiter.canConsume(slots)) {
      throw new RateLimitedError({ msUntilAvailable: this.rateLimiter.msUntilAvailable(slots) });
    }
  }

  private async quoteRaw(symbol: string): Promise<YahooQuoteResult> {
    this.consumeOne();
    const quote = this.client.quote as unknown as (
      symbol: string,
      queryOptions?: Record<string, unknown>,
      moduleOptions?: { validateResult?: boolean },
    ) => Promise<unknown>;
    return await quote(symbol, {}, { validateResult: false }) as YahooQuoteResult;
  }

  private async chartRaw(symbol: string, options: Record<string, unknown>): Promise<YahooChartResult> {
    this.consumeOne();
    const chart = this.client.chart as unknown as (
      symbol: string,
      queryOptions: Record<string, unknown>,
      moduleOptions?: { validateResult?: boolean },
    ) => Promise<unknown>;
    return await chart(symbol, options, { validateResult: false }) as YahooChartResult;
  }

  private async searchRaw(query: string): Promise<YahooSearchResult> {
    this.consumeOne();
    const search = this.client.search as unknown as (
      query: string,
      queryOptions: Record<string, unknown>,
      moduleOptions?: { validateResult?: boolean },
    ) => Promise<unknown>;
    return await search(
      query,
      { quotesCount: 7, lang: "en-US", region: "US" },
      { validateResult: false },
    ) as YahooSearchResult;
  }

  private getResolverCandidates(ticker: string): string[] {
    const normalized = ticker.trim().toUpperCase();
    const bare = stripKrSuffix(normalized);
    const candidates = hasKrSuffix(normalized)
      ? [normalized]
      : KR_SUFFIXES.map((suffix) => `${bare}${suffix}`);
    return candidates;
  }

  private getBareTicker(ticker: string): string {
    return stripKrSuffix(ticker.trim().toUpperCase());
  }

  private async resolveYahooSymbol(
    ticker: string,
    options: MarketDataFetchOptions = {},
  ): Promise<string> {
    const bare = this.getBareTicker(ticker);
    const cached = this.symbolCache.get(bare);
    if (cached) return cached;

    const candidates = this.getResolverCandidates(ticker);
    const resolverMode = options.resolverMode ?? this.resolverMode;
    if (resolverMode === "chart_probe_v1") {
      for (const symbol of candidates) {
        try {
          const chart = await this.chartRaw(symbol, {
            period1: "2000-01-04",
            interval: "1d",
          });
          if (chart.quotes.length > 0) {
            this.symbolCache.set(bare, symbol);
            return symbol;
          }
        } catch (err) {
          if (err instanceof RateLimitedError) throw err;
        }
      }
      throw new Error(`yahoo_finance_kr_symbol_unresolved: ${bare}`);
    }

    // Legacy fallback path (quote-first): keep existing gate behavior.
    for (const symbol of candidates) {
      try {
        const quote = await this.quoteRaw(symbol);
        if (isKrYahooQuote(symbol, quote)) {
          this.symbolCache.set(bare, symbol);
          return symbol;
        }
      } catch (err) {
        if (err instanceof RateLimitedError) throw err;
      }
    }
    throw new Error(`yahoo_finance_kr_symbol_unresolved: ${bare}`);
  }

  private async resolveYahooQuote(ticker: string): Promise<{ symbol: string; quote: YahooQuoteResult }> {
    const bare = this.getBareTicker(ticker);
    const cached = this.symbolCache.get(bare);
    if (cached) {
      const quote = await this.quoteRaw(cached);
      if (isKrYahooQuote(cached, quote)) return { symbol: cached, quote };
    }

    const candidates = this.getResolverCandidates(ticker);
    for (const symbol of candidates) {
      try {
        const quote = await this.quoteRaw(symbol);
        if (isKrYahooQuote(symbol, quote)) {
          this.symbolCache.set(bare, symbol);
          return { symbol, quote };
        }
      } catch (err) {
        if (err instanceof RateLimitedError) throw err;
      }
    }
    throw new Error(`yahoo_finance_kr_symbol_unresolved: ${bare}`);
  }

  async fetchBars(
    ticker: string,
    startDate?: string,
    endDate?: string,
    options?: MarketDataFetchOptions,
  ): Promise<RawDailyBar[]> {
    const symbol = await this.resolveYahooSymbol(ticker, options);
    const bareTicker = stripKrSuffix(ticker);
    const result = await this.chartRaw(symbol, {
      period1: startDate ?? "2000-01-04",
      ...(endDate ? { period2: endDate } : {}),
      interval: "1d",
    });

    return result.quotes
      .filter((q) =>
        q.date != null && q.open != null && q.high != null && q.low != null && q.close != null && q.volume != null,
      )
      .map((q) => ({
        ticker: bareTicker,
        barDate: shiftToSeoulDate(q.date as Date),
        open: q.open as number,
        high: q.high as number,
        low: q.low as number,
        close: q.close as number,
        volume: q.volume as number,
        sourceId: "yahoo-finance-kr",
      }));
  }

  async fetchDividends(
    ticker: string,
    startDate?: string,
    endDate?: string,
    options?: MarketDataFetchOptions,
  ): Promise<DividendRecord[]> {
    const symbol = await this.resolveYahooSymbol(ticker, options);
    const bareTicker = stripKrSuffix(ticker);
    const result = await this.chartRaw(symbol, {
      period1: startDate ?? "2000-01-04",
      ...(endDate ? { period2: endDate } : {}),
      interval: "1d",
      events: "div",
    });

    return (result.events?.dividends ?? []).map((d) => {
      const exDate = shiftToSeoulDate(d.date);
      return {
        ticker: bareTicker,
        exDividendDate: exDate,
        paymentDate: exDate,
        cashDividendPerShare: d.amount,
        stockDividendPerShare: 0,
        sourceId: "yahoo-finance-kr",
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
    try {
      const { quote } = await this.resolveYahooQuote(ticker);
      const bareTicker = stripKrSuffix(ticker);
      return {
        ticker: bareTicker,
        name: quote.longName ?? quote.shortName ?? bareTicker,
        typeRaw: "KRX",
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
      if (!hasKrSuffix(symbol)) continue;
      const exchange = typeof q.exchange === "string" ? q.exchange.toUpperCase() : "";
      const fullExchangeName = typeof q.fullExchangeName === "string" ? q.fullExchangeName.toUpperCase() : "";
      if (
        exchange !== "KSC"
        && exchange !== "KOE"
        && !fullExchangeName.includes("KOREA")
        && !fullExchangeName.includes("KOSDAQ")
      ) {
        continue;
      }
      const ticker = stripKrSuffix(symbol);
      const name = q.longname ?? q.shortname ?? ticker;
      out.set(ticker, {
        ticker,
        name,
        typeRaw: "KRX",
        industryCategory: q.quoteType ?? "EQUITY",
        date: today,
      });
    }

    return [...out.values()];
  }
}
