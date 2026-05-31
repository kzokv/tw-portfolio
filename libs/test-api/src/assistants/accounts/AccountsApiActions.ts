import type { APIResponse } from "@playwright/test";
import { Step } from "@vakwen/test-framework/decorators";
import { ApiBaseActions, headersForCookie } from "../../mixins/index.js";
import type { AccountsEndpoint } from "../../endpoints/AccountsEndpoint.js";

const CONTEXT_HEADER = "x-context-user-id";

export class AccountsApiActions extends ApiBaseActions {
  declare protected readonly _instance: AccountsEndpoint;

  @Step()
  async listAccounts(): Promise<APIResponse> {
    return this._instance.list(this.authHeaders);
  }

  @Step()
  async patchAccount(accountId: string, data: unknown): Promise<APIResponse> {
    return this._instance.patch(accountId, data, this.authHeaders);
  }

  // KZO-179 — POST /accounts driver for HTTP suite tests.
  @Step()
  async createAccount(data: unknown): Promise<APIResponse> {
    return this._instance.create(data, this.authHeaders);
  }

  // ui-enhancement — DELETE /accounts/:id (soft-delete).
  @Step()
  async softDeleteAccount(accountId: string): Promise<APIResponse> {
    return this._instance.softDelete(accountId, this.authHeaders);
  }

  // ui-enhancement — POST /accounts/:id/restore.
  @Step()
  async restoreAccount(accountId: string): Promise<APIResponse> {
    return this._instance.restore(accountId, this.authHeaders);
  }

  // ui-enhancement — POST /accounts/:id/purge with typed-name confirmation.
  @Step()
  async permanentlyDeleteAccount(
    accountId: string,
    confirmationName: string,
  ): Promise<APIResponse> {
    return this._instance.purge(accountId, { confirmationName }, this.authHeaders);
  }

  // ui-enhancement — GET /accounts/deleted (Recently deleted listing).
  @Step()
  async listDeletedAccounts(): Promise<APIResponse> {
    return this._instance.listDeleted(this.authHeaders);
  }

  // ── Cookie-auth variants for role-guard / shared-context tests ──────────

  private cookieHeaders(
    cookie: string,
    contextUserId: string | undefined,
  ): Record<string, string> {
    const headers: Record<string, string> = headersForCookie(cookie);
    if (contextUserId !== undefined) {
      headers[CONTEXT_HEADER] = contextUserId;
    }
    return headers;
  }

  @Step()
  async listAccountsForCookie(
    cookie: string,
    contextUserId?: string,
  ): Promise<APIResponse> {
    return this._instance.list(this.cookieHeaders(cookie, contextUserId));
  }

  @Step()
  async softDeleteAccountForCookie(
    cookie: string,
    accountId: string,
    contextUserId?: string,
  ): Promise<APIResponse> {
    return this._instance.softDelete(accountId, this.cookieHeaders(cookie, contextUserId));
  }

  @Step()
  async restoreAccountForCookie(
    cookie: string,
    accountId: string,
    contextUserId?: string,
  ): Promise<APIResponse> {
    return this._instance.restore(accountId, this.cookieHeaders(cookie, contextUserId));
  }

  @Step()
  async permanentlyDeleteAccountForCookie(
    cookie: string,
    accountId: string,
    confirmationName: string,
    contextUserId?: string,
  ): Promise<APIResponse> {
    return this._instance.purge(
      accountId,
      { confirmationName },
      this.cookieHeaders(cookie, contextUserId),
    );
  }

  @Step()
  async listDeletedAccountsForCookie(
    cookie: string,
    contextUserId?: string,
  ): Promise<APIResponse> {
    return this._instance.listDeleted(this.cookieHeaders(cookie, contextUserId));
  }

  @Step()
  async createAccountForCookie(
    cookie: string,
    data: unknown,
    contextUserId?: string,
  ): Promise<APIResponse> {
    return this._instance.create(data, this.cookieHeaders(cookie, contextUserId));
  }
}
