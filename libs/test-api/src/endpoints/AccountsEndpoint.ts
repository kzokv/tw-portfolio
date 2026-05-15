import type { APIResponse } from "@playwright/test";
import { BaseEndpoint } from "@vakwen/test-framework/core";
import { apiUrl } from "@vakwen/test-framework/shared";

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

  // KZO-179 — POST /accounts. Mirrors the FeeProfilesEndpoint.create shape.
  create = (
    data: unknown,
    headers?: Record<string, string>,
  ): Promise<APIResponse> =>
    this.request.post(apiUrl("/accounts"), {
      data,
      ...(headers ? { headers } : {}),
    });

  // ui-enhancement — DELETE /accounts/:id (soft-delete; stamps deleted_at).
  softDelete = (
    accountId: string,
    headers?: Record<string, string>,
  ): Promise<APIResponse> =>
    this.request.delete(apiUrl(`/accounts/${accountId}`), headers ? { headers } : {});

  // ui-enhancement — POST /accounts/:id/restore (clears deleted_at; auto-renames on collision).
  restore = (
    accountId: string,
    headers?: Record<string, string>,
  ): Promise<APIResponse> =>
    this.request.post(apiUrl(`/accounts/${accountId}/restore`), {
      ...(headers ? { headers } : {}),
    });

  // ui-enhancement — POST /accounts/:id/purge (hard-purge with typed-name confirmation).
  purge = (
    accountId: string,
    body: { confirmationName: string },
    headers?: Record<string, string>,
  ): Promise<APIResponse> =>
    this.request.post(apiUrl(`/accounts/${accountId}/purge`), {
      data: body,
      ...(headers ? { headers } : {}),
    });

  // ui-enhancement — GET /accounts/deleted (list soft-deleted accounts for the user).
  listDeleted = (headers?: Record<string, string>): Promise<APIResponse> =>
    this.request.get(apiUrl("/accounts/deleted"), headers ? { headers } : {});
}
