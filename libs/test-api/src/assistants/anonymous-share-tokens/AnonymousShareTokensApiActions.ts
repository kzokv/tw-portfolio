import type { APIResponse } from "@playwright/test";
import { Step } from "@vakwen/test-framework/decorators";
import { ApiBaseActions, headersForCookie } from "../../mixins/index.js";
import type { AnonymousShareTokensEndpoint } from "../../endpoints/AnonymousShareTokensEndpoint.js";

export class AnonymousShareTokensApiActions extends ApiBaseActions {
  declare protected readonly _instance: AnonymousShareTokensEndpoint;
  private static readonly CONTEXT_HEADER = "x-context-user-id";

  @Step()
  async createToken(expiresInDays: number): Promise<APIResponse> {
    return this._instance.create({ expiresInDays }, this.authHeaders);
  }

  @Step()
  async createTokenForCookie(cookie: string, expiresInDays: number): Promise<APIResponse> {
    return this._instance.create({ expiresInDays }, headersForCookie(cookie));
  }

  @Step()
  async createTokenForCookieWithContext(
    cookie: string,
    contextUserId: string,
    expiresInDays: number,
  ): Promise<APIResponse> {
    return this._instance.create(
      { expiresInDays },
      {
        ...headersForCookie(cookie),
        [AnonymousShareTokensApiActions.CONTEXT_HEADER]: contextUserId,
      },
    );
  }

  @Step()
  async listTokens(): Promise<APIResponse> {
    return this._instance.list(this.authHeaders);
  }

  @Step()
  async listTokensForCookie(cookie: string): Promise<APIResponse> {
    return this._instance.list(headersForCookie(cookie));
  }

  @Step()
  async revokeToken(tokenId: string): Promise<APIResponse> {
    return this._instance.revoke(tokenId, this.authHeaders);
  }

  @Step()
  async revokeTokenForCookie(cookie: string, tokenId: string): Promise<APIResponse> {
    return this._instance.revoke(tokenId, headersForCookie(cookie));
  }

  @Step()
  async revokeTokenForCookieWithContext(
    cookie: string,
    tokenId: string,
    contextUserId: string,
  ): Promise<APIResponse> {
    return this._instance.revoke(tokenId, {
      ...headersForCookie(cookie),
      [AnonymousShareTokensApiActions.CONTEXT_HEADER]: contextUserId,
    });
  }

  @Step()
  async fetchPublicView(token: string): Promise<APIResponse> {
    return this._instance.publicView(token);
  }
}
