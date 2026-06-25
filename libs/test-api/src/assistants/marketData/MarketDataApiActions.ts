import type { APIResponse } from "@playwright/test";
import { Step } from "@vakwen/test-framework/decorators";
import { ApiBaseActions } from "../../mixins/index.js";
import type { MarketDataEndpoint } from "../../endpoints/MarketDataEndpoint.js";

type TestMarketCode = "TW" | "US" | "AU" | "KR" | "JP";

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
    marketCode: TestMarketCode,
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
  ): Promise<APIResponse> {
    return this._instance.seedDailyBars(bars, this.authHeaders);
  }

  /**
   * KZO-172: canonical 2-arg form for `GET /market-data/search`.
   */
  @Step()
  async searchInstruments(
    q: string,
    marketCode: TestMarketCode,
  ): Promise<APIResponse> {
    return this._instance.searchInstruments(q, marketCode, this.authHeaders);
  }

  /**
   * KZO-172: 1-arg variant — omits `market_code`, used for the 400 regression
   * test that confirms the route requires `market_code`.
   */
  @Step()
  async searchInstrumentsMissingMarketCode(q: string): Promise<APIResponse> {
    return this._instance.searchInstruments(q, undefined, this.authHeaders);
  }

  /**
   * KZO-172: 1-arg variant — omits `q`, used for the 400 regression test that
   * confirms the route requires `q`.
   */
  @Step()
  async searchInstrumentsMissingQuery(marketCode: TestMarketCode): Promise<APIResponse> {
    return this._instance.searchInstruments(undefined, marketCode, this.authHeaders);
  }

  /**
   * KZO-172: reset the per-IP search rate-limit bucket (test-only seam).
   * Used to isolate the 429-after-20-calls assertion from sibling specs that
   * may share the worker.
   */
  @Step()
  async resetSearchRateLimit(): Promise<APIResponse> {
    return this._instance.resetSearchRateLimit(this.authHeaders);
  }
}
