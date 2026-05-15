import type { APIResponse } from "@playwright/test";
import { Step } from "@vakwen/test-framework/decorators";
import { ApiBaseActions, headersForCookie } from "../../mixins/index.js";
import type { AdminInstrumentsEndpoint } from "../../endpoints/AdminInstrumentsEndpoint.js";

/**
 * KZO-195 — actions wrapper for `/admin/instruments/:ticker/:marketCode/{undelete,exclude}`.
 */
export class AdminInstrumentsApiActions extends ApiBaseActions {
  declare protected readonly _instance: AdminInstrumentsEndpoint;

  @Step()
  async undelete(ticker: string, marketCode: string): Promise<APIResponse> {
    return this._instance.undelete(ticker, marketCode, this.authHeaders);
  }

  @Step()
  async undeleteForCookie(
    cookie: string,
    ticker: string,
    marketCode: string,
  ): Promise<APIResponse> {
    return this._instance.undelete(ticker, marketCode, headersForCookie(cookie));
  }

  @Step()
  async exclude(
    ticker: string,
    marketCode: string,
    excluded: boolean,
  ): Promise<APIResponse> {
    return this._instance.exclude(ticker, marketCode, { excluded }, this.authHeaders);
  }

  @Step()
  async excludeForCookie(
    cookie: string,
    ticker: string,
    marketCode: string,
    excluded: boolean,
  ): Promise<APIResponse> {
    return this._instance.exclude(
      ticker,
      marketCode,
      { excluded },
      headersForCookie(cookie),
    );
  }
}
