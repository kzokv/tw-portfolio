import type {
  RawDailyBar,
  DividendRecord,
  RawInstrumentInfo,
  RawDelistingRecord,
  MarketDataProvider,
  InstrumentCatalogProvider,
} from "../types.js";

/**
 * KZO-172 — Deterministic AU fixtures for tests / dev (`AU_PROVIDER_MOCK=true`).
 *
 * Mirrors the `MockFinMindUsStockMarketDataProvider` shape: `calls: Array<{...}>` for
 * test inspection, `fixtureStartDate` constructor option for truncation regression
 * tests (similar to KZO-170 G-CRIT-3).
 *
 * **Critical fixture invariant (AC #2):** `fetchDividends("BHP", ...)` returns FOUR
 * `DividendRecord` entries spanning 3+ years. Real BHP cadence is twice-yearly, so a
 * 1-year window naturally yields only 2 entries — the integration test's AC threshold
 * (≥4 dividend entries for BHP) FAILS unless the mock seeds 4+ across multiple years.
 *
 * `fetchInstrumentMetadata` returns deterministic enriched rows for the 7 reserved
 * tickers + CBA (Commonwealth Bank). CBA is reserved for KZO-188's discovery E2E so
 * `searchInstruments("CBA")` finds a known fixture without touching real Yahoo.
 */

interface MockAuTickerSpec {
  ticker: string;
  name: string;
  basePrice: number;
  /** Yahoo `quoteType` literal (`"EQUITY"` | `"ETF"`). */
  industryCategory: "EQUITY" | "ETF";
}

const MOCK_AU_TICKERS: MockAuTickerSpec[] = [
  { ticker: "BHP", name: "BHP Group Limited",                                basePrice: 45,   industryCategory: "EQUITY" },
  { ticker: "CSL", name: "CSL Limited",                                      basePrice: 280,  industryCategory: "EQUITY" },
  { ticker: "VAS", name: "Vanguard Australian Shares Index ETF",             basePrice: 95,   industryCategory: "ETF" },
  { ticker: "WBC", name: "Westpac Banking Corporation",                      basePrice: 27,   industryCategory: "EQUITY" },
  { ticker: "AFI", name: "Australian Foundation Investment Company Limited", basePrice: 7.4,  industryCategory: "EQUITY" },
  { ticker: "GMG", name: "Goodman Group",                                    basePrice: 28,   industryCategory: "EQUITY" },
  { ticker: "IMD", name: "Imdex Limited",                                    basePrice: 2.2,  industryCategory: "EQUITY" },
  // KZO-188 prep: CBA is the discovery test ticker. Not in `AU_RESERVED_INSTRUMENTS`
  // (so it isn't seeded by `fetchInstrumentCatalog`), but `fetchInstrumentMetadata`
  // and `searchInstruments` both know about it so the discovery E2E flow works.
  { ticker: "CBA", name: "Commonwealth Bank of Australia",                   basePrice: 110,  industryCategory: "EQUITY" },
];

/**
 * Default fixture start. Tests asserting the truncation regression pass an explicit
 * `fixtureStartDate: "1985-01-01"` (predates `historyStartFor("AU") = 1988-01-28`)
 * so the worker truncates to the provider boundary.
 */
const DEFAULT_FIXTURE_START = "2024-01-02";

function generateMockAuBars(spec: MockAuTickerSpec, startDate: string, count: number = 30): RawDailyBar[] {
  const bars: RawDailyBar[] = [];
  const start = new Date(`${startDate}T00:00:00Z`);
  let calendarOffset = 0;
  for (let tradingDay = 0; tradingDay < count; calendarOffset++) {
    const date = new Date(start);
    date.setUTCDate(date.getUTCDate() + calendarOffset);
    const day = date.getUTCDay();
    if (day === 0 || day === 6) continue; // Skip weekends without bumping tradingDay.
    const i = tradingDay;
    const dayStr = date.toISOString().slice(0, 10);
    const price = spec.basePrice + i * 0.15;
    bars.push({
      ticker: spec.ticker,
      barDate: dayStr,
      open: price,
      high: price + 0.8,
      low: price - 0.4,
      close: price + 0.3,
      volume: 5_000_000 + i * 50_000,
      sourceId: "yahoo-finance-au",
    });
    tradingDay++;
  }
  return bars;
}

/**
 * BHP fixture dividends — twice-yearly cadence across 3+ years to clear AC #2's
 * "≥4 dividend entries" threshold. Approximates the spike §4.3 sample (16 events
 * over 7 years; we ship 6 spanning 2022-09 → 2025-03).
 */
const BHP_FIXTURE_DIVIDENDS: ReadonlyArray<{ exDate: string; amount: number }> = [
  { exDate: "2022-09-08", amount: 1.94 },
  { exDate: "2023-03-02", amount: 0.71 },
  { exDate: "2023-09-07", amount: 0.85 },
  { exDate: "2024-03-07", amount: 0.69 },
  { exDate: "2024-09-05", amount: 0.74 },
  { exDate: "2025-03-06", amount: 0.50 },
];

/** VAS fixture dividends — quarterly distribution (4 per year for 2 years = 8 entries). */
const VAS_FIXTURE_DIVIDENDS: ReadonlyArray<{ exDate: string; amount: number }> = [
  { exDate: "2024-04-02", amount: 0.93 },
  { exDate: "2024-07-02", amount: 0.94 },
  { exDate: "2024-10-02", amount: 1.04 },
  { exDate: "2025-01-02", amount: 0.98 },
  { exDate: "2025-03-31", amount: 0.73 },
];

