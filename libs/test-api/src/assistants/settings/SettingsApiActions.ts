import type { APIResponse } from "@playwright/test";
import { Step } from "@tw-portfolio/test-framework/decorators";
import { ApiBaseActions, headersForCookie } from "../../mixins/index.js";
import type { SettingsEndpoint } from "../../endpoints/SettingsEndpoint.js";

export class SettingsApiActions extends ApiBaseActions {
  declare protected readonly _instance: SettingsEndpoint;

  @Step()
  async getSettings(): Promise<APIResponse> {
    return this._instance.get(this.authHeaders);
  }

  @Step()
  async getSettingsForCookie(
    cookie: string,
    extraHeaders: Record<string, string> = {},
  ): Promise<APIResponse> {
    return this._instance.get({
      ...headersForCookie(cookie),
      ...extraHeaders,
    });
  }

  @Step()
  async patchSettings(data: unknown): Promise<APIResponse> {
    return this._instance.patch(data, this.authHeaders);
  }

  @Step()
  async getFeeConfig(): Promise<APIResponse> {
    return this._instance.getFeeConfig(this.authHeaders);
  }

  @Step()
  async updateFeeConfig(data: unknown): Promise<APIResponse> {
    return this._instance.putFeeConfig(data, this.authHeaders);
  }

  @Step()
  async saveFull(data: unknown): Promise<APIResponse> {
    return this._instance.putFull(data, this.authHeaders);
  }

  @Step()
  async getSettingsUnauthenticated(): Promise<APIResponse> {
    return this._instance.get({ cookie: "" });
  }
}
