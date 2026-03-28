import type { APIResponse } from "@playwright/test";
import { Step } from "@tw-portfolio/test-framework/decorators";
import { ApiBaseAssert } from "../../mixins/index.js";
import type { TransactionsEndpoint } from "../../endpoints/TransactionsEndpoint.js";

export class TransactionsApiAssert extends ApiBaseAssert {
  declare protected readonly _instance: TransactionsEndpoint;

  @Step()
  async statusIs(response: APIResponse, expected: number): Promise<void> {
    await this.mxAssertResponseStatus(response, expected);
  }
}
