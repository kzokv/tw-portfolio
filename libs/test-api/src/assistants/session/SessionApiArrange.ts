import type { APIResponse } from "@playwright/test";
import { TestEnv } from "@tw-portfolio/config/test";
import { Step } from "@tw-portfolio/test-framework/decorators";
import { extractCookieValue, parseSessionCookie } from "@tw-portfolio/test-framework/shared";
import { ApiBaseArrange } from "../../mixins/index.js";
import type { SessionEndpoint } from "../../endpoints/SessionEndpoint.js";

export class SessionApiArrange extends ApiBaseArrange {
  declare protected readonly _instance: SessionEndpoint;

  @Step()
  async sessionBody(response: APIResponse): Promise<Record<string, unknown>> {
    return (await this.body(response)) as Record<string, unknown>;
  }

  @Step()
  async currentSessionCookie(): Promise<string> {
    const cookie = (this.testUser as { sessionCookie?: string } | undefined)?.sessionCookie;
    if (!cookie) {
      throw new Error("No session cookie is available on the current test user");
    }

    return cookie;
  }

  @Step()
  async currentSessionUserId(): Promise<string> {
    return this.sessionCookieUserId(await this.currentSessionCookie());
  }

  @Step()
  async sessionCookieHeader(response: APIResponse): Promise<string> {
    const setCookieHeader = await this.header(response, "set-cookie");
    const cookieValue = extractCookieValue(setCookieHeader, TestEnv.sessionCookieName);
    if (!cookieValue) {
      throw new Error(`Session cookie "${TestEnv.sessionCookieName}" not found in Set-Cookie header`);
    }

    return `${TestEnv.sessionCookieName}=${cookieValue}`;
  }

  @Step()
  async sessionCookieUserId(cookieHeader: string): Promise<string> {
    const cookieValue = cookieHeader.split("=").slice(1).join("=");
    return parseSessionCookie(cookieValue).userId;
  }
}
