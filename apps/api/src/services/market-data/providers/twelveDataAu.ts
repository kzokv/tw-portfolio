import type {
  RawInstrumentInfo,
  RawDelistingRecord,
  InstrumentCatalogProvider,
} from "../types.js";
import { RateLimitedError } from "../types.js";
import type { RateLimiter } from "../rateLimiter.js";

/**
 * KZO-194 — Twelve Data row shape for `/stocks?exchange=ASX` (verified 2026-05-07).
 *
 * The free-tier `/stocks` endpoint enumerates the full ASX equity universe (~2,013 rows
 * including warrants). Per-row keys are camelCase strings as documented; `mic_code` is
 * the canonical ISO 10383 market-identifier code — `XASX` for primary ASX listings.
 *
 * `type` carries TD's classifier literal: `Common Stock`, `REIT`, `Preferred Stock`,
 * `Depositary Receipt`, `Warrant`, etc. The provider passes this through verbatim to
 * `RawInstrumentInfo.industryCategory`; Warrants are filtered at ingestion (scope-todo
 * decision 17). The AU branch of `classifyInstrument(...)` reads this value to derive
 * the `instrument_type` enum stored in `market_data.instruments`.
 */
interface TwelveDataStockRow {
  symbol: string;
  name: string;
  currency: string;
  exchange: string;
  mic_code: string;
  country: string;
  type: string;
}

/**
 * KZO-194 — Twelve Data row shape for `/etf?exchange=ASX` (verified 2026-05-07).
 *
 * The `/etf` endpoint returns ASX-listed ETFs only (~449 rows including VAS). The
 * response shape matches `/stocks` minus the `type` field (TD does not classify ETFs
 * by sub-type at this endpoint). The provider stamps `industryCategory = "ETF"` on
 * every `/etf` row to drive the AU classifier's ETF branch.
 */
interface TwelveDataEtfRow {
  symbol: string;
  name: string;
  currency: string;
  exchange: string;
  mic_code: string;
  country: string;
}

/** KZO-194 — common envelope shape for both `/stocks` and `/etf` endpoints. */
interface TwelveDataListResponse<T> {
  data: T[];
  status: string;
}

export interface TwelveDataAuCatalogProviderConfig {
  apiKey: string;
  baseUrl: string;
  rateLimiter: RateLimiter;
  /**
   * Yahoo provider used to back `fetchInstrumentMetadata` and `searchInstruments`.
   * The TD bulk catalog does not cover LICs / closed-end funds (e.g. AFI), and TD's
   * autocomplete / per-ticker quote endpoints are paywalled. Yahoo fills the gap;
   * the registry constructs the same Yahoo provider instance for both `marketData["AU"]`
   * (bars + dividends) and as the fallback here.
   */
  yahooFallback: InstrumentCatalogProvider;
}

/**
 * KZO-194 — Twelve Data ASX catalog provider.
 *
 * Implements `InstrumentCatalogProvider` only (NOT `MarketDataProvider`). Owns ASX-wide
 * instrument enumeration via TD's free-tier `/stocks?exchange=ASX` and
 * `/etf?exchange=ASX` endpoints; Yahoo retains bars / dividends / metadata / search.
 *
 * **Composition.** Constructor accepts a `yahooFallback: InstrumentCatalogProvider` and
 * delegates `fetchInstrumentMetadata` + `searchInstruments` to it. This keeps per-ticker
 * enrichment (LICs, hand-added tickers) and autocomplete working without paying for TD's
 * Pro tier ($229/mo).
 *
 * **Rate limiting.** Free tier = 8 req/min (per scope-todo). The provider has its own
 * `RateLimiter` instance — separate from FinMind's 600/hr and Yahoo's 60/min budgets.
 * `fetchInstrumentCatalog()` consumes 2 slots (one per endpoint). Delegate methods do
 * NOT consume from this limiter — Yahoo's own limiter applies there.
 *
 * **Defensive validation.** Every row's `mic_code` is asserted against `"XASX"` (primary
 * ASX). A mismatch throws a detailed `Error("twelve_data_au_mic_mismatch: ...")` so a
 * silent regression in TD's filtering surfaces immediately rather than polluting the
 * catalog. Warrants (`type === "Warrant"`) are filtered out per scope-todo decision 17.
 *
 * **Cross-endpoint dedup.** A ticker present in both `/stocks` and `/etf` is treated as
 * an ETF (the `/stocks` row is dropped). This handles TD's occasional double-listing
 * where an ETF also appears as Common Stock.
 *
 * Per `.claude/rules/typed-transient-error-catch-audit.md`, `RateLimitedError` thrown by
 * `assertCanConsume` / the Yahoo delegate path MUST propagate. Delegate methods do not
 * wrap `yahooFallback.fetchInstrumentMetadata` / `searchInstruments` in try/catch — any
 * `RateLimitedError` from Yahoo's limiter escapes unaltered.
 *
 * @see docs/004-notes/kzo-194/scope-todo-202605071412-locked.md
 */
export class TwelveDataAuCatalogProvider implements InstrumentCatalogProvider {
  /** KZO-170 D14 convention: stable provider identity for log enrichment. */
  readonly providerId = "twelve-data-au";
  /**
   * KZO-190 — `fetchInstrumentMetadata` delegates to Yahoo, which performs a real
   * `quote()` call → returns enriched metadata. The catalog handler in
   * `backfillWorker.ts` reads this flag to right-size `reserveCapacity`.
   */
  readonly supportsMetadataEnrichment = true;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly rateLimiter: RateLimiter;
  private readonly yahooFallback: InstrumentCatalogProvider;

  constructor(config: TwelveDataAuCatalogProviderConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl;
    this.rateLimiter = config.rateLimiter;
    this.yahooFallback = config.yahooFallback;
  }

