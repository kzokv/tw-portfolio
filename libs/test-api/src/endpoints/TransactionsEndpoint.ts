import type { APIResponse } from "@playwright/test";
import { BaseEndpoint } from "@tw-portfolio/test-framework/core";
import { apiUrl } from "@tw-portfolio/test-framework/shared";

export class TransactionsEndpoint extends BaseEndpoint {
  create = (data: unknown, headers?: Record<string, string>): Promise<APIResponse> =>
    this.request.post(apiUrl("/portfolio/transactions"), {
      data,
      ...(headers ? { headers } : {}),
    });

  list = (headers?: Record<string, string>): Promise<APIResponse> =>
    this.request.get(apiUrl("/portfolio/transactions"), {
      ...(headers ? { headers } : {}),
    });
}