const FIXTURE_DIVIDENDS_BY_TICKER: Record<string, ReadonlyArray<{ exDate: string; amount: number }>> = {
  BHP: BHP_FIXTURE_DIVIDENDS,
  VAS: VAS_FIXTURE_DIVIDENDS,
};

/**
 * KZO-194 — Yahoo's `fetchInstrumentCatalog()` returns `[]`. The mock follows the same
 * shape so call-site behavior stays identical to the real provider. Tests that need
 * mock AU catalog rows now go through `MockTwelveDataAuCatalogProvider` instead.
 *
 * Pre-KZO-194 this was a copy of `AU_RESERVED_INSTRUMENTS` (the 7-row reserved set).
 * The constant has moved to TD; this mock no longer carries an AU catalog of its own.
 */
const MOCK_AU_INSTRUMENT_CATALOG: ReadonlyArray<RawInstrumentInfo> = [];

export class MockYahooFinanceAuMarketDataProvider implements MarketDataProvider, InstrumentCatalogProvider {
  /** KZO-170 D14: same provider identity as the real `YahooFinanceAuMarketDataProvider`. */
  readonly providerId = "yahoo-finance-au";
  /** KZO-190 — mirrors real `YahooFinanceAuMarketDataProvider`; `fetchInstrumentMetadata` consumes a slot. */
  readonly supportsMetadataEnrichment = true;
  readonly calls: Array<{
    method: string;
    ticker?: string;
    query?: string;
    startDate?: string;
    endDate?: string;
    n?: number;
  }> = [];

  private readonly fixtureStartDate: string;
  private _nextSearchError: Error | null = null;

  constructor(opts?: { fixtureStartDate?: string }) {
    this.fixtureStartDate = opts?.fixtureStartDate ?? DEFAULT_FIXTURE_START;
  }

  /**
   * KZO-172 — Test seam (architect Dep 2): inject a single-use error to be thrown by
   * the next `searchInstruments` call. Auto-clears after the throw so a single mock
   * instance can simulate multiple sequential calls (one transient fault → next
   * call resumes the fixture path). Used to exercise the route's 503/Retry-After
   * /X-Search-Degraded mapping at HTTP layer without re-touching this class.
   */
  _setNextSearchError(err: Error | null): void {
    this._nextSearchError = err;
  }

  reserveCapacity(n: number): void {
    this.calls.push({ method: "reserveCapacity", n });
  }

  async fetchBars(ticker: string, startDate?: string, endDate?: string): Promise<RawDailyBar[]> {
    this.calls.push({
      method: "fetchBars",
      ticker,
      ...(startDate ? { startDate } : {}),
      ...(endDate ? { endDate } : {}),
    });
    const spec = MOCK_AU_TICKERS.find((t) => t.ticker === ticker);
    if (!spec) return [];
    return generateMockAuBars(spec, this.fixtureStartDate);
  }

  async fetchDividends(ticker: string, startDate?: string, endDate?: string): Promise<DividendRecord[]> {
    this.calls.push({
      method: "fetchDividends",
      ticker,
      ...(startDate ? { startDate } : {}),
      ...(endDate ? { endDate } : {}),
    });
    const fixture = FIXTURE_DIVIDENDS_BY_TICKER[ticker];
    if (!fixture) return [];
    return fixture.map((d) => ({
      ticker,
      exDividendDate: d.exDate,
      paymentDate: d.exDate,
      cashDividendPerShare: d.amount,
      stockDividendPerShare: 0,
      sourceId: "yahoo-finance-au",
    }));
  }

  async fetchInstrumentCatalog(): Promise<RawInstrumentInfo[]> {
    this.calls.push({ method: "fetchInstrumentCatalog" });
    return [...MOCK_AU_INSTRUMENT_CATALOG];
  }

  async fetchDelistingHistory(): Promise<RawDelistingRecord[]> {
    this.calls.push({ method: "fetchDelistingHistory" });
    return [];
  }

  async fetchInstrumentMetadata(ticker: string): Promise<RawInstrumentInfo | null> {
    this.calls.push({ method: "fetchInstrumentMetadata", ticker });
    const spec = MOCK_AU_TICKERS.find((t) => t.ticker === ticker);
    if (!spec) return null;
    return {
      ticker: spec.ticker,
      name: spec.name,
      typeRaw: "ASX",
      industryCategory: spec.industryCategory,
      date: "2026-05-02",
    };
  }

  /**
   * KZO-172 — case-insensitive substring match across the 8 fixture tickers (7 reserved
   * + CBA). Returns up to `quotesCount=7` matches, mirroring the real `search()` cap.
   * Gives KZO-188's discovery E2E a deterministic happy path without touching Yahoo.
   *
   * Architect Dep 2: if `_setNextSearchError(err)` was called since the last
   * `searchInstruments`, the injected error fires once and is cleared, allowing
   * subsequent calls to resume the fixture path.
   */
  async searchInstruments(query: string): Promise<RawInstrumentInfo[]> {
    this.calls.push({ method: "searchInstruments", query });
    if (this._nextSearchError) {
      const err = this._nextSearchError;
      this._nextSearchError = null;
      throw err;
    }
    const q = query.trim().toUpperCase();
    if (q.length === 0) return [];
    const matches = MOCK_AU_TICKERS.filter(
      (t) => t.ticker.includes(q) || t.name.toUpperCase().includes(q),
    ).slice(0, 7);
    return matches.map((spec) => ({
      ticker: spec.ticker,
      name: spec.name,
      typeRaw: "ASX",
      industryCategory: spec.industryCategory,
      date: "2026-05-02",
    }));
  }
}

export { MOCK_AU_INSTRUMENT_CATALOG };
