import type { APIResponse } from "@playwright/test";
import { BaseEndpoint } from "@vakwen/test-framework/core";
import { apiUrl } from "@vakwen/test-framework/shared";

type TestMarketCode = "TW" | "US" | "AU" | "KR" | "JP";

/**
 * KZO-170 (G-NC-6): HTTP-suite endpoint wrapper for `/market-data/price`.
 *
 * The route gains a required `marketCode` query parameter (D2). The previous
 * heuristic `resolveMarketCode(ticker)` is deleted; clients must now pin the
 * market explicitly so the route can route through the per-market provider
 * registry.
 *
 * KZO-172: extended with `searchInstruments` for `GET /market-data/search`.
 * Per `.claude/rules/test-api-mapper-registration.md`, the search route does
 * NOT get its own endpoint class — it lives on the existing `MarketDataEndpoint`
 * so the mapper registration stays untouched.
 */
export class MarketDataEndpoint extends BaseEndpoint {
  /**
   * Look up a single price for `(ticker, date, marketCode)`.
   * `marketCode` is OPTIONAL on the wrapper to enable a 400-shape regression
   * test that confirms the route rejects requests missing it.
   */
  getPrice = (
    ticker: string,
    date: string,
    marketCode?: TestMarketCode,
    headers?: Record<string, string>,
  ): Promise<APIResponse> => {
    const params = new URLSearchParams({ ticker, date });
    if (marketCode !== undefined) {
      params.set("market_code", marketCode);
    }
    return this.request.get(
      apiUrl(`/market-data/price?${params.toString()}`),
      headers !== undefined ? { headers } : {},
    );
  };

  seedDailyBars = (
    bars: {
      ticker: string;
      marketCode?: TestMarketCode;
      barDate: string;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
      source?: string;
      ingestedAt?: string;
    }[],
    headers?: Record<string, string>,
  ): Promise<APIResponse> =>
    this.request.post(apiUrl("/__e2e/seed-daily-bars"), {
      data: { bars },
      ...(headers ? { headers } : {}),
    });

  /**
   * KZO-172: search instruments via `GET /market-data/search?q=...&market_code=...`.
   *
   * Both `q` and `marketCode` are OPTIONAL on the wrapper to enable the 400-shape
   * regression cases (missing `market_code`, missing `q`, etc.). Suspicious raw
   * strings (whitespace-only, regex mismatch) are passed through verbatim — the
   * route's Zod schema is the validation gate under test.
   */
  searchInstruments = (
    q?: string,
    marketCode?: TestMarketCode,
    headers?: Record<string, string>,
  ): Promise<APIResponse> => {
    const params = new URLSearchParams();
    if (q !== undefined) {
      params.set("q", q);
    }
    if (marketCode !== undefined) {
      params.set("market_code", marketCode);
    }
    const qs = params.toString();
    return this.request.get(
      apiUrl(`/market-data/search${qs ? `?${qs}` : ""}`),
      headers !== undefined ? { headers } : {},
    );
  };

  /**
   * KZO-172: test-only reset for the per-IP search rate-limit bucket. Mirrors
   * `_resetMarketDataPriceBuckets`. Backend exposes `POST /__e2e/reset-market-data-search-rate-limit`
   * (or the test calls the `_reset*` helper directly via `vi`-style invocation
   * — out of band for HTTP specs).
   */
  resetSearchRateLimit = (
    headers?: Record<string, string>,
  ): Promise<APIResponse> =>
    this.request.post(apiUrl("/__e2e/reset-market-data-search-rate-limit"), {
      data: {},
      ...(headers ? { headers } : {}),
    });
}
