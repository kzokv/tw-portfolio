import type { APIResponse } from "@playwright/test";
import { Step } from "@tw-portfolio/test-framework/decorators";
import { ApiBaseActions, headersForCookie } from "../../mixins/index.js";
import type { TransactionsEndpoint } from "../../endpoints/TransactionsEndpoint.js";

const CONTEXT_HEADER = "x-context-user-id";

export class TransactionsApiActions extends ApiBaseActions {
  declare protected readonly _instance: TransactionsEndpoint;

  @Step()
  async createTransaction(data: unknown, idempotencyKey: string): Promise<APIResponse> {
    return this._instance.create(data, {
      ...this.authHeaders,
      "idempotency-key": idempotencyKey,
    });
  }

  /**
   * Cookie-authenticated create. Pass `contextUserId` to inject the
   * `x-context-user-id` header (write-block path); pass `undefined` for
   * a normal write under the cookie's session.
   */
  @Step()
  async createTransactionForCookie(
    cookie: string,
    contextUserId: string | undefined,
    data: unknown,
    idempotencyKey: string,
  ): Promise<APIResponse> {
    const headers: Record<string, string> = {
      ...headersForCookie(cookie),
      "idempotency-key": idempotencyKey,
    };
    if (contextUserId !== undefined) {
      headers[CONTEXT_HEADER] = contextUserId;
    }
    return this._instance.create(data, headers);
  }

  @Step()
  async listTransactionsForCookie(cookie: string): Promise<APIResponse> {
    return this._instance.list(headersForCookie(cookie));
  }

  /**
   * KZO-169: POST /portfolio/transactions/estimate. Server derives trade
   * currency from `currencyFor(marketCode)` and returns commission/tax
   * estimates. Body shape carries the new `marketCode` field.
   */
  @Step()
  async estimateTransaction(data: unknown): Promise<APIResponse> {
    return this._instance.estimate(data, this.authHeaders);
  }
}
