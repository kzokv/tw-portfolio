import type { APIResponse } from "@playwright/test";
import { BaseEndpoint } from "@tw-portfolio/test-framework/core";
import { apiUrl } from "@tw-portfolio/test-framework/shared";

export interface TAdminInvitesQuery {
  page?: number;
  limit?: number;
  status?: "pending" | "used" | "expired" | "revoked";
  email?: string;
}

export interface TAdminAuditLogQuery {
  page?: number;
  limit?: number;
  action?: string[];
  actorUserId?: string;
  targetUserId?: string;
  fromDate?: string;
  toDate?: string;
}

function toQueryString(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : "";
}

export class AdminEndpoint extends BaseEndpoint {
  listInvites = (query?: TAdminInvitesQuery, headers?: Record<string, string>): Promise<APIResponse> =>
    this.request.get(
      apiUrl(`/admin/invites${toQueryString({
        page: query?.page,
        limit: query?.limit,
        status: query?.status,
        email: query?.email,
      })}`),
      headers ? { headers } : {},
    );

  listAuditLog = (query?: TAdminAuditLogQuery, headers?: Record<string, string>): Promise<APIResponse> =>
    this.request.get(
      apiUrl(`/admin/audit-log${toQueryString({
        page: query?.page,
        limit: query?.limit,
        action: query?.action?.join(","),
        actorUserId: query?.actorUserId,
        targetUserId: query?.targetUserId,
        fromDate: query?.fromDate,
        toDate: query?.toDate,
      })}`),
      headers ? { headers } : {},
    );
}
