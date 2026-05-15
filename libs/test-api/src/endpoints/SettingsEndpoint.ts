import type { APIResponse } from "@playwright/test";
import { BaseEndpoint } from "@vakwen/test-framework/core";
import { apiUrl } from "@vakwen/test-framework/shared";

export class SettingsEndpoint extends BaseEndpoint {
  get = (headers?: Record<string, string>): Promise<APIResponse> =>
    this.request.get(apiUrl("/settings"), headers ? { headers } : {});

  patch = (data: unknown, headers?: Record<string, string>): Promise<APIResponse> =>
    this.request.patch(apiUrl("/settings"), {
      data,
      ...(headers ? { headers } : {}),
    });

  getFeeConfig = (headers?: Record<string, string>): Promise<APIResponse> =>
    this.request.get(apiUrl("/settings/fee-config"), headers ? { headers } : {});

  putFeeConfig = (data: unknown, headers?: Record<string, string>): Promise<APIResponse> =>
    this.request.put(apiUrl("/settings/fee-config"), {
      data,
      ...(headers ? { headers } : {}),
    });

  putFull = (data: unknown, headers?: Record<string, string>): Promise<APIResponse> =>
    this.request.put(apiUrl("/settings/full"), {
      data,
      ...(headers ? { headers } : {}),
    });
}
