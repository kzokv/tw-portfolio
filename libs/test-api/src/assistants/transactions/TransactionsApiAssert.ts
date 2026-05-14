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

  @Step()
  async fieldEquals(
    body: Record<string, unknown>,
    field: string,
    expected: unknown,
  ): Promise<void> {
    await this.mxAssertObjectHasKey(body, field, "body");
    await this.mxAssertEqual(body[field], expected, `body.${field}`);
  }
}
