import type { APIResponse } from "@playwright/test";
import { BaseEndpoint } from "@vakwen/test-framework/core";
import { apiUrl } from "@vakwen/test-framework/shared";

export class SharesEndpoint extends BaseEndpoint {
  list = (headers?: Record<string, string>): Promise<APIResponse> =>
    this.request.get(apiUrl("/shares"), headers ? { headers } : {});

  create = (data: { email: string }, headers?: Record<string, string>): Promise<APIResponse> =>
    this.request.post(apiUrl("/shares"), {
      data,
      ...(headers ? { headers } : {}),
    });

  revoke = (shareId: string, headers?: Record<string, string>): Promise<APIResponse> =>
    this.request.delete(apiUrl(`/shares/${shareId}`), headers ? { headers } : {});

  revokePending = (inviteCode: string, headers?: Record<string, string>): Promise<APIResponse> =>
    this.request.delete(apiUrl(`/shares/pending/${inviteCode}`), headers ? { headers } : {});
}
