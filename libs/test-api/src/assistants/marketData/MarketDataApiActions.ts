import type { APIResponse } from "@playwright/test";
import { Step } from "@tw-portfolio/test-framework/decorators";
import { ApiBaseActions } from "../../mixins/index.js";
import type { MarketDataEndpoint } from "../../endpoints/MarketDataEndpoint.js";

/**
 * KZO-170 (G-NC-6): actions wrapper for `/market-data/price`.
 *
 * Exposes both the canonical `(ticker, date, marketCode)` 3-arg form and a
 * `getPriceMissingMarketCode(...)` 2-arg form for the 400-shape regression.
 */
export class MarketDataApiActions extends ApiBaseActions {
  declare protected readonly _instance: MarketDataEndpoint;

  @Step()
  async getPrice(
    ticker: string,
    date: string,
    marketCode: "TW" | "US" | "AU",
  ): Promise<APIResponse> {
    return this._instance.getPrice(ticker, date, marketCode, this.authHeaders);
  }

  /**
   * Hits `/market-data/price?ticker=...&date=...` WITHOUT a `marketCode` query
   * param. Used to regression-test the route's required-param Zod check (400).
   */
  @Step()
  async getPriceMissingMarketCode(ticker: string, date: string): Promise<APIResponse> {
    return this._instance.getPrice(ticker, date, undefined, this.authHeaders);
  }

  @Step()
  async seedDailyBars(
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
  ): Promise<APIResponse> {
    return this._instance.seedDailyBars(bars, this.authHeaders);
  }
}
