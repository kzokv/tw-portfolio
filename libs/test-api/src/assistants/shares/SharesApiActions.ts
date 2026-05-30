import type { APIResponse } from "@playwright/test";
import { Step } from "@vakwen/test-framework/decorators";
import { ApiBaseActions, headersForCookie } from "../../mixins/index.js";
import type { SharesEndpoint } from "../../endpoints/SharesEndpoint.js";

export class SharesApiActions extends ApiBaseActions {
  declare protected readonly _instance: SharesEndpoint;

  @Step()
  async listShares(): Promise<APIResponse> {
    return this._instance.list(this.authHeaders);
  }

  @Step()
  async listSharesForCookie(cookie: string): Promise<APIResponse> {
    return this._instance.list(headersForCookie(cookie));
  }

  @Step()
  async createShare(email: string): Promise<APIResponse> {
    return this._instance.create({ email }, this.authHeaders);
  }

  @Step()
  async createShareForCookie(cookie: string, email: string): Promise<APIResponse> {
    return this._instance.create({ email }, headersForCookie(cookie));
  }

  @Step()
  async revokeShare(shareId: string): Promise<APIResponse> {
    return this._instance.revoke(shareId, this.authHeaders);
  }

  @Step()
  async revokeShareForCookie(cookie: string, shareId: string): Promise<APIResponse> {
    return this._instance.revoke(shareId, headersForCookie(cookie));
  }

  @Step()
  async revokePendingShare(inviteCode: string): Promise<APIResponse> {
    return this._instance.revokePending(inviteCode, this.authHeaders);
  }

  @Step()
  async revokePendingShareForCookie(cookie: string, inviteCode: string): Promise<APIResponse> {
    return this._instance.revokePending(inviteCode, headersForCookie(cookie));
  }
}
