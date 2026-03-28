import type { APIResponse } from "@playwright/test";
import { Step } from "@tw-portfolio/test-framework/decorators";
import { ApiBaseActions } from "../../mixins/index.js";
import type { TransactionsEndpoint } from "../../endpoints/TransactionsEndpoint.js";

export class TransactionsApiActions extends ApiBaseActions {
  declare protected readonly _instance: TransactionsEndpoint;

  @Step()
  async createTransaction(data: unknown, idempotencyKey: string): Promise<APIResponse> {
    return this._instance.create(data, {
      ...this.authHeaders,
      "idempotency-key": idempotencyKey,
    });
  }
}
