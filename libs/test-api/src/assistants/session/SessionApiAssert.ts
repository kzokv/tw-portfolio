import type { APIResponse } from "@playwright/test";
import { Step } from "@tw-portfolio/test-framework/decorators";
import { UUID_V4_PATTERN, parseSessionCookie } from "@tw-portfolio/test-framework/shared";
import { ApiBaseAssert } from "../../mixins/index.js";
import type { SessionEndpoint } from "../../endpoints/SessionEndpoint.js";

export class SessionApiAssert extends ApiBaseAssert {
  declare protected readonly _instance: SessionEndpoint;

  @Step()
  async statusIs(response: APIResponse, expected: number): Promise<void> {
    await this.mxAssertResponseStatus(response, expected);
  }

  @Step()
  async bodyFieldEquals(
    body: Record<string, unknown>,
    field: string,
    expected: unknown,
  ): Promise<void> {
    await this.mxAssertObjectHasKey(body, field, "session body");
    await this.mxAssertEqual(body[field], expected, `sessionBody.${field}`);
  }

  @Step()
  async bodyUserIdIsUuid(body: Record<string, unknown>): Promise<void> {
    await this.mxAssertObjectHasKey(body, "userId", "session body");
    await this.mxAssertMatches(String(body.userId), UUID_V4_PATTERN, "sessionBody.userId");
  }

  @Step()
  async responseSetCookieContains(response: APIResponse, expected: string): Promise<void> {
    await this.mxAssertIncludes(response.headers()["set-cookie"], expected, "set-cookie header");
  }

  @Step()
  async cookieUserIdEquals(cookieHeader: string, expectedUserId: unknown): Promise<void> {
    const cookieValue = cookieHeader.split("=").slice(1).join("=");
    const { userId } = parseSessionCookie(cookieValue);
    await this.mxAssertEqual(userId, expectedUserId, "session cookie userId");
  }

  @Step()
  async cookieUserIdIsUuid(cookieHeader: string): Promise<void> {
    const cookieValue = cookieHeader.split("=").slice(1).join("=");
    const { userId } = parseSessionCookie(cookieValue);
    await this.mxAssertMatches(userId, UUID_V4_PATTERN, "session cookie userId");
  }
}
