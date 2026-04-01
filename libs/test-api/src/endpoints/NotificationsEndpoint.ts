import type { APIResponse } from "@playwright/test";
import { BaseEndpoint } from "@tw-portfolio/test-framework/core";
import { apiUrl } from "@tw-portfolio/test-framework/shared";

export class NotificationsEndpoint extends BaseEndpoint {
  list = (params?: { page?: number; limit?: number }, headers?: Record<string, string>): Promise<APIResponse> => {
    const qs = new URLSearchParams();
    if (params?.page !== undefined) qs.set("page", String(params.page));
    if (params?.limit !== undefined) qs.set("limit", String(params.limit));
    const query = qs.toString();
    return this.request.get(apiUrl(`/notifications${query ? `?${query}` : ""}`), headers ? { headers } : {});
  };

  unreadCount = (headers?: Record<string, string>): Promise<APIResponse> =>
    this.request.get(apiUrl("/notifications/unread-count"), headers ? { headers } : {});

  markRead = (id: string, headers?: Record<string, string>): Promise<APIResponse> =>
    this.request.patch(apiUrl(`/notifications/${id}/read`), {
      data: {},
      ...(headers ? { headers } : {}),
    });

  markAllRead = (headers?: Record<string, string>): Promise<APIResponse> =>
    this.request.patch(apiUrl("/notifications/read-all"), {
      data: {},
      ...(headers ? { headers } : {}),
    });

  dismiss = (id: string, headers?: Record<string, string>): Promise<APIResponse> =>
    this.request.delete(apiUrl(`/notifications/${id}`), headers ? { headers } : {});

  escalate = (id: string, headers?: Record<string, string>): Promise<APIResponse> =>
    this.request.patch(apiUrl(`/notifications/${id}/escalate`), {
      data: {},
      ...(headers ? { headers } : {}),
    });

  seedNotification = (
    data: { severity: string; source: string; title: string; body?: string; detail?: unknown },
    headers?: Record<string, string>,
  ): Promise<APIResponse> =>
    this.request.post(apiUrl("/__e2e/seed-notification"), {
      data,
      ...(headers ? { headers } : {}),
    });
}
