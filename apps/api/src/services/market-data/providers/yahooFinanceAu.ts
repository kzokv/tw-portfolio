import YahooFinance from "yahoo-finance2";
import type {
  RawDailyBar,
  DividendRecord,
  RawInstrumentInfo,
  RawDelistingRecord,
  MarketDataProvider,
  InstrumentCatalogProvider,
} from "../types.js";
import { RateLimitedError } from "../types.js";
import type { RateLimiter } from "../rateLimiter.js";

// KZO-172 — local minimal type shapes for the yahoo-finance2 SDK responses we touch.
// The package's public exports do not surface these via the top-level entry point and
// the deep `esm/...` paths are blocked by `package.json` `exports` constraints. The
// runtime shapes match `yahoo-finance2@3.14.0`'s documented interfaces (chart.d.ts,
// search.d.ts, quote.d.ts) verified during the KZO-171 spike.
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
  isYahooFinance?: boolean;
  symbol?: string;
  exchange?: string;
  longname?: string;
  shortname?: string;
  quoteType?: string;
}
interface YahooSearchResult {
  quotes: YahooSearchQuote[];
}
interface YahooQuoteResult {
  longName?: string;
  shortName?: string;
  quoteType: string;
}

/**
 * KZO-172 — Yahoo Finance provider for the AU market via `yahoo-finance2@^3.14.0`.
 *
 * **Bare-ticker contract.** Internal storage everywhere is `(ticker = "BHP", marketCode = "AU")`.
 * Yahoo's Australian listings live at `${ticker}.AX` (BHP.AX, CSL.AX, etc.). The `.AX` suffix
 * is applied at the provider boundary inside `normalizeSymbol(ticker)`. **All** Yahoo SDK
 * calls (`chart`, `quote`, `search`) MUST route through this helper — a bare ticker silently
 * resolves to the NYSE listing in USD (a foot-gun documented in spike §5).
 *
 * **Yahoo ToS — personal/non-commercial only.** Per spike §7.3, Yahoo's terms restrict use
 * to personal/non-commercial purposes. Any multi-tenant or commercial deployment requires
 * switching to EODHD — the registry's swap path is a single line. The startup log emits a
 * `yahoo_finance_tos_notice` warning when this provider is selected.
 *
 * **Bounded catalog.** Yahoo offers no reliable enumeration of ASX-listed instruments
 * (`screener()` has no `*_au` scrId; spike §3). KZO-172 ships a hardcoded 7-row reserved
 * set via `fetchInstrumentCatalog()`; the wider catalog grows organically through
 * `fetchInstrumentMetadata(ticker)` enrichment as users add AU positions, plus per-query
 * autocomplete via `searchInstruments(query)`. No full ASX autocomplete in v1.
 *
 * **Rate limiter.** Yahoo does not publish a public rate limit. The provider has its own
 * `RateLimiter` instance — separate from FinMind's 600/hr budget — initialized via
 * `YAHOO_AU_RATE_LIMIT_PER_MINUTE` (default 60 req/min). Pre-flight `assertCanConsume(1)`
 * runs on each remote method (`fetchBars`, `fetchDividends`, `fetchInstrumentMetadata`,
 * `searchInstruments`). `fetchInstrumentCatalog()` is intentionally NOT pre-flighted —
 * it returns a static reserved-set without an upstream call.
 *
 * @see docs/004-notes/kzo-171/spike-202605021115-au-provider.md (§3, §5, §6, §7.3, §8)
 * @see docs/004-notes/kzo-172/scope-todo-202605021330-au-stock-ingestion.md (Phase 1)
 */
export interface YahooFinanceAuMarketDataProviderConfig {
  rateLimiter: RateLimiter;
}

/**
 * KZO-172 — 7-row reserved AU instrument set returned by `fetchInstrumentCatalog()`.
 * Spike §4.1 + §6 lock these tickers as the bounded validation sample. VAS is the only
 * ETF; the others are EQUITY (large-cap miner / healthcare / banks / LIC / A-REIT /
 * mining services).
 *
 * `industryCategory` carries Yahoo's `quoteType` literal (`"EQUITY"` or `"ETF"`),
 * matching what `fetchInstrumentMetadata()` emits via `quote()`. The classifier in
 * `libs/domain/src/classifyInstrument.ts` AU branch reads this verbatim.
 *
 * `date` uses the spike's verification date. The catalog-sync flow is identical to
 * KZO-170 US — `runCatalogSync` calls `dedup → build → upsert`; the date is informational.
 */
