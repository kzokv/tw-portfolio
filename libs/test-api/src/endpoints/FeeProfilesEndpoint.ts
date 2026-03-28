import type { APIResponse } from "@playwright/test";
import { BaseEndpoint } from "@tw-portfolio/test-framework/core";
import { apiUrl } from "@tw-portfolio/test-framework/shared";

export class FeeProfilesEndpoint extends BaseEndpoint {
  list = (headers?: Record<string, string>): Promise<APIResponse> =>
    this.request.get(apiUrl("/fee-profiles"), headers ? { headers } : {});

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
