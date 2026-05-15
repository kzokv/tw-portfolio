import type { APIResponse } from "@playwright/test";
import { TestEnv } from "@vakwen/config/test";
import { Step } from "@vakwen/test-framework/decorators";
import { ApiBaseActions } from "../../mixins/index.js";
import type { SessionEndpoint } from "../../endpoints/SessionEndpoint.js";

function makeBase64UrlPayload(claims: object): string {
  return Buffer.from(JSON.stringify(claims)).toString("base64url");
}

function buildMockIdToken(claims: Record<string, unknown>): string {
  const now = Math.floor(Date.now() / 1000);
  const mergedClaims = {
    email_verified: true,
    iss: "https://accounts.google.com",
    aud: TestEnv.oauth.clientId,
    iat: now,
    exp: now + 3600,
    ...claims,
  };

  return `eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.${makeBase64UrlPayload(mergedClaims)}.mock-signature`;
}

export class SessionApiActions extends ApiBaseActions {
  declare protected readonly _instance: SessionEndpoint;

  @Step()
  async createOauthSession(): Promise<APIResponse> {
    return this._instance.createOauthSession();
  }

  @Step()
  async createOauthSessionWithIdToken(idToken: string): Promise<APIResponse> {
    return this._instance.createOauthSession({ id_token: idToken });
  }

  @Step()
  async createOauthSessionForClaims(claims: Record<string, unknown>): Promise<APIResponse> {
    return this.createOauthSessionWithIdToken(buildMockIdToken(claims));
  }
}
