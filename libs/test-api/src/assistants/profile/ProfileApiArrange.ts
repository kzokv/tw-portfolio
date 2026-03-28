import type { APIResponse } from "@playwright/test";
import { Step } from "@tw-portfolio/test-framework/decorators";
import { ApiBaseArrange } from "../../mixins/index.js";
import type { ProfileEndpoint } from "../../endpoints/ProfileEndpoint.js";

export class ProfileApiArrange extends ApiBaseArrange {
  declare protected readonly _instance: ProfileEndpoint;

  @Step()
  async profileBody(response: APIResponse): Promise<Record<string, unknown>> {
    return (await this.body(response)) as Record<string, unknown>;
  }
}
