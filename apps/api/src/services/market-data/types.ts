/** Earliest date for TaiwanStockPrice dataset — used as default startDate for full backfill. */
export const HISTORY_START = "1994-10-01";

/** Raw daily OHLCV bar from FinMind TaiwanStockPrice dataset (pre-ingestion shape). */
export interface RawDailyBar {
  ticker: string;
  barDate: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /**
   * Optional provider source identifier. Persistence layer falls back to `'finmind'` when absent
   * (preserves existing rows). KZO-163: every FinMind-sourced bar sets this to `'finmind'`.
   * Future providers (KZO-164 FX, KZO-170 US, KZO-171 AU) will set their own source identifiers.
   */
  sourceId?: string;
}

/** Dividend event from FinMind TaiwanStockDividend dataset. */
export interface DividendRecord {
  ticker: string;
  exDividendDate: string; // YYYY-MM-DD
  paymentDate: string; // YYYY-MM-DD
  cashDividendPerShare: number;
  stockDividendPerShare: number;
  fiscalYearPeriod?: string;
  announcementDate?: string; // YYYY-MM-DD
  totalDistributionShares?: number;
  rawProviderData?: Record<string, unknown>;
  /** Optional provider source identifier; same semantics as `RawDailyBar.sourceId`. */
  sourceId?: string;
}

/** Raw instrument info from FinMind TaiwanStockInfo dataset. */
export interface RawInstrumentInfo {
  ticker: string;
  name: string;
  typeRaw: string;
  industryCategory: string;
  date: string;
}

/** Raw delisting record from FinMind TaiwanStockDelisting dataset. */
export interface RawDelistingRecord {
  ticker: string;
  name: string;
  date: string;
}

/**
 * Generic per-market data provider for daily bars and dividend events. KZO-163 — replaces the
 * monolithic `FinMindProvider` so KZO-164 (FX), KZO-170 (US), KZO-171 (AU) can each plug in a
 * provider without touching call sites. The provider is per-market — no `market` parameter.
 */
export interface MarketDataProvider {
  fetchBars(ticker: string, startDate?: string, endDate?: string): Promise<RawDailyBar[]>;
  fetchDividends(ticker: string, startDate?: string, endDate?: string): Promise<DividendRecord[]>;
  /**
   * Pre-flight check that the provider's rate limiter can accommodate `n` requests in this
   * worker invocation. Throws `RateLimitedError` (with `msUntilAvailable` sized for `n` slots)
   * if not. Check-only — does not consume; subsequent fetch calls each consume one slot.
   *
   * Workers calling more than one fetch method MUST call `reserveCapacity(n)` first to avoid
   * starvation: without it, the first fetch consumes the only newly-freed slot and subsequent
   * fetches re-throw `RateLimitedError` indefinitely under one-slot-at-a-time replenishment.
   * Because the check is for N slots (not 1), the reschedule's `msUntilAvailable(n)` waits
   * for N slots to be free, breaking the deterministic starvation cycle.
   *
   * Residual race: see `FinMindMarketDataProvider.reserveCapacity` JSDoc for the TOCTOU
   * trade-off accepted in the KZO-163 scope.
   *
   * Providers without a rate limiter implement this as a no-op.
   */
  reserveCapacity(n: number): void;
}

/**
 * Generic per-market instrument-catalog provider. KZO-163 — split off from `FinMindProvider`
 * so a single provider class can implement both `MarketDataProvider` and this interface (FinMind
 * does today), or two distinct providers can supply data + catalog independently for a market.
 */
export interface InstrumentCatalogProvider {
  fetchInstrumentCatalog(): Promise<RawInstrumentInfo[]>;
  fetchDelistingHistory(): Promise<RawDelistingRecord[]>;
  /** Same semantics as `MarketDataProvider.reserveCapacity` — pre-flight check, no consume. */
  reserveCapacity(n: number): void;
}

/**
 * KZO-164: per-pair daily FX rate (e.g. USD→TWD on 2026-04-25). Sourced from Frankfurter v2's
 * default-blend route (CBC for TWD, RBA for AUD, ECB fallback). `source` is column-aligned
 * with `market_data.fx_rates.source` (NO fallback in `upsertFxRates` — provider always stamps
 * `'frankfurter'`). Diverges intentionally from `RawDailyBar.sourceId`'s opt-in shape.
 */
export interface FxRate {
  date: string; // YYYY-MM-DD
  baseCurrency: string; // ISO 4217 (3 uppercase letters)
  quoteCurrency: string; // ISO 4217 (3 uppercase letters)
  rate: number;
  source: string; // e.g. 'frankfurter'
}

/**
 * KZO-164: per-base FX-rate provider. Frankfurter is the only provider for v1 — Frankfurter
 * has no quota (verified empirically at 400 requests/<60s with 0× HTTP 429), so
 * `reserveCapacity` is a no-op for the canonical implementation. `quotes` is an optional
 * client-side filter; the underlying API returns ALL quote currencies for the requested base.
 */
export interface FxRateProvider {
  fetchRatesForBase(
    base: string,
    fromDate: string,
    toDate: string,
    quotes?: readonly string[],
  ): Promise<FxRate[]>;
  /** Same shape as `MarketDataProvider.reserveCapacity`. No-op for Frankfurter (no quota). */
  reserveCapacity(n: number): void;
}

/**
 * KZO-164: pg-boss job payload for the `fx-refresh` queue. The cron schedule sends `{}`
 * (no body); `deriveFetchWindow` derives the window from `getLatestFxRateDate()` for cron
 * runs, and reads the body verbatim for manual triggers. `bases` defaults to STORED_QUOTES
 * (`['TWD','USD','AUD']`).
 */
export interface FxRefreshJobData {
  trigger: "cron" | "manual";
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  bases: readonly ("TWD" | "USD" | "AUD")[];
}

/**
 * Typed error thrown by a `MarketDataProvider` / `InstrumentCatalogProvider` when its internal
 * rate limiter denies a request. Workers and routes catch this and reschedule (workers via
 * `boss.send` with `startAfter`) or surface 503 + Retry-After (routes).
 */
export class RateLimitedError extends Error {
  readonly msUntilAvailable: number;

  constructor({ msUntilAvailable }: { msUntilAvailable: number }) {
    super("provider rate limit exceeded");
    this.name = "RateLimitedError";
    this.msUntilAvailable = msUntilAvailable;
  }

  /**
   * Seconds to wait before retrying. Floors at 1 second; treats `NaN`/`Infinity`/negative
   * `msUntilAvailable` as 1 second. Use this everywhere instead of inline arithmetic to keep
   * Retry-After / `boss.send({ startAfter })` values bounded.
   */
  get retryAfterSeconds(): number {
    if (!Number.isFinite(this.msUntilAvailable)) return 1;
    return Math.max(1, Math.ceil(this.msUntilAvailable / 1000));
  }
}
