import type { APIResponse } from "@playwright/test";
import { Step } from "@vakwen/test-framework/decorators";
import { ApiBaseAssert } from "../../mixins/index.js";
import type { FxTransfersEndpoint } from "../../endpoints/FxTransfersEndpoint.js";

export class FxTransfersApiAssert extends ApiBaseAssert {
  declare protected readonly _instance: FxTransfersEndpoint;

  @Step()
  async statusIs(response: APIResponse, expected: number): Promise<void> {
    await this.mxAssertResponseStatus(response, expected);
  }

  @Step()
  async bodyHasField(body: Record<string, unknown>, field: string): Promise<void> {
    await this.mxAssertObjectHasKey(body, field, "fx transfer body");
  }

  @Step()
  async fieldEquals(body: Record<string, unknown>, field: string, expected: unknown): Promise<void> {
    await this.mxAssertObjectHasKey(body, field, "fx transfer body");
    await this.mxAssertEqual(body[field], expected, `fx transfer body.${field}`);
  }
}
