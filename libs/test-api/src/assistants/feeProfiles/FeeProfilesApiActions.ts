import type { APIResponse } from "@playwright/test";
import { Step } from "@vakwen/test-framework/decorators";
import { ApiBaseActions, headersForCookie } from "../../mixins/index.js";
import type { FeeProfilesEndpoint } from "../../endpoints/FeeProfilesEndpoint.js";

export class FeeProfilesApiActions extends ApiBaseActions {
  declare protected readonly _instance: FeeProfilesEndpoint;

  @Step()
  async listFeeProfiles(): Promise<APIResponse> {
    return this._instance.list(this.authHeaders);
  }

  @Step()
  async listFeeProfilesForAccount(accountId: string): Promise<APIResponse> {
    return this._instance.list(this.authHeaders, { accountId });
  }

  @Step()
  async listFeeProfilesForCookie(cookie: string): Promise<APIResponse> {
    return this._instance.list(headersForCookie(cookie));
  }

  @Step()
  async createFeeProfile(data: unknown): Promise<APIResponse> {
    return this._instance.create(data, this.authHeaders);
  }

  @Step()
  async createFeeProfileForCookie(cookie: string, data: unknown): Promise<APIResponse> {
    return this._instance.create(data, headersForCookie(cookie));
  }

  @Step()
  async patchFeeProfile(profileId: string, data: unknown): Promise<APIResponse> {
    return this._instance.patch(profileId, data, this.authHeaders);
  }

  @Step()
  async patchFeeProfileForCookie(
    cookie: string,
    profileId: string,
    data: unknown,
  ): Promise<APIResponse> {
    return this._instance.patch(profileId, data, headersForCookie(cookie));
  }

  @Step()
  async deleteFeeProfile(profileId: string): Promise<APIResponse> {
    return this._instance.delete(profileId, this.authHeaders);
  }
}
