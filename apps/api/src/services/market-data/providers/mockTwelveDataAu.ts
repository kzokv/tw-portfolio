import type {
  RawInstrumentInfo,
  RawDelistingRecord,
  InstrumentCatalogProvider,
} from "../types.js";

/**
 * KZO-194 — Deterministic Twelve Data AU catalog mock.
 *
 * Mirrors the `MockYahooFinanceAuMarketDataProvider` shape: `calls: Array<{...}>` for
 * test inspection, immutable fixture, delegation to the mock Yahoo provider for
 * `fetchInstrumentMetadata` + `searchInstruments`.
 *
 * **Fixture coverage** — mirrors the real TD response's classifier diversity so the
 * AU classifier branch is exercised end-to-end:
 *
 *   - 1 Common Stock          → AU classifier → STOCK
 *   - 1 ETF                   → AU classifier → ETF (industryCategory stamped to "ETF")
 *   - 1 REIT                  → AU classifier → STOCK
 *   - 1 Preferred Stock       → AU classifier → STOCK
 *   - 1 Depositary Receipt    → AU classifier → STOCK
 *   - 1 Warrant entry         → MUST be filtered out by `fetchInstrumentCatalog`
 *
 * Total catalog rows after filter: 5 (warrant dropped).
 *
 * Tickers chosen to avoid collision with the BHP/CSL/VAS/WBC/AFI/GMG/IMD reserved set
 * used elsewhere — see `.claude/rules/e2e-shared-memory-bars-ticker-hygiene.md`. The
 * mock is consumed by the catalog-sync integration test (`auStockBackfill.integration`
 * case 6) and the QA-owned catalog-sync round-trip test.
 */

interface MockFixtureRow {
  symbol: string;
  name: string;
  /** TD `type` literal (`Common Stock`, `REIT`, etc.) — passed through to industryCategory for /stocks rows. */
  type: string;
  /** Endpoint origin for fixture clarity — `/etf` rows always stamp industryCategory="ETF". */
  endpoint: "stocks" | "etf";
}

/**
 * KZO-194 — fixture rows. The Warrant entry MUST be filtered out by
 * `fetchInstrumentCatalog`; the test asserts on the post-filter row count (5).
 */
const MOCK_TD_AU_FIXTURE: ReadonlyArray<MockFixtureRow> = [
  { symbol: "RIO", name: "Rio Tinto Limited",                       type: "Common Stock",      endpoint: "stocks" },
  { symbol: "STW", name: "SPDR S&P/ASX 200 Fund",                   type: "Common Stock",      endpoint: "etf"    },
  { symbol: "SCG", name: "Scentre Group",                            type: "REIT",              endpoint: "stocks" },
  { symbol: "NABPF", name: "National Australia Bank Preferred",     type: "Preferred Stock",   endpoint: "stocks" },
  { symbol: "RYDAF", name: "Rio Tinto ADR Depositary",              type: "Depositary Receipt", endpoint: "stocks" },
  // Filtered out by the production filter — proves the assertion path.
  { symbol: "RIOWAR", name: "RIO Warrant 2027",                     type: "Warrant",           endpoint: "stocks" },
];

/** Catalog rows that survive the Warrant filter. Used by test assertions. */
export const MOCK_TD_AU_CATALOG_TICKERS: ReadonlyArray<string> = MOCK_TD_AU_FIXTURE
  .filter((row) => row.type !== "Warrant")
  .map((row) => row.symbol);

export interface MockTwelveDataAuCatalogProviderConfig {
  /**
   * Yahoo provider used for metadata + search delegation. Tests pass
   * `MockYahooFinanceAuMarketDataProvider` (so the spy `calls` arrays are inspectable);
   * the registry passes whichever AU Yahoo provider is wired (real or mock). Either
   * satisfies `InstrumentCatalogProvider` so the constructor type is permissive.
   */
  yahooFallback: InstrumentCatalogProvider;
}

export class MockTwelveDataAuCatalogProvider implements InstrumentCatalogProvider {
  /** KZO-170 D14: same provider identity as the real `TwelveDataAuCatalogProvider`. */
  readonly providerId = "twelve-data-au";
  /** KZO-190 — mirrors real provider; delegates to Yahoo's metadata enrichment path. */
  readonly supportsMetadataEnrichment = true;
  readonly calls: Array<{
    method: string;
    ticker?: string;
    query?: string;
    n?: number;
  }> = [];

  private readonly yahooFallback: InstrumentCatalogProvider;
  private _nextSearchError: Error | null = null;

  constructor(config: MockTwelveDataAuCatalogProviderConfig) {
    this.yahooFallback = config.yahooFallback;
  }

  /**
   * KZO-194 — mirrors `MockYahooFinanceAuMarketDataProvider._setNextSearchError`. Inject
   * a single-use error to be thrown by the next `searchInstruments` call so the
   * `/__e2e/inject-search-error` route can exercise the route's 503/Retry-After /
   * `X-Search-Degraded` mapping at the HTTP layer. Auto-clears after the throw so
   * subsequent calls resume the delegation path. KZO-188 originally targeted the Yahoo
   * mock; KZO-194 moved AU catalog ownership to TD, so the seam moved here too.
   */
  _setNextSearchError(err: Error | null): void {
    this._nextSearchError = err;
  }

  reserveCapacity(n: number): void {
    this.calls.push({ method: "reserveCapacity", n });
  }

  async fetchInstrumentCatalog(): Promise<RawInstrumentInfo[]> {
    this.calls.push({ method: "fetchInstrumentCatalog" });
    const today = new Date().toISOString().slice(0, 10);
    const out: RawInstrumentInfo[] = [];
    const etfTickers = new Set<string>();

    for (const row of MOCK_TD_AU_FIXTURE) {
      if (row.endpoint !== "etf") continue;
      etfTickers.add(row.symbol);
      out.push({
        ticker: row.symbol,
        name: row.name,
        typeRaw: "ASX",
        industryCategory: "ETF",
        date: today,
      });
    }

    for (const row of MOCK_TD_AU_FIXTURE) {
      if (row.endpoint !== "stocks") continue;
      if (row.type === "Warrant") continue;
      if (etfTickers.has(row.symbol)) continue;
      out.push({
        ticker: row.symbol,
        name: row.name,
        typeRaw: "ASX",
        industryCategory: row.type,
        date: today,
      });
    }

    return out;
  }

  async fetchDelistingHistory(): Promise<RawDelistingRecord[]> {
    this.calls.push({ method: "fetchDelistingHistory" });
    return [];
  }

  async fetchInstrumentMetadata(ticker: string): Promise<RawInstrumentInfo | null> {
    this.calls.push({ method: "fetchInstrumentMetadata", ticker });
    return this.yahooFallback.fetchInstrumentMetadata(ticker);
  }

  async searchInstruments(query: string): Promise<RawInstrumentInfo[]> {
    this.calls.push({ method: "searchInstruments", query });
    if (this._nextSearchError) {
      const err = this._nextSearchError;
      this._nextSearchError = null;
      throw err;
    }
    return this.yahooFallback.searchInstruments(query);
  }
}
