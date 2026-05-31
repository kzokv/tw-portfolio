import type { APIResponse } from "@playwright/test";
import { Step } from "@vakwen/test-framework/decorators";
import { ApiBaseArrange } from "../../mixins/index.js";
import type { SettingsEndpoint } from "../../endpoints/SettingsEndpoint.js";

export class SettingsApiArrange extends ApiBaseArrange {
  declare protected readonly _instance: SettingsEndpoint;

  @Step()
  async settingsBody(response: APIResponse): Promise<Record<string, unknown>> {
    return (await this.body(response)) as Record<string, unknown>;
  }

  @Step()
  async feeConfigBody(response: APIResponse): Promise<Record<string, unknown>> {
    return (await this.body(response)) as Record<string, unknown>;
  }

  @Step()
  async nextLocale(currentLocale: unknown): Promise<string> {
    return currentLocale === "en" ? "zh-TW" : "en";
  }
}
