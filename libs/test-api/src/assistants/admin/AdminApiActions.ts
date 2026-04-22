import type { APIResponse } from "@playwright/test";
import { Step } from "@tw-portfolio/test-framework/decorators";
import { ApiBaseActions, headersForCookie } from "../../mixins/index.js";
import type { AdminEndpoint, TAdminAuditLogQuery, TAdminInvitesQuery } from "../../endpoints/AdminEndpoint.js";

export class AdminApiActions extends ApiBaseActions {
  declare protected readonly _instance: AdminEndpoint;

  @Step()
  async listInvites(query?: TAdminInvitesQuery): Promise<APIResponse> {
    return this._instance.listInvites(query, this.authHeaders);
  }

  @Step()
  async listInvitesForCookie(cookie: string, query?: TAdminInvitesQuery): Promise<APIResponse> {
    return this._instance.listInvites(query, headersForCookie(cookie));
  }

  @Step()
  async listAuditLog(query?: TAdminAuditLogQuery): Promise<APIResponse> {
    return this._instance.listAuditLog(query, this.authHeaders);
  }

  @Step()
  async listAuditLogForCookie(cookie: string, query?: TAdminAuditLogQuery): Promise<APIResponse> {
    return this._instance.listAuditLog(query, headersForCookie(cookie));
  }

  @Step()
  async getAdminSettings(): Promise<APIResponse> {
    return this._instance.getAdminSettings(this.authHeaders);
  }

  @Step()
  async getAdminSettingsForCookie(cookie: string): Promise<APIResponse> {
    return this._instance.getAdminSettings(headersForCookie(cookie));
  }

  @Step()
  async patchAdminSettings(
    body: {
      repairCooldownMinutes?: number | null;
      dashboardPerformanceRanges?: string[] | null;
    },
  ): Promise<APIResponse> {
    return this._instance.patchAdminSettings(body, this.authHeaders);
  }

  @Step()
  async patchAdminSettingsForCookie(
    cookie: string,
    body: {
      repairCooldownMinutes?: number | null;
      dashboardPerformanceRanges?: string[] | null;
    },
  ): Promise<APIResponse> {
    return this._instance.patchAdminSettings(body, headersForCookie(cookie));
  }
}
