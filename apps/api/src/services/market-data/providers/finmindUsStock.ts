import { historyStartFor } from "../types.js";
import { getEffectiveFinmindApiToken } from "../../appConfig/providerKeys.js";
import { getEffectiveBackfillFinmind402RetryMs } from "../../appConfig/backfill.js";
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

interface FinMindResponse<T> {
  msg: string;
  status: number;
  data: T[];
}

/**
 * KZO-170 — FinMind v4 `USStockPrice` row shape. Verified 2026-05-02 via Phase-1
 * verification curl. Per-row keys are case-sensitive: `Adj_Close`, `Close`, `High`,
 * `Low`, `Open`, `Volume`. The provider stores the **unadjusted** `Close` for parity
 * with the TW provider (which stores unadjusted close from `TaiwanStockPrice`).
 *
 * `Adj_Close` is exposed by FinMind but intentionally not stored — KZO-186 (splits)
 * is the canonical place to design adjustment policy across the codebase.
 */
interface FinMindUsPriceRow {
  date: string;
  stock_id: string;
  Adj_Close: number;
  Close: number;
  High: number;
  Low: number;
  Open: number;
  Volume: number;
}

/**
 * KZO-170 — FinMind v4 `USStockInfo` row shape. Verified 2026-05-02 via Phase-1
 * verification curl. Per-row keys are case-sensitive. The classification field is
 * `Subsector` (free text); the provider passes it through to `RawInstrumentInfo`'s
 * `industryCategory` field, where the per-market `classifyInstrument(...)` branch
 * routes through the US allow-list rather than substring-scanning the free text.
 *
 * Sample `Subsector` values observed in the Phase-1 catalog dump (~9000 rows):
 * `"Computer Manufacturing"` (AAPL), `"Aluminum"`, `"Biotechnology: Laboratory
 * Analytical Instruments"`, `"EDPServices"`, `"Blank Checks"`, `"Other Consumer
 * Services"`, `"n/a"`. No clean `"ETF"` / `"Bond ETF"` token visible — substring
 * matching against `Subsector` produces zero ETF classifications, hence the
 * curated allow-list strategy.
 */
interface FinMindUsInstrumentRow {
  date: string;
  stock_id: string;
  Country: string;
  IPOYear: number;
  MarketCap: number;
  Subsector: string;
  stock_name: string;
}

export interface FinMindUsStockMarketDataProviderConfig {
  token: string;
  baseUrl: string;
  rateLimiter: RateLimiter;
}

/**
 * KZO-170 — FinMind US-stock provider. Implements `MarketDataProvider` (price only;
 * `fetchDividends() => []`) and `InstrumentCatalogProvider` (catalog only;
 * `fetchDelistingHistory() => []`). Datasets actually called: `USStockPrice` +
 * `USStockInfo`.
 *
 * **Why empty dividends + delistings:**
 * Phase-1 verification (2026-05-02) confirmed FinMind v4 has NO `USStockDividend`
 * and NO `USStockDelisting` datasets — both 422-reject as enum-invalid. KZO-187
 * tracks US dividend ingestion via an alternate provider (Yahoo Finance /
 * Alpha Vantage / manual entry). Delisting detection via `USStockInfo` snapshot
 * diffs is a future-work item; the empty `fetchDelistingHistory()` is the
 * load-bearing degenerate that keeps `runCatalogSync` working without authoritative
 * delistings.
 *
 * Shares the FinMind rate limiter with `FinMindMarketDataProvider` (TW): both
 * dispatch against the single `FINMIND_RATE_LIMIT_PER_HOUR` budget. The registry
 * threads the same `RateLimiter` instance through both providers.
 */
export class FinMindUsStockMarketDataProvider implements MarketDataProvider, InstrumentCatalogProvider {
  /** KZO-170 D14: stable provider identity for log enrichment. */
  readonly providerId = "finmind-us";
  /** KZO-190 — `fetchInstrumentMetadata` is a no-op returning null; consumes no slot. */
  readonly supportsMetadataEnrichment = false;
  /**
   * KZO-195 — FinMind US has no delisting dataset today; `fetchDelistingHistory()`
   * returns []. Flag is wired so US can flip to absence-based detection via a
   * follow-up ticket without touching the orchestrator.
   */
  readonly supportsDelistingFeed = false;
  /** KZO-195 (iter 9) — US absence detection deferred to a follow-up ticket. */
  readonly absenceDetectionEnabled = false;
  /** Bootstrap token from constructor config; KZO-198 resolver reads override per fetch. */
  private readonly bootstrapToken: string;
  private readonly baseUrl: string;
  private readonly rateLimiter: RateLimiter;

  constructor(config: FinMindUsStockMarketDataProviderConfig) {
    this.bootstrapToken = config.token;
    this.baseUrl = config.baseUrl;
    this.rateLimiter = config.rateLimiter;
  }

  /**
   * KZO-198: live token (DB override → env → bootstrap). See `finmind.ts` peer.
   */
  private get token(): string {
    return getEffectiveFinmindApiToken() ?? this.bootstrapToken;
  }

  /**
   * Conservative recovery delay when FinMind returns HTTP 402 (rate limit). Mirrors
   * `FinMindMarketDataProvider.REMOTE_402_RETRY_MS` semantics — 60s outwaits minor
   * drift between our internal sliding window and FinMind's server-side counter.
   */
  private static readonly REMOTE_402_RETRY_MS = 60_000;

  private assertCanConsume(): void {
    if (!this.rateLimiter.canConsume(1)) {
      throw new RateLimitedError({ msUntilAvailable: this.rateLimiter.msUntilAvailable(1) });
    }
    this.rateLimiter.consume(1);
  }