const AU_RESERVED_INSTRUMENTS: ReadonlyArray<RawInstrumentInfo> = [
  { ticker: "BHP", name: "BHP Group Limited",                typeRaw: "ASX", industryCategory: "EQUITY", date: "2026-05-02" },
  { ticker: "CSL", name: "CSL Limited",                      typeRaw: "ASX", industryCategory: "EQUITY", date: "2026-05-02" },
  { ticker: "VAS", name: "Vanguard Australian Shares Index ETF", typeRaw: "ASX", industryCategory: "ETF",    date: "2026-05-02" },
  { ticker: "WBC", name: "Westpac Banking Corporation",      typeRaw: "ASX", industryCategory: "EQUITY", date: "2026-05-02" },
  { ticker: "AFI", name: "Australian Foundation Investment Company Limited", typeRaw: "ASX", industryCategory: "EQUITY", date: "2026-05-02" },
  { ticker: "GMG", name: "Goodman Group",                    typeRaw: "ASX", industryCategory: "EQUITY", date: "2026-05-02" },
  { ticker: "IMD", name: "Imdex Limited",                    typeRaw: "ASX", industryCategory: "EQUITY", date: "2026-05-02" },
];

/**
 * Australia/Sydney UTC offset for ASX session-date normalization. ASX trades during
 * AEST (UTC+10) most of the year and AEDT (UTC+11) during DST. The yahoo-finance2
 * `chart()` API returns bar dates in UTC; we shift forward by the timezone offset
 * before slicing the date so a bar Yahoo reports as `2024-01-01T13:00:00Z` lands on
 * the ASX session date `2024-01-02` (the Jan 1 ASX session is the holiday).
 *
 * Spike §4.2 caveat: matches KZO-83 TW pattern. AEST is the conservative shift; AEDT
 * months produce the same date result for end-of-day bars (the difference is 1h, well
 * inside the safety margin around midnight UTC). Always-on AEST avoids leaking
 * Australia/Sydney TZ database lookups into the worker hot path.
 */
const SYDNEY_TZ_OFFSET_MS = 10 * 60 * 60 * 1000;

function shiftToSydneyDate(date: Date): string {
  const shifted = new Date(date.getTime() + SYDNEY_TZ_OFFSET_MS);
  return shifted.toISOString().slice(0, 10);
}

export class YahooFinanceAuMarketDataProvider implements MarketDataProvider, InstrumentCatalogProvider {
  /** KZO-170 D14: stable provider identity for log enrichment. */
  readonly providerId = "yahoo-finance-au";
  private readonly rateLimiter: RateLimiter;
  private readonly client: InstanceType<typeof YahooFinance>;

  constructor(config: YahooFinanceAuMarketDataProviderConfig) {
    this.rateLimiter = config.rateLimiter;
    // `suppressNotices: ["yahooSurvey"]` silences the recurring "help us improve" log
    // message on every `chart()` call. Spike §3.
    this.client = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
  }

  /**
   * KZO-172 — single entry point for converting our `(ticker, marketCode='AU')` pair to
   * Yahoo's symbol form. Every Yahoo SDK call must route through this helper. Pre-PR
   * grep audit per `.claude/rules/process-refactor-rename-verification.md` enforces the
   * rule mechanically.
   *
   * Trims whitespace defensively (search input could carry it) and uppercases — Yahoo's
   * ASX symbols are conventionally uppercase, and the bare `ticker` we receive should
   * already be uppercase from the upstream `tickerSchema.toUpperCase()` parse.
   */
  private normalizeSymbol(ticker: string): string {
    return `${ticker.trim().toUpperCase()}.AX`;
  }

