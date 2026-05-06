import type {
  RawDailyBar,
  DividendRecord,
  RawInstrumentInfo,
  RawDelistingRecord,
  MarketDataProvider,
  InstrumentCatalogProvider,
} from "../types.js";

/**
 * KZO-170 — Deterministic US-stock fixtures for tests / dev.
 *
 * **No mock dividends.** The real `FinMindUsStockMarketDataProvider.fetchDividends`
 * returns `[]` because FinMind v4 has no `USStockDividend` dataset. Mirroring that
 * shape in the mock keeps tests honest — KZO-187 will introduce US dividends via
 * an alternate provider; the mock for THAT provider will own the dividend fixtures.
 *
 * **Catalog rows:**
 * - `AAPL` → `Subsector: "Computer Manufacturing"` (verified Phase-1 curl)
 * - `MSFT` → `Subsector: "Computer Software: Prepackaged Software"`
 * - `VOO`  → `Subsector: "Investment Trusts/Mutual Funds"` (the classifier
 *   maps via the curated allow-list — Subsector free text is informational only)
 * - `BND`  → `Subsector: "Investment Trusts/Mutual Funds"`
 *
 * The classifier in `libs/domain/src/classifyInstrument.ts` reads the ticker
 * (not the Subsector free text) for US, so the four mock rows produce:
 * AAPL/MSFT → STOCK, VOO → ETF, BND → BOND_ETF.
 */

interface MockUsTickerSpec {
  ticker: string;
  basePrice: number;
  /** Subsector value mirroring the real FinMind v4 `USStockInfo.Subsector` shape. */
  subsector: string;
  /** Friendly stock_name as FinMind returns it. */
  name: string;
}

const MOCK_US_TICKERS: MockUsTickerSpec[] = [
  { ticker: "AAPL", basePrice: 185, subsector: "Computer Manufacturing", name: "Apple Inc. Common Stock" },
  { ticker: "MSFT", basePrice: 410, subsector: "Computer Software: Prepackaged Software", name: "Microsoft Corporation Common Stock" },
  { ticker: "VOO",  basePrice: 480, subsector: "Investment Trusts/Mutual Funds", name: "Vanguard S&P 500 ETF" },
  { ticker: "BND",  basePrice: 73,  subsector: "Investment Trusts/Mutual Funds", name: "Vanguard Total Bond Market ETF" },
];

/**
 * Default fixture start. KZO-170 G-CRIT-3 truncation regression test passes a constructor
 * variant `fixtureStartDate: "2018-01-01"` to produce bars predating the US `historyStartFor`
 * (`2019-06-01`) — the worker must truncate to the provider start, not pass through the
 * caller's older `startDate`.
 */
const DEFAULT_FIXTURE_START = "2024-01-02";

function generateMockUsBars(spec: MockUsTickerSpec, startDate: string, count: number = 30): RawDailyBar[] {
  const bars: RawDailyBar[] = [];
  const start = new Date(`${startDate}T00:00:00Z`);
  // Separate calendar-day offset from trading-day counter. Using `i--` in a for-loop
  // to compensate for weekends re-evaluates the same calendar day on the next iteration,
  // producing an infinite loop when `start + tradingDay` lands on a weekend.
  let calendarOffset = 0;
  for (let tradingDay = 0; tradingDay < count; calendarOffset++) {
    const date = new Date(start);
    date.setUTCDate(date.getUTCDate() + calendarOffset);
    const day = date.getUTCDay();
    if (day === 0 || day === 6) {
      // Skip weekends without touching the trading-day counter.
      continue;
    }
    const i = tradingDay; // retain `i` alias so price/volume formulas below are unchanged
    const dayStr = date.toISOString().slice(0, 10);
    const price = spec.basePrice + i * 0.25;
    bars.push({
      ticker: spec.ticker,
      barDate: dayStr,
      open: price,
      high: price + 1.5,
      low: price - 0.75,
      close: price + 0.5,
      volume: 50_000_000 + i * 100_000,
      sourceId: "finmind-us",
    });
    tradingDay++;
  }
  return bars;
}

const MOCK_US_INSTRUMENT_CATALOG: RawInstrumentInfo[] = MOCK_US_TICKERS.map((spec) => ({
  ticker: spec.ticker,
  name: spec.name,
  // Real provider passes `Country` through `typeRaw`; mock matches the shape.
  typeRaw: "United States",
  industryCategory: spec.subsector,
  date: "2026-05-02",
}));

/**
 * KZO-170 — Mock implementation of `MarketDataProvider` and `InstrumentCatalogProvider`
 * for US, used when `FINMIND_API_TOKEN` is absent (dev/test). Mirrors
 * `MockFinMindMarketDataProvider`'s `calls` field convention so worker tests can
 * inspect the call pattern.
 *
 * Constructor `fixtureStartDate` lets G-CRIT-3 truncation regression tests seed
 * fixtures predating the US `historyStartFor("US")` → asserts the worker truncates
 * to the provider boundary.
 */
export class MockFinMindUsStockMarketDataProvider implements MarketDataProvider, InstrumentCatalogProvider {
  /** KZO-170 D14: same provider identity as the real `FinMindUsStockMarketDataProvider`. */
  readonly providerId = "finmind-us";
  /** KZO-190 — mirrors real `FinMindUsStockMarketDataProvider`; `fetchInstrumentMetadata` no-op. */
  readonly supportsMetadataEnrichment = false;
  readonly calls: Array<{
    method: string;
    ticker?: string;
    query?: string;
    startDate?: string;
    endDate?: string;
    n?: number;
  }> = [];

  private readonly fixtureStartDate: string;

  constructor(opts?: { fixtureStartDate?: string }) {
    this.fixtureStartDate = opts?.fixtureStartDate ?? DEFAULT_FIXTURE_START;
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
    const spec = MOCK_US_TICKERS.find((t) => t.ticker === ticker);
    if (!spec) return [];
    return generateMockUsBars(spec, this.fixtureStartDate);
  }

  /**
   * KZO-170: returns empty — mirrors the real provider exactly. KZO-187 will own
   * US dividend mock fixtures when an alternate provider lands.
   */
  async fetchDividends(ticker: string, startDate?: string, endDate?: string): Promise<DividendRecord[]> {
    this.calls.push({
      method: "fetchDividends",
      ticker,
      ...(startDate ? { startDate } : {}),
      ...(endDate ? { endDate } : {}),
    });
    return [];
  }

  async fetchInstrumentCatalog(): Promise<RawInstrumentInfo[]> {
    this.calls.push({ method: "fetchInstrumentCatalog" });
    return MOCK_US_INSTRUMENT_CATALOG;
  }

  /**
   * KZO-170: returns empty — FinMind v4 has no `USStockDelisting` dataset. Inferring
   * delistings from snapshot-diff is deferred to a follow-up ticket.
   */
  async fetchDelistingHistory(): Promise<RawDelistingRecord[]> {
    this.calls.push({ method: "fetchDelistingHistory" });
    return [];
  }

  /** KZO-172: US mock mirrors the real provider — no-op metadata enrichment. */
  async fetchInstrumentMetadata(ticker: string): Promise<RawInstrumentInfo | null> {
    this.calls.push({ method: "fetchInstrumentMetadata", ticker });
    return null;
  }

  /** KZO-172: US mock mirrors the real provider — no-op per-query search. */
  async searchInstruments(query: string): Promise<RawInstrumentInfo[]> {
    this.calls.push({ method: "searchInstruments", query });
    return [];
  }
}

export { MOCK_US_INSTRUMENT_CATALOG };