  /**
   * Pre-flight check — same semantics as `FinMindMarketDataProvider.reserveCapacity(n)`.
   * Check-only; does NOT consume. Workers calling more than one fetch must call this
   * first so multi-call invocations don't starve under one-slot-at-a-time replenishment.
   */
  reserveCapacity(n: number): void {
    if (!this.rateLimiter.canConsume(n)) {
      throw new RateLimitedError({ msUntilAvailable: this.rateLimiter.msUntilAvailable(n) });
    }
  }

  private async fetchDataset<T>(
    dataset: string,
    ticker: string,
    startDate: string = historyStartFor("US"),
    endDate?: string,
  ): Promise<T[]> {
    const params = new URLSearchParams({
      dataset,
      data_id: ticker,
      start_date: startDate,
      token: this.token,
    });
    if (endDate) {
      params.set("end_date", endDate);
    }

    const res = await fetch(`${this.baseUrl}?${params.toString()}`);
    if (res.status === 402) {
      throw new RateLimitedError({ msUntilAvailable: getEffectiveBackfillFinmind402RetryMs() });
    }
    if (!res.ok) {
      throw new Error(`FinMind API error: ${res.status} ${res.statusText}`);
    }

    const body = (await res.json()) as FinMindResponse<T>;
    if (body.status !== 200) {
      throw new Error(`FinMind API returned status ${body.status}: ${body.msg}`);
    }
    return body.data;
  }

  private async fetchCatalogDataset<T>(dataset: string): Promise<T[]> {
    const params = new URLSearchParams({ dataset, token: this.token });

    const res = await fetch(`${this.baseUrl}?${params.toString()}`);
    if (res.status === 402) {
      throw new RateLimitedError({ msUntilAvailable: getEffectiveBackfillFinmind402RetryMs() });
    }
    if (!res.ok) {
      throw new Error(`FinMind API error: ${res.status} ${res.statusText}`);
    }

    const body = (await res.json()) as FinMindResponse<T>;
    if (body.status !== 200) {
      throw new Error(`FinMind API returned status ${body.status}: ${body.msg}`);
    }
    return body.data;
  }

  async fetchBars(ticker: string, startDate?: string, endDate?: string): Promise<RawDailyBar[]> {
    this.assertCanConsume();
    const rows = await this.fetchDataset<FinMindUsPriceRow>("USStockPrice", ticker, startDate, endDate);
    return rows.map((r) => ({
      ticker: r.stock_id,
      barDate: r.date,
      open: r.Open,
      high: r.High,
      low: r.Low,
      // KZO-170: unadjusted `Close` for parity with TW. `Adj_Close` is exposed by FinMind
      // but intentionally not stored — KZO-186 (splits) owns the adjustment policy decision.
      close: r.Close,
      volume: r.Volume,
      sourceId: "finmind-us",
    }));
  }

  /**
   * KZO-170: returns empty. FinMind v4 does NOT expose a `USStockDividend` dataset
   * (Phase-1 verification 2026-05-02 — 422 enum-rejected). KZO-187 tracks US dividend
   * ingestion via an alternate provider (Yahoo Finance / Alpha Vantage / manual entry).
   * Replay-position-history invariant 5 is a no-op when the dividend set is empty.
   */
  async fetchDividends(_ticker: string, _startDate?: string, _endDate?: string): Promise<DividendRecord[]> {
    return [];
  }

  async fetchInstrumentCatalog(): Promise<RawInstrumentInfo[]> {
    this.assertCanConsume();
    const rows = await this.fetchCatalogDataset<FinMindUsInstrumentRow>("USStockInfo");
    // FinMind's USStockInfo carries multiple snapshot dates per ticker. Pass through
    // raw rows; `deduplicateInstruments(...)` in `catalogSync.ts` collapses duplicates
    // by latest date (same logic as TW's `TaiwanStockInfo` handling).
    return rows.map((r) => ({
      ticker: r.stock_id,
      name: r.stock_name,
      // The FinMind US response has no separate `type` field analogous to TW's `type`
      // (`twse`/`tpex`); use `Country` as the closest analog so downstream logs preserve
      // the provenance. `industry_category` ↔ `Subsector` is the load-bearing classifier
      // input — see `classifyInstrument(industryCategory, ticker, "US")`.
      typeRaw: r.Country,
      industryCategory: r.Subsector,
      date: r.date,
    }));
  }

  /**
   * KZO-170: returns empty. FinMind v4 does NOT expose a `USStockDelisting` dataset
   * (Phase-1 verification 2026-05-02 — 422 enum-rejected). Inferring delistings from
   * `USStockInfo` snapshot-diff is deferred to a follow-up ticket.
   */
  async fetchDelistingHistory(): Promise<RawDelistingRecord[]> {
    return [];
  }

  /**
   * KZO-172: no-op for US. The full `USStockInfo` dump from `fetchInstrumentCatalog`
   * already covers ~9000 instruments — per-ticker enrichment would re-spend the
   * shared FinMind 600/hr budget redundantly. The interface method exists only for
   * AU's bounded-catalog Yahoo path (KZO-172 REVISIT-1).
   */
  async fetchInstrumentMetadata(_ticker: string): Promise<RawInstrumentInfo | null> {
    return null;
  }

  /**
   * KZO-172: no-op for US. The web UI's instrument search reads from the persisted
   * catalog (populated by daily `catalog-sync` cron), not from a per-query upstream
   * search. Yahoo's AU provider exposes a real `searchInstruments` because no full
   * ASX enumeration is available (spike §6).
   */
  async searchInstruments(_query: string): Promise<RawInstrumentInfo[]> {
    return [];
  }
}
