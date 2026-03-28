import type { APIResponse } from "@playwright/test";
import { Step } from "@tw-portfolio/test-framework/decorators";
import { ApiBaseActions } from "../../mixins/index.js";
import type { AccountsEndpoint } from "../../endpoints/AccountsEndpoint.js";

export class AccountsApiActions extends ApiBaseActions {
  declare protected readonly _instance: AccountsEndpoint;

  @Step()
  async listAccounts(): Promise<APIResponse> {
    return this._instance.list(this.authHeaders);
  }

  @Step()
  async patchAccount(accountId: string, data: unknown): Promise<APIResponse> {
    return this._instance.patch(accountId, data, this.authHeaders);
  }
}
