import type { APIResponse } from "@playwright/test";
import { Step } from "@vakwen/test-framework/decorators";
import { ApiBaseAssert } from "../../mixins/index.js";
import type { NotificationsEndpoint } from "../../endpoints/NotificationsEndpoint.js";

export class NotificationsApiAssert extends ApiBaseAssert {
  declare protected readonly _instance: NotificationsEndpoint;

  @Step()
  async statusIs(response: APIResponse, expected: number): Promise<void> {
    await this.mxAssertResponseStatus(response, expected);
  }

  @Step()
  async fieldEquals(body: Record<string, unknown>, field: string, expected: unknown): Promise<void> {
    await this.mxAssertObjectHasKey(body, field, "notification body");
    await this.mxAssertEqual(body[field], expected, `notification.${field}`);
  }

  @Step()
  async notificationCountIs(body: { notifications: unknown[] }, expected: number): Promise<void> {
    await this.mxAssertEqual(body.notifications.length, expected, "notification count");
  }

  @Step()
  async totalIs(body: { total: number }, expected: number): Promise<void> {
    await this.mxAssertEqual(body.total, expected, "total count");
  }

  @Step()
  async unreadCountIs(body: { count: number }, expected: number): Promise<void> {
    await this.mxAssertEqual(body.count, expected, "unread count");
  }

  @Step()
  async fieldIsTruthy(body: Record<string, unknown>, field: string): Promise<void> {
    await this.mxAssertObjectHasKey(body, field, "notification body");
    await this.mxAssertDefined(body[field], `notification.${field}`);
  }
}
