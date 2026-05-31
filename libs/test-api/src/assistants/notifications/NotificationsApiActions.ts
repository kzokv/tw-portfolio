import type { APIResponse } from "@playwright/test";
import { Step } from "@vakwen/test-framework/decorators";
import { ApiBaseActions, headersForCookie } from "../../mixins/index.js";
import type { NotificationsEndpoint } from "../../endpoints/NotificationsEndpoint.js";

export class NotificationsApiActions extends ApiBaseActions {
  declare protected readonly _instance: NotificationsEndpoint;

  @Step()
  async listNotifications(params?: { page?: number; limit?: number }): Promise<APIResponse> {
    return this._instance.list(params, this.authHeaders);
  }

  @Step()
  async listNotificationsForCookie(cookie: string, params?: { page?: number; limit?: number }): Promise<APIResponse> {
    return this._instance.list(params, headersForCookie(cookie));
  }

  @Step()
  async getUnreadCount(): Promise<APIResponse> {
    return this._instance.unreadCount(this.authHeaders);
  }

  @Step()
  async markRead(id: string): Promise<APIResponse> {
    return this._instance.markRead(id, this.authHeaders);
  }

  @Step()
  async markAllRead(): Promise<APIResponse> {
    return this._instance.markAllRead(this.authHeaders);
  }

  @Step()
  async dismiss(id: string): Promise<APIResponse> {
    return this._instance.dismiss(id, this.authHeaders);
  }

  @Step()
  async escalate(id: string): Promise<APIResponse> {
    return this._instance.escalate(id, this.authHeaders);
  }

  @Step()
  async seedNotification(data: {
    severity: string;
    source: string;
    title: string;
    body?: string;
    detail?: unknown;
  }): Promise<APIResponse> {
    return this._instance.seedNotification(data, this.authHeaders);
  }
}
