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
