import type { APIResponse } from "@playwright/test";
import { BaseEndpoint } from "@vakwen/test-framework/core";
import { apiUrl } from "@vakwen/test-framework/shared";

export class FeeProfilesEndpoint extends BaseEndpoint {
  list = (
    headers?: Record<string, string>,
    query?: { accountId?: string },
  ): Promise<APIResponse> => {
    const params: Record<string, string> = {};
    if (query?.accountId) {
      params["account_id"] = query.accountId;
    }
    return this.request.get(apiUrl("/fee-profiles"), {
      ...(headers ? { headers } : {}),
      ...(Object.keys(params).length ? { params } : {}),
    });
  };

  create = (data: unknown, headers?: Record<string, string>): Promise<APIResponse> =>
    this.request.post(apiUrl("/fee-profiles"), {
      data,
      ...(headers ? { headers } : {}),
    });

  patch = (
    profileId: string,
    data: unknown,
    headers?: Record<string, string>,
  ): Promise<APIResponse> =>
    this.request.patch(apiUrl(`/fee-profiles/${profileId}`), {
      data,
      ...(headers ? { headers } : {}),
    });

  delete = (profileId: string, headers?: Record<string, string>): Promise<APIResponse> =>
    this.request.delete(apiUrl(`/fee-profiles/${profileId}`), headers ? { headers } : {});
}
