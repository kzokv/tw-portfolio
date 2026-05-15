import type { APIResponse } from "@playwright/test";
import { Step } from "@vakwen/test-framework/decorators";
import { ApiBaseActions } from "../../mixins/index.js";
import type { QuotesEndpoint } from "../../endpoints/QuotesEndpoint.js";

export class QuotesApiActions extends ApiBaseActions {
  declare protected readonly _instance: QuotesEndpoint;

  @Step()
  async getQuotes(tickers: string[]): Promise<APIResponse> {
    return this._instance.getQuotes(tickers, this.authHeaders);
  }

  /** Makes the request without auth headers — used for 401 assertions. */
  @Step()
  async getQuotesUnauthenticated(tickers: string[]): Promise<APIResponse> {
    return this._instance.getQuotes(tickers, { cookie: "" });
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
    }[],
  ): Promise<APIResponse> {
    return this._instance.seedDailyBars(bars, this.authHeaders);
  }
}
