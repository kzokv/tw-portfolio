import type { APIResponse } from "@playwright/test";
import { BaseEndpoint } from "@vakwen/test-framework/core";
import { apiUrl } from "@vakwen/test-framework/shared";

export class AnonymousShareTokensEndpoint extends BaseEndpoint {
  create = (
    data: { expiresInDays: number },
    headers?: Record<string, string>,
  ): Promise<APIResponse> =>
    this.request.post(apiUrl("/share-tokens"), {
      data,
      ...(headers ? { headers } : {}),
    });

  list = (headers?: Record<string, string>): Promise<APIResponse> =>
    this.request.get(apiUrl("/share-tokens"), headers ? { headers } : {});

  revoke = (tokenId: string, headers?: Record<string, string>): Promise<APIResponse> =>
    this.request.delete(apiUrl(`/share-tokens/${tokenId}`), headers ? { headers } : {});

  // Public, unauthenticated. Deliberately never forwards cookies or auth headers.
  publicView = (token: string): Promise<APIResponse> =>
    this.request.get(apiUrl(`/share/${token}`));
}
