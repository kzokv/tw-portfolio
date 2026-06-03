import type { MarketCode } from "@vakwen/domain";
import type { AccountDefaultCurrency } from "@vakwen/shared-types";

/**
 * KZO-170 D7 — Per-market backfill history start map.
 *
 * Earliest date the upstream provider serves daily bars for the given market.
 * `backfillWorker.effectiveStartDate` reads from this map (via `historyStartFor`)
 * and truncates any caller-supplied `startDate` that predates the provider's
 * earliest available bar. Replaces the previous single-market `HISTORY_START`
 * constant which was TW-only (pre-KZO-170, the codebase had no other market).
 *
 * - TW: `1994-10-01` — FinMind TaiwanStockPrice earliest bar.
 * - US: `2019-06-01` — FinMind USStockPrice earliest bar (verified 2026-05-02 via
 *   the Phase 1 verification curl; FinMind v4 returns 200 for `start_date >= 2019-06-01`).
 * - AU: `1988-01-28` — Yahoo Finance `chart()` earliest available bar for BHP.AX
 *   (KZO-171 spike §8 verified 2026-05-02 via `meta.firstTradeDate`). Pre-1988 trade
 *   dates get truncated with `pre_provider_history_truncated`, mirroring KZO-170 D13.
 *   Per-ticker floors above this (e.g. VAS listed 2009) are handled natively — Yahoo
 *   returns the available subrange when `period1` predates listing.
 * - KR: `2000-01-04` — Yahoo Finance `chart()` earliest observed daily bar boundary
 *   for 005930.KS during the KR provider spike. Per-ticker floors above this are
 *   handled natively by Yahoo.
 */
export const HISTORY_START_BY_MARKET: Record<MarketCode, string> = {
  TW: "1994-10-01",
  US: "2019-06-01",
  AU: "1988-01-28",
  KR: "2000-01-04",
};

/**
 * KZO-170 D7 — Helper for `HISTORY_START_BY_MARKET` lookups.
 *
 * Returns the canonical earliest bar date for the given market. Use everywhere
 * the worker / provider previously referenced the bare `HISTORY_START` constant
 * so the lookup always reflects the per-market truth.
 */
export function historyStartFor(marketCode: MarketCode): string {
  const start = HISTORY_START_BY_MARKET[marketCode];
  if (!start) {
    throw new Error(`unsupported_market_for_history_start: ${marketCode}`);
  }
  return start;
}

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

export type MarketDataResolverMode = "chart_probe_v1" | "quote_first";

export interface MarketDataFetchOptions {
  resolverMode?: MarketDataResolverMode;
}

export interface ProviderSymbolVerificationResult {
  verified: boolean;
  checkedSymbol: string;
  resolverMode: MarketDataResolverMode;
  reason?: string;
}

