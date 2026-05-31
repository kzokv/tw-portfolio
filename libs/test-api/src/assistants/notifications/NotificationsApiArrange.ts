import type { APIResponse } from "@playwright/test";
import type { NotificationDto, NotificationListResponse } from "@vakwen/shared-types";
import { Step } from "@vakwen/test-framework/decorators";
import { ApiBaseArrange } from "../../mixins/index.js";
import type { NotificationsEndpoint } from "../../endpoints/NotificationsEndpoint.js";

export class NotificationsApiArrange extends ApiBaseArrange {
  declare protected readonly _instance: NotificationsEndpoint;

  @Step()
  async notificationListBody(response: APIResponse): Promise<{
    notifications: Record<string, unknown>[];
    total: number;
    page: number;
    limit: number;
  }> {
    return (await this.body(response)) as {
      notifications: Record<string, unknown>[];
      total: number;
      page: number;
      limit: number;
    };
  }

  @Step()
  async typedListBody(response: APIResponse): Promise<NotificationListResponse> {
    return (await this.body(response)) as NotificationListResponse;
  }

  findNotificationByTitle(body: NotificationListResponse, title: string): NotificationDto | undefined {
    return body.notifications.find((item) => item.title === title);
  }

  @Step()
  async unreadCountBody(response: APIResponse): Promise<{ count: number }> {
    return (await this.body(response)) as { count: number };
  }

  @Step()
  async seedBody(response: APIResponse): Promise<Record<string, unknown>> {
    return (await this.body(response)) as Record<string, unknown>;
  }
}
