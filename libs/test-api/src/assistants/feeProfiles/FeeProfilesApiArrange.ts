import type { APIResponse } from "@playwright/test";
import { Step } from "@vakwen/test-framework/decorators";
import { ApiBaseArrange } from "../../mixins/index.js";
import type { FeeProfilesEndpoint } from "../../endpoints/FeeProfilesEndpoint.js";

export class FeeProfilesApiArrange extends ApiBaseArrange {
  declare protected readonly _instance: FeeProfilesEndpoint;

  @Step()
  async feeProfiles(response: APIResponse): Promise<Record<string, unknown>[]> {
    return (await this.body(response)) as Record<string, unknown>[];
  }

  @Step()
  async firstFeeProfile(
    feeProfiles: Record<string, unknown>[],
  ): Promise<Record<string, unknown>> {
    if (feeProfiles.length === 0) {
      throw new Error("Expected at least one fee profile");
    }

    return feeProfiles[0]!;
  }
}
