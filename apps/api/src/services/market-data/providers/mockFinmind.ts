import type {
  RawDailyBar,
  DividendRecord,
  RawInstrumentInfo,
  RawDelistingRecord,
  MarketDataProvider,
  InstrumentCatalogProvider,
  MarketDataFetchOptions,
} from "../types.js";

/** Generates deterministic fixture bars for testing. */
function generateMockBars(ticker: string, count: number = 30): RawDailyBar[] {
  const bars: RawDailyBar[] = [];
  const basePrice = 100;
  for (let i = 0; i < count; i++) {
    const date = new Date(Date.UTC(2025, 0, 2 + i)); // Start from 2025-01-02
    const dayStr = date.toISOString().slice(0, 10);
    const price = basePrice + i * 0.5;
    bars.push({
      ticker,
      barDate: dayStr,
      open: price,
      high: price + 2,
      low: price - 1,
      close: price + 1,
      volume: 1_000_000 + i * 10_000,
      sourceId: "finmind",
    });
  }
  return bars;
}

/** Generates deterministic fixture dividend events for testing. */
function generateMockDividends(ticker: string): DividendRecord[] {
  return [
    {
      ticker,
      exDividendDate: "2025-06-15",
      paymentDate: "2025-07-15",
      cashDividendPerShare: 2.5,
      stockDividendPerShare: 0,
      sourceId: "finmind",
    },
    {
      ticker,
      exDividendDate: "2025-12-15",
      paymentDate: "2026-01-15",
      cashDividendPerShare: 3.0,
      stockDividendPerShare: 0.5,
      sourceId: "finmind",
    },
  ];
}

const MOCK_INSTRUMENT_CATALOG: RawInstrumentInfo[] = [
  // STOCK — standard sector
  { ticker: "2330", name: "台積電", typeRaw: "twse", industryCategory: "半導體業", date: "2026-03-31" },
  // STOCK with umbrella duplicate (dedup test)
  { ticker: "2330", name: "台積電", typeRaw: "twse", industryCategory: "電子工業", date: "2026-03-31" },
  // STOCK — different date (dedup test: pick latest)
  { ticker: "2317", name: "鴻海", typeRaw: "twse", industryCategory: "其他電子業", date: "2026-03-31" },
  { ticker: "2317", name: "鴻海", typeRaw: "twse", industryCategory: "電子工業", date: "2026-03-30" },
  // ETF
  { ticker: "0050", name: "元大台灣50", typeRaw: "twse", industryCategory: "ETF", date: "2026-03-31" },
  // BOND_ETF (ticker ends with B)
  { ticker: "00679B", name: "元大美債20年", typeRaw: "twse", industryCategory: "ETF", date: "2026-03-31" },
  // Unmappable — ETN
  { ticker: "020000", name: "富邦臺灣加權ETN", typeRaw: "twse", industryCategory: "指數投資證券(ETN)", date: "2026-03-31" },
  // INDEX/META — should be filtered entirely
  { ticker: "IX0001", name: "加權指數", typeRaw: "twse", industryCategory: "大盤", date: "2026-03-31" },
  { ticker: "IX0099", name: "所有證券", typeRaw: "twse", industryCategory: "所有證券", date: "2026-03-31" },
  // TPEx ETF
  { ticker: "006201", name: "元大富櫃50", typeRaw: "tpex", industryCategory: "上櫃ETF", date: "2026-03-31" },
];

const MOCK_DELISTING_HISTORY: RawDelistingRecord[] = [
  { ticker: "3029", name: "零壹科技", date: "2025-12-01" },
  { ticker: "6245", name: "立端科技", date: "2026-01-15" },
];

/**
 * Mock implementation of `MarketDataProvider` and `InstrumentCatalogProvider` used when
 * `FINMIND_API_TOKEN` is not configured (dev/test). KZO-163: replaces the legacy
 * `MockFinMindClient` — preserves the `calls` field and deterministic fixtures used by tests.
 */
export class MockFinMindMarketDataProvider implements MarketDataProvider, InstrumentCatalogProvider {
  /**
   * KZO-170 D14: same provider identity as the real `FinMindMarketDataProvider`. The mock and
   * real provider are interchangeable behind the registry; sharing `providerId` lets log-based
   * dashboards aggregate uniformly across dev/test/prod regardless of which branch is wired in.
   */
  readonly providerId = "finmind-tw";
  /** KZO-190 — mirrors real `FinMindMarketDataProvider`; `fetchInstrumentMetadata` no-op. */
  readonly supportsMetadataEnrichment = false;
  /** KZO-195 — mirrors real `FinMindMarketDataProvider` capability flag. */
  readonly supportsDelistingFeed = true;
  /** KZO-195 (iter 9) — mirrors real provider. */
  readonly absenceDetectionEnabled = false;
  readonly calls: Array<{ method: string; ticker?: string; query?: string; startDate?: string; endDate?: string; n?: number }> = [];

  /**
   * KZO-163 HIGH-1 fix: mock has no rate limiter, so this is a no-op. We still record the call
   * so tests can assert worker invocations follow the reserve-then-fetch contract.
   */
  reserveCapacity(n: number): void {
    this.calls.push({ method: "reserveCapacity", n });
  }

  async fetchBars(
    ticker: string,
    startDate?: string,
    endDate?: string,
    _options?: MarketDataFetchOptions,
  ): Promise<RawDailyBar[]> {
    this.calls.push({ method: "fetchBars", ticker, ...(startDate ? { startDate } : {}), ...(endDate ? { endDate } : {}) });
    return generateMockBars(ticker);
  }

  async fetchDividends(
    ticker: string,
    startDate?: string,
    endDate?: string,
    _options?: MarketDataFetchOptions,
  ): Promise<DividendRecord[]> {
    this.calls.push({ method: "fetchDividends", ticker, ...(startDate ? { startDate } : {}), ...(endDate ? { endDate } : {}) });
    return generateMockDividends(ticker);
  }

  async fetchInstrumentCatalog(): Promise<RawInstrumentInfo[]> {
    this.calls.push({ method: "fetchInstrumentCatalog" });
    return MOCK_INSTRUMENT_CATALOG;
  }

  async fetchDelistingHistory(): Promise<RawDelistingRecord[]> {
    this.calls.push({ method: "fetchDelistingHistory" });
    return MOCK_DELISTING_HISTORY;
  }

  /** KZO-172: TW mock mirrors the real provider — no-op metadata enrichment. */
  async fetchInstrumentMetadata(ticker: string): Promise<RawInstrumentInfo | null> {
    this.calls.push({ method: "fetchInstrumentMetadata", ticker });
    return null;
  }

  /** KZO-172: TW mock mirrors the real provider — no-op per-query search. */
  async searchInstruments(query: string): Promise<RawInstrumentInfo[]> {
    this.calls.push({ method: "searchInstruments", query });
    return [];
  }
}
