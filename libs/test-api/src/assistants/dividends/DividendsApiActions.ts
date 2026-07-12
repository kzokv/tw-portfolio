import type { APIResponse } from "@playwright/test";
import { Step } from "@vakwen/test-framework/decorators";
import { ApiBaseActions } from "../../mixins/index.js";
import type { DividendsEndpoint } from "../../endpoints/DividendsEndpoint.js";

export class DividendsApiActions extends ApiBaseActions {
  declare protected readonly _instance: DividendsEndpoint;

  @Step()
  async seedDividendEvent(data: unknown): Promise<APIResponse> {
    return this._instance.seedDividendEvent(data, this.authHeaders);
  }

  @Step()
  async listDividendEvents(query?: Record<string, string | number | undefined>): Promise<APIResponse> {
    return this._instance.listEvents(query, this.authHeaders);
  }

  @Step()
  async listDividendLedger(
    query?: Record<string, string | number | undefined>,
  ): Promise<APIResponse> {
    return this._instance.listLedger(query, this.authHeaders);
  }

  @Step()
  async listDailyHighlights(query?: Record<string, string | number | undefined>): Promise<APIResponse> {
    return this._instance.listDailyHighlights(query, this.authHeaders);
  }

  @Step()
  async listReview(query?: Record<string, string | number | undefined>): Promise<APIResponse> {
    return this._instance.listReview(query, this.authHeaders);
  }

  @Step()
  async listHoldingActivity(
    ticker: string,
    query?: Record<string, string | number | undefined>,
  ): Promise<APIResponse> {
    return this._instance.listHoldingActivity(ticker, query, this.authHeaders);
  }

  @Step()
  async listTickerDividends(
    ticker: string,
    section: "upcoming" | "open-reconciliation" | "posted-history",
    query?: Record<string, string | number | undefined>,
  ): Promise<APIResponse> {
    return this._instance.listTickerDividends(ticker, section, query, this.authHeaders);
  }

  @Step()
  async previewTradeDelete(tradeEventId: string, reason: string): Promise<APIResponse> {
    return this._instance.previewTradeDelete(tradeEventId, { reason }, this.authHeaders);
  }

  @Step()
  async confirmTradeDelete(tradeEventId: string, confirmation: unknown): Promise<APIResponse> {
    return this._instance.confirmTradeDelete(tradeEventId, confirmation, this.authHeaders);
  }

  @Step()
  async previewAccountPurge(accountId: string, cutoffDate: string, reason: string): Promise<APIResponse> {
    return this._instance.previewAccountPurge(accountId, { cutoffDate, reason }, this.authHeaders);
  }

  @Step()
  async confirmAccountPurge(accountId: string, confirmation: unknown): Promise<APIResponse> {
    return this._instance.confirmAccountPurge(accountId, confirmation, this.authHeaders);
  }

  @Step()
  async createOrUpdatePosting(data: unknown, idempotencyKey = `dividends-${Date.now()}-${Math.random()}`): Promise<APIResponse> {
    return this._instance.createOrUpdatePosting(data, {
      ...this.authHeaders,
      "idempotency-key": idempotencyKey,
    });
  }

  @Step()
  async patchReconciliation(
    dividendLedgerEntryId: string,
    data: unknown,
  ): Promise<APIResponse> {
    return this._instance.patchReconciliation(dividendLedgerEntryId, data, this.authHeaders);
  }
}