/** Raw instrument info from FinMind TaiwanStockInfo dataset. */
export interface RawInstrumentInfo {
  ticker: string;
  name: string;
  typeRaw: string;
  industryCategory: string;
  date: string;
  catalogExchangeRaw?: string | null;
  catalogMicCode?: string | null;
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
  /**
   * KZO-170 D14 — Stable provider identity for log enrichment. Workers stamp this on every
   * fetch-failure log line so observability can disambiguate per-provider failure modes
   * (e.g. `finmind-tw` rate-limit pattern vs. `finmind-us` 422-on-bad-ticker pattern).
   * Must be unique across providers; no two providers in the registry may share the same id.
   * Conventional values: `finmind-tw`, `finmind-us`, `frankfurter`, plus mock variants under
   * the same id (the mock and real provider share an id by design — they are interchangeable
   * implementations of the same logical provider, observable via the configured branch).
   */
  readonly providerId: string;
  fetchBars(
    ticker: string,
    startDate?: string,
    endDate?: string,
    options?: MarketDataFetchOptions,
  ): Promise<RawDailyBar[]>;
  fetchDividends(
    ticker: string,
    startDate?: string,
    endDate?: string,
    options?: MarketDataFetchOptions,
  ): Promise<DividendRecord[]>;
  /**
   * Optional provider-specific verifier for admin repair tooling. Used before
   * persisting durable provider-resolution bindings so a catalog hint is never
   * treated as provider truth by itself.
   */
  verifyResolvedSymbol?(
    ticker: string,
    candidateSymbol: string,
    options?: MarketDataFetchOptions,
  ): Promise<ProviderSymbolVerificationResult>;
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
 *
 * KZO-172 (REVISIT-1) — added `fetchInstrumentMetadata` and `searchInstruments` for the
 * AU bounded-catalog path. TW/US implement these as no-ops (their full catalog dump via
 * `fetchInstrumentCatalog` is comprehensive; per-ticker enrichment is unnecessary).
 */
export interface InstrumentCatalogProvider {
  /** Same semantics as `MarketDataProvider.providerId`. KZO-170 D14. */
  readonly providerId: string;
  fetchInstrumentCatalog(): Promise<RawInstrumentInfo[]>;
  fetchDelistingHistory(): Promise<RawDelistingRecord[]>;
  /**
   * KZO-172 — per-ticker metadata enrichment at the provider boundary. Yahoo's AU provider
   * implements via `quote(symbol)` → `{ longName, quoteType }`. TW/US implement as
   * `async () => null` because their full-catalog dump from `fetchInstrumentCatalog` already
   * covers every monitored instrument; enriching per ticker would re-spend budget redundantly.
   *
   * Returns `null` when the upstream has no record (delisted, mistyped) or when the call
   * fails non-recoverably. Callers should warn-and-continue on `null`. Throws
   * `RateLimitedError` when the per-provider budget is exhausted (per
   * `.claude/rules/typed-transient-error-catch-audit.md`, callers MUST re-throw).
   */
  fetchInstrumentMetadata(ticker: string): Promise<RawInstrumentInfo | null>;
  /**
   * KZO-172 — per-query symbol-search affordance for the `/market-data/search` autocomplete.
   * Yahoo's AU provider implements via `search(query, { region: "AU" })` and double-filters
   * for ASX. TW/US implement as `async () => []` because their UI uses the persisted
   * catalog dump rather than per-query upstream search.
   *
   * Throws `RateLimitedError` on per-provider budget exhaustion; the route catches and maps
   * to 503 + Retry-After.
   */
  searchInstruments(query: string): Promise<RawInstrumentInfo[]>;
  /**
   * KZO-190 — true iff this provider's `fetchInstrumentMetadata` consumes a slot from
   * the rate limiter when called. Used by `backfillWorker.ts` to right-size
   * `reserveCapacity`. AU's Yahoo-backed `fetchInstrumentMetadata` is a real `quote()`
   * call → true. FinMind TW/US are no-ops returning null → false.
   */
  readonly supportsMetadataEnrichment: boolean;
  /**
   * KZO-195 — true iff this provider's `fetchDelistingHistory()` returns
   * authoritative provider-feed delistings. When `false`, callers (i.e.
   * `runCatalogSync`) MUST use the diff-based absence detector instead of
   * trusting the empty/stub list. FinMind TW = `true`; FinMind US, Yahoo AU,
   * Twelve Data AU = `false` (AU has no upstream delisting feed; US flips on
   * via this same flag in a follow-up ticket).
   */
  readonly supportsDelistingFeed: boolean;
  /**
   * KZO-195 (iter 9 / Codex P1) — true iff the absence-based delisting
   * detector should be wired in for this provider's catalog syncs. Independent
   * of `supportsDelistingFeed`: a provider may have neither a feed nor
   * absence detection (third branch — bare upsert with no detection state),
   * a feed only, or absence detection only. Today only `TwelveDataAuCatalogProvider`
   * sets this `true`; FinMind providers and Yahoo AU set `false` so a fresh
   * catalog sync doesn't accidentally stamp `last_seen_in_catalog_at` for
   * markets the AU detector wasn't designed to govern.
   */
  readonly absenceDetectionEnabled: boolean;
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
  /** Same semantics as `MarketDataProvider.providerId`. KZO-170 D14. */
  readonly providerId: string;
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
 * (`['TWD','USD','AUD','KRW']`).
 */
export interface FxRefreshJobData {
  trigger: "cron" | "manual";
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  bases: readonly AccountDefaultCurrency[];
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
