import type { APIResponse } from "@playwright/test";
import { Step } from "@vakwen/test-framework/decorators";
import { ApiBaseArrange } from "../../mixins/index.js";
import type { AccountsEndpoint } from "../../endpoints/AccountsEndpoint.js";

export class AccountsApiArrange extends ApiBaseArrange {
  declare protected readonly _instance: AccountsEndpoint;

  @Step()
  async accounts(response: APIResponse): Promise<Record<string, unknown>[]> {
    return (await this.body(response)) as Record<string, unknown>[];
  }

  @Step()
  async firstAccount(accounts: Record<string, unknown>[]): Promise<Record<string, unknown>> {
    if (accounts.length === 0) {
      throw new Error("Expected at least one account");
    }

    return accounts[0]!;
  }

  // ui-enhancement — typed body for /accounts/deleted listing.
  @Step()
  async deletedAccounts(response: APIResponse): Promise<Record<string, unknown>[]> {
    return (await this.body(response)) as Record<string, unknown>[];
  }
}
