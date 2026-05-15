import type { APIResponse } from "@playwright/test";
import { Step } from "@vakwen/test-framework/decorators";
import { ApiBaseAssert } from "../../mixins/index.js";
import type { FeeProfilesEndpoint } from "../../endpoints/FeeProfilesEndpoint.js";

export class FeeProfilesApiAssert extends ApiBaseAssert {
  declare protected readonly _instance: FeeProfilesEndpoint;

  @Step()
  async statusIs(response: APIResponse, expected: number): Promise<void> {
    await this.mxAssertResponseStatus(response, expected);
  }

  @Step()
  async fieldEquals(
    feeProfile: Record<string, unknown>,
    field: string,
    expected: unknown,
  ): Promise<void> {
    await this.mxAssertObjectHasKey(feeProfile, field, "fee profile");
    await this.mxAssertEqual(feeProfile[field], expected, `feeProfile.${field}`);
  }

  @Step()
  async errorEquals(body: Record<string, unknown>, expected: string): Promise<void> {
    await this.mxAssertObjectHasKey(body, "error", "error response body");
    await this.mxAssertEqual(body.error, expected, "error response body.error");
  }
}
