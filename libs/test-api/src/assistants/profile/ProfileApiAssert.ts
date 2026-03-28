import type { APIResponse } from "@playwright/test";
import { Step } from "@tw-portfolio/test-framework/decorators";
import { ApiBaseAssert } from "../../mixins/index.js";
import type { ProfileEndpoint } from "../../endpoints/ProfileEndpoint.js";

export class ProfileApiAssert extends ApiBaseAssert {
  declare protected readonly _instance: ProfileEndpoint;

  private isApiResponse(value: APIResponse | Record<string, unknown>): value is APIResponse {
    return typeof (value as APIResponse).json === "function";
  }

  private async resolveBody(source: APIResponse | Record<string, unknown>): Promise<Record<string, unknown>> {
    if (this.isApiResponse(source)) {
      return (await source.json()) as Record<string, unknown>;
    }

    return source;
  }

  @Step()
  async statusIs(response: APIResponse, expected: number): Promise<void> {
    await this.mxAssertResponseStatus(response, expected);
  }

  @Step()
  async hasShape(source: APIResponse | Record<string, unknown>): Promise<void> {
    const body = await this.resolveBody(source);
    await this.mxAssertObjectHasKey(body, "userId", "profile body");
    await this.mxAssertObjectHasKey(body, "email", "profile body");
    await this.mxAssertObjectHasKey(body, "displayName", "profile body");
    await this.mxAssertObjectHasKey(body, "providerPictureUrl", "profile body");
    await this.mxAssertObjectHasKey(body, "providerDisplayName", "profile body");
    await this.mxAssertObjectHasKey(body, "linkedAt", "profile body");
    await this.mxAssertObjectHasKey(body, "lastSeenAt", "profile body");
  }

  @Step()
  async fieldEquals(
    source: APIResponse | Record<string, unknown>,
    field: string,
    expected: unknown,
  ): Promise<void> {
    const body = await this.resolveBody(source);
    await this.mxAssertObjectHasKey(body, field, "profile body");
    await this.mxAssertEqual(body[field], expected, `profile.${field}`);
  }

  @Step()
  async fieldMatches(
    source: APIResponse | Record<string, unknown>,
    field: string,
    expected: RegExp,
  ): Promise<void> {
    const body = await this.resolveBody(source);
    await this.mxAssertObjectHasKey(body, field, "profile body");
    await this.mxAssertMatches(String(body[field]), expected, `profile.${field}`);
  }

  @Step()
  async fieldIsNull(source: APIResponse | Record<string, unknown>, field: string): Promise<void> {
    const body = await this.resolveBody(source);
    await this.mxAssertObjectHasKey(body, field, "profile body");
    await this.mxAssertNull(body[field], `profile.${field}`);
  }
}
