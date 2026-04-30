import type { APIResponse } from "@playwright/test";
import { BaseEndpoint } from "@tw-portfolio/test-framework/core";
import { apiUrl } from "@tw-portfolio/test-framework/shared";

export class FxTransfersEndpoint extends BaseEndpoint {
  estimate = (data: unknown, headers?: Record<string, string>): Promise<APIResponse> =>
    this.request.post(apiUrl("/fx-transfers/estimate"), {
      data,
      ...(headers ? { headers } : {}),
    });

  create = (data: unknown, headers?: Record<string, string>): Promise<APIResponse> =>
    this.request.post(apiUrl("/fx-transfers"), {
      data,
      ...(headers ? { headers } : {}),
    });

  patch = (
    fxTransferId: string,
    data: unknown,
    headers?: Record<string, string>,
  ): Promise<APIResponse> =>
    this.request.patch(apiUrl(`/fx-transfers/${fxTransferId}`), {
      data,
      ...(headers ? { headers } : {}),
    });

  reverse = (
    fxTransferId: string,
    data: unknown = {},
    headers?: Record<string, string>,
  ): Promise<APIResponse> =>
    this.request.post(apiUrl(`/fx-transfers/${fxTransferId}/reverse`), {
      data,
      ...(headers ? { headers } : {}),
    });
}