  private assertCanConsume(): void {
    if (!this.rateLimiter.canConsume(1)) {
      throw new RateLimitedError({ msUntilAvailable: this.rateLimiter.msUntilAvailable(1) });
    }
    this.rateLimiter.consume(1);
  }

  /**
   * Pre-flight check — same semantics as `YahooFinanceAuMarketDataProvider.reserveCapacity(n)`.
   * Check-only; does NOT consume. `fetchInstrumentCatalog()` calls this with `n=2` before
   * the two endpoint calls so the second call doesn't starve under one-slot-at-a-time
   * replenishment.
   */
  reserveCapacity(n: number): void {
    if (!this.rateLimiter.canConsume(n)) {
      throw new RateLimitedError({ msUntilAvailable: this.rateLimiter.msUntilAvailable(n) });
    }
  }

  private async fetchListEndpoint<T>(path: "stocks" | "etf"): Promise<T[]> {
    const params = new URLSearchParams({
      exchange: "ASX",
      apikey: this.apiKey,
    });
    const res = await fetch(`${this.baseUrl}/${path}?${params.toString()}`);
    if (res.status === 429) {
      // Twelve Data signals upstream rate-limit exhaustion via 429. Map to our typed
      // transient error so the caller (catalog-sync worker) reschedules instead of
      // propagating a generic 5xx. Conservative 60s recovery mirrors the FinMind
      // 402 pattern in `finmindUsStock.ts`.
      throw new RateLimitedError({ msUntilAvailable: 60_000 });
    }
    if (!res.ok) {
      throw new Error(`Twelve Data API error: ${res.status} ${res.statusText}`);
    }
    const body = (await res.json()) as TwelveDataListResponse<T>;
    if (body.status && body.status !== "ok") {
      throw new Error(`Twelve Data API returned status ${body.status}`);
    }
    return body.data;
  }

  /**
   * KZO-194 — fetch ASX universe via `/stocks` + `/etf`, dedup, filter, map.
   *
   * Sequential calls (not parallel) — both endpoints share the same 8 req/min budget,
   * and back-to-back consumption keeps the limiter accounting straightforward.
   */
  async fetchInstrumentCatalog(): Promise<RawInstrumentInfo[]> {
    this.reserveCapacity(2);
    const today = new Date().toISOString().slice(0, 10);

    this.assertCanConsume();
    const stocksRaw = await this.fetchListEndpoint<TwelveDataStockRow>("stocks");

    // Validate /stocks MIC codes BEFORE the /etf call — fail fast on a regression in
    // TD's filtering so we don't waste the second slot. Mirrors the QA test
    // "throws on mic_code mismatch before any /etf call fires".
    for (const row of stocksRaw) {
      if (row.mic_code !== "XASX") {
        throw new Error(
          `twelve_data_au_mic_mismatch: /stocks row ${row.symbol} has mic_code='${row.mic_code}', expected 'XASX'`,
        );
      }
    }

    this.assertCanConsume();
    const etfsRaw = await this.fetchListEndpoint<TwelveDataEtfRow>("etf");

    // ETF tickers win the dedup race — collect them first so /stocks rows can skip
    // duplicates by membership check.
    const etfTickers = new Set<string>();
    const out: RawInstrumentInfo[] = [];

    for (const row of etfsRaw) {
      if (row.mic_code !== "XASX") {
        throw new Error(
          `twelve_data_au_mic_mismatch: /etf row ${row.symbol} has mic_code='${row.mic_code}', expected 'XASX'`,
        );
      }
      etfTickers.add(row.symbol);
      out.push({
        ticker: row.symbol,
        name: row.name,
        typeRaw: "ASX",
        industryCategory: "ETF",
        date: today,
      });
    }

    for (const row of stocksRaw) {
      // Filter warrants per scope-todo decision 17 — TD enumerates them but the AU
      // classifier doesn't model warrants and the upstream UI does not surface them.
      if (row.type === "Warrant") continue;
      // Cross-endpoint dedup: prefer the /etf classification when the ticker appeared
      // in both endpoints.
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

  /**
   * KZO-194 — TD does not expose AU delisting reference data. Yahoo doesn't either
   * (KZO-172 spike §5). Inferring delistings from cross-snapshot diffs is deferred
   * to KZO-195.
   */
  async fetchDelistingHistory(): Promise<RawDelistingRecord[]> {
    return [];
  }

  /**
   * KZO-194 — delegate to Yahoo. TD's per-ticker quote endpoint is paywalled (Pro tier),
   * and Yahoo's `quote()` already returns the enriched metadata used by the AU classifier.
   *
   * Per `.claude/rules/typed-transient-error-catch-audit.md`, `RateLimitedError` thrown
   * by Yahoo's limiter MUST propagate. The delegation here does not wrap the call in a
   * try/catch — any error escapes unaltered.
   */
  async fetchInstrumentMetadata(ticker: string): Promise<RawInstrumentInfo | null> {
    return this.yahooFallback.fetchInstrumentMetadata(ticker);
  }

  /**
   * KZO-194 — delegate to Yahoo. TD's autocomplete is paywalled; Yahoo's `search()` with
   * `region: "AU"` already powers the existing AU search affordance.
   *
   * Per `.claude/rules/typed-transient-error-catch-audit.md`, `RateLimitedError` and any
   * other Yahoo error escape unaltered — the route layer maps `RateLimitedError` to 503
   * + `Retry-After`, and other errors to 503 + `X-Search-Degraded: true`.
   */
  async searchInstruments(query: string): Promise<RawInstrumentInfo[]> {
    return this.yahooFallback.searchInstruments(query);
  }
}
