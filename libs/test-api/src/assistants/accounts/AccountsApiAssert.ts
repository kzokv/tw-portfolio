import type { APIResponse } from "@playwright/test";
import { Step } from "@vakwen/test-framework/decorators";
import { ApiBaseAssert } from "../../mixins/index.js";
import type { AccountsEndpoint } from "../../endpoints/AccountsEndpoint.js";

export class AccountsApiAssert extends ApiBaseAssert {
  declare protected readonly _instance: AccountsEndpoint;

  @Step()
  async statusIs(response: APIResponse, expected: number): Promise<void> {
    await this.mxAssertResponseStatus(response, expected);
  }

  @Step()
  async accountCountAtLeast(accounts: Record<string, unknown>[], minimum: number): Promise<void> {
    await this.mxAssertArrayLengthAtLeast(accounts, minimum, "accounts");
  }

  @Step()
  async fieldEquals(
    account: Record<string, unknown>,
    field: string,
    expected: unknown,
  ): Promise<void> {
    await this.mxAssertObjectHasKey(account, field, "account");
    await this.mxAssertEqual(account[field], expected, `account.${field}`);
  }
}
