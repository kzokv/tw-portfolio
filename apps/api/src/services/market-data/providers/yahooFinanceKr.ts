import YahooFinance from "yahoo-finance2";
import type {
  RawDailyBar,
  DividendRecord,
  RawInstrumentInfo,
  RawDelistingRecord,
  MarketDataProvider,
  InstrumentCatalogProvider,
  MarketDataFetchOptions,
  ProviderSymbolVerificationResult,
} from "../types.js";
import { RateLimitedError } from "../types.js";
import type { RateLimiter } from "../rateLimiter.js";
import type { InstrumentRow } from "../../../persistence/types.js";
import { yahooSuffixHintFromKrCatalogEvidence } from "./twelveDataKr.js";

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
  persistence?: {
    getProviderResolutionMapping(
      providerId: string,
      marketCode: "KR",
      sourceSymbol: string,
    ): Promise<{ resolvedSymbol: string } | null>;
    getInstrument(ticker: string, marketCode?: string): Promise<Pick<
      InstrumentRow,
      "catalogExchangeRaw" | "catalogMicCode" | "typeRaw"
    > | null>;
  };
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
  private readonly quoteFirstSymbolCache = new Map<string, string>();
  private readonly resolverMode: YahooKrResolverMode;
  private readonly persistence: YahooFinanceKrMarketDataProviderConfig["persistence"];

  constructor(config: YahooFinanceKrMarketDataProviderConfig) {
    this.rateLimiter = config.rateLimiter;
    this.client = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
    this.resolverMode = config.resolverMode ?? DEFAULT_YAHOO_KR_RESOLVER_MODE;
    this.persistence = config.persistence;
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
    const quote = this.client.quote.bind(this.client) as unknown as (
      symbol: string,
      queryOptions?: Record<string, unknown>,
      moduleOptions?: { validateResult?: boolean },
    ) => Promise<unknown>;
    return await quote(symbol, {}, { validateResult: false }) as YahooQuoteResult;
  }

  private async chartRaw(symbol: string, options: Record<string, unknown>): Promise<YahooChartResult> {
    this.consumeOne();
    const chart = this.client.chart.bind(this.client) as unknown as (
      symbol: string,
      queryOptions: Record<string, unknown>,
      moduleOptions?: { validateResult?: boolean },
    ) => Promise<unknown>;
    return await chart(symbol, options, { validateResult: false }) as YahooChartResult;
  }

  private async searchRaw(query: string): Promise<YahooSearchResult> {
    this.consumeOne();
    const search = this.client.search.bind(this.client) as unknown as (
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

  private async getResolverCandidates(ticker: string): Promise<string[]> {
    const normalized = ticker.trim().toUpperCase();
    const bare = stripKrSuffix(normalized);
    if (hasKrSuffix(normalized)) return [normalized];

    const mapped = await this.persistence?.getProviderResolutionMapping(this.providerId, "KR", bare);
    if (mapped?.resolvedSymbol) {
      const resolvedSymbol = mapped.resolvedSymbol.trim().toUpperCase();
      return [resolvedSymbol, ...KR_SUFFIXES.map((suffix) => `${bare}${suffix}`).filter((symbol) => symbol !== resolvedSymbol)];
    }

    const instrument = await this.persistence?.getInstrument(bare, "KR");
    const hintedSuffix = yahooSuffixHintFromKrCatalogEvidence(
      instrument?.catalogExchangeRaw ?? instrument?.typeRaw ?? null,
      instrument?.catalogMicCode ?? null,
    );
    if (hintedSuffix) {
      const prioritized = `${bare}${hintedSuffix}`;
      return [prioritized, ...KR_SUFFIXES.map((suffix) => `${bare}${suffix}`).filter((symbol) => symbol !== prioritized)];
    }

    const candidates = KR_SUFFIXES.map((suffix) => `${bare}${suffix}`);
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
    const resolverMode = options.resolverMode ?? this.resolverMode;
    const candidates = await this.getResolverCandidates(ticker);
    if (resolverMode === "chart_probe_v1") {
      for (const symbol of candidates) {
        try {
          const chart = await this.chartRaw(symbol, {
            period1: "2000-01-04",
            interval: "1d",
          });
          if (chart.quotes.length > 0) {
            return symbol;
          }
        } catch (err) {
          if (err instanceof RateLimitedError) throw err;
        }
      }
      throw new Error(`yahoo_finance_kr_symbol_unresolved: ${bare}`);
    }

    // Legacy fallback path (quote-first): keep existing gate behavior.
    const orderedCandidates = [...candidates];
    const cached = this.quoteFirstSymbolCache.get(bare);
    if (cached && !orderedCandidates.includes(cached)) {
      orderedCandidates.push(cached);
    }

    for (const symbol of orderedCandidates) {
      try {
        const quote = await this.quoteRaw(symbol);
        if (isKrYahooQuote(symbol, quote)) {
          this.quoteFirstSymbolCache.set(bare, symbol);
          return symbol;
        }
      } catch (err) {
        if (err instanceof RateLimitedError) throw err;
      }
    }
    throw new Error(`yahoo_finance_kr_symbol_unresolved: ${bare}`);
  }

  async verifyResolvedSymbol(
    ticker: string,
    candidateSymbol: string,
    options: MarketDataFetchOptions = {},
  ): Promise<ProviderSymbolVerificationResult> {
    const bare = this.getBareTicker(ticker);
    const symbol = candidateSymbol.trim().toUpperCase();
    const resolverMode = options.resolverMode ?? this.resolverMode;
    if (!hasKrSuffix(symbol) || stripKrSuffix(symbol) !== bare) {
      return {
        verified: false,
        checkedSymbol: symbol,
        resolverMode,
        reason: "candidate_symbol_does_not_match_source_ticker",
      };
    }

    try {
      if (resolverMode === "chart_probe_v1") {
        const chart = await this.chartRaw(symbol, {
          period1: "2000-01-04",
          interval: "1d",
        });
        return {
          verified: chart.quotes.length > 0,
          checkedSymbol: symbol,
          resolverMode,
          ...(chart.quotes.length > 0 ? {} : { reason: "no_chart_rows" }),
        };
      }

      const quote = await this.quoteRaw(symbol);
      const verified = isKrYahooQuote(symbol, quote);
      return {
        verified,
        checkedSymbol: symbol,
        resolverMode,
        ...(verified ? {} : { reason: "quote_not_korean_exchange" }),
      };
    } catch (err) {
      if (err instanceof RateLimitedError) throw err;
      return {
        verified: false,
        checkedSymbol: symbol,
        resolverMode,
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async resolveYahooQuote(ticker: string): Promise<{ symbol: string; quote: YahooQuoteResult }> {
    const bare = this.getBareTicker(ticker);
    const candidates = await this.getResolverCandidates(ticker);
    const orderedCandidates = [...candidates];
    const cached = this.quoteFirstSymbolCache.get(bare);
    if (cached && candidates[0] === cached) {
      const quote = await this.quoteRaw(cached);
      if (isKrYahooQuote(cached, quote)) return { symbol: cached, quote };
    }
    if (cached && !orderedCandidates.includes(cached)) {
      orderedCandidates.push(cached);
    }
    for (const symbol of orderedCandidates) {
      try {
        const quote = await this.quoteRaw(symbol);
        if (isKrYahooQuote(symbol, quote)) {
          this.quoteFirstSymbolCache.set(bare, symbol);
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