  private assertCanConsume(): void {
    if (!this.rateLimiter.canConsume(1)) {
      throw new RateLimitedError({ msUntilAvailable: this.rateLimiter.msUntilAvailable(1) });
    }
    this.rateLimiter.consume(1);
  }

  /**
   * KZO-163 HIGH-1 mirror: pre-flight check for `n` rate-limit slots. Same TOCTOU
   * trade-off as `FinMindMarketDataProvider.reserveCapacity` — see that JSDoc for the
   * full discussion. Workers calling more than one fetch must call this first.
   */
  reserveCapacity(n: number): void {
    if (!this.rateLimiter.canConsume(n)) {
      throw new RateLimitedError({ msUntilAvailable: this.rateLimiter.msUntilAvailable(n) });
    }
  }

  async fetchBars(ticker: string, startDate?: string, endDate?: string): Promise<RawDailyBar[]> {
    this.assertCanConsume();
    const symbol = this.normalizeSymbol(ticker);
    // Cast: yahoo-finance2's `chart()` has multiple overloads; without an explicit
    // `return` option the array overload (`ChartResultArray`) is correct but the TS
    // resolver doesn't narrow cleanly because every option is optional. Casting to the
    // documented runtime shape per spike §3.
    const result = (await this.client.chart(symbol, {
      period1: startDate ?? "1988-01-28",
      ...(endDate ? { period2: endDate } : {}),
      interval: "1d",
    })) as YahooChartResult;

    return result.quotes
      .filter((q) =>
        q.date != null && q.open != null && q.high != null && q.low != null && q.close != null && q.volume != null,
      )
      .map((q) => ({
        ticker,
        // Australia/Sydney shift — see SYDNEY_TZ_OFFSET_MS JSDoc. Filter above
        // already drops null-fielded rows; the casts narrow the YahooChartQuote
        // `T | null` shape post-filter.
        barDate: shiftToSydneyDate(q.date as Date),
        open: q.open as number,
        high: q.high as number,
        low: q.low as number,
        close: q.close as number,
        volume: q.volume as number,
        sourceId: "yahoo-finance-au",
      }));
  }

  async fetchDividends(ticker: string, startDate?: string, endDate?: string): Promise<DividendRecord[]> {
    this.assertCanConsume();
    const symbol = this.normalizeSymbol(ticker);
    const result = (await this.client.chart(symbol, {
      period1: startDate ?? "1988-01-28",
      ...(endDate ? { period2: endDate } : {}),
      interval: "1d",
      events: "div",
    })) as YahooChartResult;

    const dividends = result.events?.dividends ?? [];
    return dividends.map((d) => {
      // Yahoo's dividend feed carries `{ amount, date }` only. No franking / DRP / BSP /
      // withholding tax — those are EODHD-only and out of scope for KZO-172 (spike §4.3).
      const exDate = shiftToSydneyDate(d.date);
      return {
        ticker,
        exDividendDate: exDate,
        // Yahoo provides no separate payment date — use ex-date as the payment date.
        // Replay invariants 3+4 are not affected; settlement entries use the same date.
        paymentDate: exDate,
        cashDividendPerShare: d.amount,
        stockDividendPerShare: 0,
        sourceId: "yahoo-finance-au",
      };
    });
  }

  /**
   * KZO-172 — bounded reserved-set. Static — no API call, no rate-limit consumption.
   * The catalog grows organically through `fetchInstrumentMetadata(ticker)` as users
   * add AU positions; this method seeds the validation tickers + a small starter set.
   * Spike §6 + scope-todo Phase 1.
   */
  async fetchInstrumentCatalog(): Promise<RawInstrumentInfo[]> {
    return [...AU_RESERVED_INSTRUMENTS];
  }

  /**
   * KZO-172 — Yahoo does not expose AU delisting reference data (spike §5). Return empty.
   * The integration test injects a synthetic AU delisting fixture to exercise the
   * cross-market market-scoped UPDATE regression.
   */
  async fetchDelistingHistory(): Promise<RawDelistingRecord[]> {
    return [];
  }

