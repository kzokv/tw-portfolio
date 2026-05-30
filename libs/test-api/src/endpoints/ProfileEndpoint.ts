import type { APIResponse } from "@playwright/test";
import { BaseEndpoint } from "@vakwen/test-framework/core";
import { apiUrl } from "@vakwen/test-framework/shared";

export class ProfileEndpoint extends BaseEndpoint {
  get = (headers?: Record<string, string>): Promise<APIResponse> =>
    this.request.get(apiUrl("/profile"), headers ? { headers } : {});

  patch = (data: unknown, headers?: Record<string, string>): Promise<APIResponse> =>
    this.request.patch(apiUrl("/profile"), {
      data,
      ...(headers ? { headers } : {}),
    });
}
