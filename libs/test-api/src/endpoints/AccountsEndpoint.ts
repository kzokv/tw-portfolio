import type { APIResponse } from "@playwright/test";
import { BaseEndpoint } from "@tw-portfolio/test-framework/core";
import { apiUrl } from "@tw-portfolio/test-framework/shared";

export class AccountsEndpoint extends BaseEndpoint {
  list = (headers?: Record<string, string>): Promise<APIResponse> =>
    this.request.get(apiUrl("/accounts"), headers ? { headers } : {});

  patch = (
    accountId: string,
    data: unknown,
    headers?: Record<string, string>,
  ): Promise<APIResponse> =>
    this.request.patch(apiUrl(`/accounts/${accountId}`), {
      data,
      ...(headers ? { headers } : {}),
    });
}