  /**
   * KZO-172 — per-ticker metadata enrichment via `quote(symbol)`. Returns `null` on
   * upstream failure (Yahoo's `quote` throws on unknown symbols / scraping breakage)
   * so the worker's outer warn-and-continue path can absorb non-`RateLimitedError`
   * failures without aborting the backfill. `RateLimitedError` propagates upward per
   * `.claude/rules/typed-transient-error-catch-audit.md`.
   */
  async fetchInstrumentMetadata(ticker: string): Promise<RawInstrumentInfo | null> {
    this.assertCanConsume();
    const symbol = this.normalizeSymbol(ticker);
    try {
      // `Quote` is a discriminated union (`QuoteEquity | QuoteEtf | ...`); `longName` /
      // `shortName` exist on `QuoteBase` and `quoteType` is the discriminator literal.
      // Reading them directly off the union is fine at the value level even though TS
      // narrows pessimistically.
      const quote = (await this.client.quote(symbol)) as YahooQuoteResult;
      const name = quote.longName ?? quote.shortName ?? ticker;
      // `quoteType` is one of EQUITY / ETF / MUTUALFUND / etc. The AU classifier maps
      // ETF → ETF and everything else → STOCK; the raw value is preserved for
      // observability / future bond-ETF discrimination.
      return {
        ticker,
        name,
        typeRaw: "ASX",
        industryCategory: quote.quoteType,
        date: new Date().toISOString().slice(0, 10),
      };
    } catch (err) {
      // RateLimitedError must escape — never let our own typed transient signal get
      // swallowed by the upstream try/catch. `assertCanConsume()` above is the only
      // local source of `RateLimitedError`, but the underlying SDK could plausibly
      // also throw it through nested promise wrapping in future versions.
      if (err instanceof RateLimitedError) throw err;
      return null;
    }
  }

  /**
   * KZO-172 — per-query autocomplete via `search(query, { region: "AU" })`. Defensive
   * double-filter: Yahoo's search returns mixed-region results despite the `region`
   * hint. We require `exchange === "ASX"` AND symbol ending in `.AX` so a stray
   * `BHP` (NYSE) doesn't sneak through. Spike §3 + §6.
   *
   * Returns the strip-`.AX` ticker so the caller's persistence stays in `(ticker,
   * marketCode='AU')` form. `RateLimitedError` propagates; other failures throw the
   * underlying error, which the route maps to 503 + `X-Search-Degraded: true`.
   */
  async searchInstruments(query: string): Promise<RawInstrumentInfo[]> {
    this.assertCanConsume();
    const result = (await this.client.search(query, {
      quotesCount: 7,
      lang: "en-AU",
      region: "AU",
    })) as YahooSearchResult;
    const today = new Date().toISOString().slice(0, 10);
    const out: RawInstrumentInfo[] = [];
    for (const q of result.quotes) {
      // Type narrowing: `SearchQuoteNonYahoo` lacks `symbol`, `exchange` etc. The
      // `isYahooFinance: true` discriminator lets TS narrow to the union of
      // `SearchQuoteYahoo*` shapes. We also defensively read these fields as unknowns
      // to avoid surprises if Yahoo widens the result schema upstream.
      const yahooQuote = q as { symbol?: unknown; exchange?: unknown; longname?: unknown; shortname?: unknown; quoteType?: unknown };
      const symbol = typeof yahooQuote.symbol === "string" ? yahooQuote.symbol : "";
      const exchange = typeof yahooQuote.exchange === "string" ? yahooQuote.exchange : "";
      if (exchange !== "ASX" || !symbol.endsWith(".AX")) continue;
      const ticker = symbol.slice(0, -3);
      const longname = typeof yahooQuote.longname === "string" ? yahooQuote.longname : "";
      const shortname = typeof yahooQuote.shortname === "string" ? yahooQuote.shortname : "";
      const name = longname || shortname || ticker;
      const quoteType = typeof yahooQuote.quoteType === "string" ? yahooQuote.quoteType : "EQUITY";
      out.push({
        ticker,
        name,
        typeRaw: "ASX",
        industryCategory: quoteType,
        date: today,
      });
    }
    return out;
  }
}

/** Test-only export of the reserved-set so unit tests can assert membership without re-deriving. */
export { AU_RESERVED_INSTRUMENTS };
