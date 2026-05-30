import type { APIResponse } from "@playwright/test";
import { Step } from "@vakwen/test-framework/decorators";
import { ApiBaseActions, headersForCookie } from "../../mixins/index.js";
import type { ProfileEndpoint } from "../../endpoints/ProfileEndpoint.js";

export class ProfileApiActions extends ApiBaseActions {
  declare protected readonly _instance: ProfileEndpoint;

  @Step()
  async getProfile(): Promise<APIResponse> {
    return this._instance.get(this.authHeaders);
  }

  @Step()
  async getProfileForCookie(cookie: string): Promise<APIResponse> {
    return this._instance.get(headersForCookie(cookie));
  }

  @Step()
  async patchProfile(data: unknown): Promise<APIResponse> {
    return this._instance.patch(data, this.authHeaders);
  }

  @Step()
  async getProfileUnauthenticated(): Promise<APIResponse> {
    return this._instance.get({ cookie: "" });
  }

  @Step()
  async patchProfileUnauthenticated(data: unknown): Promise<APIResponse> {
    return this._instance.patch(data, { cookie: "" });
  }
}
