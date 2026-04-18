import type { APIResponse } from "@playwright/test";
import type {
  AdminAuditLogEntryDto,
  AdminAuditLogResponse,
  AdminInviteListItemDto,
  AdminInviteListResponse,
} from "@tw-portfolio/shared-types";
import { Step } from "@tw-portfolio/test-framework/decorators";
import { ApiBaseArrange } from "../../mixins/index.js";
import type { AdminEndpoint } from "../../endpoints/AdminEndpoint.js";

export class AdminApiArrange extends ApiBaseArrange {
  declare protected readonly _instance: AdminEndpoint;

  @Step()
  async invitesBody(response: APIResponse): Promise<AdminInviteListResponse> {
    return (await this.body(response)) as AdminInviteListResponse;
  }

  @Step()
  async auditLogBody(response: APIResponse): Promise<AdminAuditLogResponse> {
    return (await this.body(response)) as AdminAuditLogResponse;
  }

  findInviteByEmail(body: AdminInviteListResponse, email: string): AdminInviteListItemDto | undefined {
    return body.items.find((item) => item.email === email);
  }

  findAuditEntryByAction(body: AdminAuditLogResponse, action: string): AdminAuditLogEntryDto | undefined {
    return body.items.find((item) => item.action === action);
  }
}
