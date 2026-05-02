import type { APIResponse } from "@playwright/test";
import { BaseEndpoint } from "@tw-portfolio/test-framework/core";
import { apiUrl } from "@tw-portfolio/test-framework/shared";

/**
 * KZO-170 (G-NC-6): HTTP-suite endpoint wrapper for `/market-data/price`.
 *
 * The route gains a required `marketCode` query parameter (D2). The previous
 * heuristic `resolveMarketCode(ticker)` is deleted; clients must now pin the
 * market explicitly so the route can route through the per-market provider
 * registry.
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
    marketCode?: "TW" | "US" | "AU",
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
      marketCode?: "TW" | "US" | "AU";
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
}
