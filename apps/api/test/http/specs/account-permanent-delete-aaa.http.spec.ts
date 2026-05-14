/**
 * ui-enhancement — HTTP API tests for POST /accounts/:id/purge
 * (skip-wait "Permanently delete now" with typed-name confirmation).
 *
 * Per architect-design §6, the route accepts an active (non-soft-deleted)
 * account in addition to soft-deleted ones — `mustBeSoftDeleted=false` is
 * passed in the route. Confirmation is by typed account name in
 * `{ confirmationName: string }`.
 *
 * Errors follow `service-error-pattern.md` (`body.error`, never `body.code`):
 *  - 400 confirmation_name_mismatch
 *  - 404 account_not_found
 */

import { test } from "../fixtures.js";

test.describe("POST /accounts/:id/purge (ui-enhancement)", () => {
  test("happy path on an active account: typed-name match → 200 + account vanishes from GET /accounts", async ({
    accountsApi,
  }) => {
    // Arrange — fresh active account.
    const created = await accountsApi.actions.createAccount({
      name: "Purge Now Target",
      defaultCurrency: "TWD",
      accountType: "broker",
    });
    const createdBody = (await accountsApi.arrange.body(created)) as Record<string, unknown>;
    const id = String(createdBody.id);

    // Act
    const response = await accountsApi.actions.permanentlyDeleteAccount(id, "Purge Now Target");
    await accountsApi.assert.statusIs(response, 200);
    const respBody = (await accountsApi.arrange.body(response)) as Record<string, unknown>;
    await accountsApi.assert.fieldEquals(respBody, "accountId", id);

    // Assert — gone from GET /accounts.
    const listResponse = await accountsApi.actions.listAccounts();
    const accounts = await accountsApi.arrange.accounts(listResponse);
    const found = accounts.find((a) => a["id"] === id);
    if (found) {
      throw new Error(`Expected hard-purged account ${id} to be absent from GET /accounts`);
    }

    // Assert — also gone from GET /accounts/deleted (this was a skip-wait purge).
    const deletedListResponse = await accountsApi.actions.listDeletedAccounts();
    const deleted = await accountsApi.arrange.deletedAccounts(deletedListResponse);
    const deletedRow = deleted.find((d) => d["id"] === id);
    if (deletedRow) {
      throw new Error(`Expected hard-purged account ${id} to be absent from GET /accounts/deleted`);
    }
  });

  test("happy path on a soft-deleted account: typed-name match → 200 + removed from deleted list", async ({
    accountsApi,
  }) => {
    const created = await accountsApi.actions.createAccount({
      name: "Soft Then Purge",
      defaultCurrency: "USD",
      accountType: "broker",
    });
    const id = String(
      ((await accountsApi.arrange.body(created)) as Record<string, unknown>).id,
    );

    await accountsApi.actions.softDeleteAccount(id);

    const response = await accountsApi.actions.permanentlyDeleteAccount(id, "Soft Then Purge");
    await accountsApi.assert.statusIs(response, 200);

    const deletedListResponse = await accountsApi.actions.listDeletedAccounts();
    const deleted = await accountsApi.arrange.deletedAccounts(deletedListResponse);
    if (deleted.find((d) => d["id"] === id)) {
      throw new Error(`Expected hard-purged account ${id} absent from /accounts/deleted`);
    }
  });

  test("typed-name mismatch returns 400 with body.error='confirmation_name_mismatch'", async ({
    accountsApi,
  }) => {
    const created = await accountsApi.actions.createAccount({
      name: "Mismatch Target",
      defaultCurrency: "TWD",
      accountType: "broker",
    });
    const id = String(
      ((await accountsApi.arrange.body(created)) as Record<string, unknown>).id,
    );

    const response = await accountsApi.actions.permanentlyDeleteAccount(id, "Wrong Name");
    await accountsApi.assert.statusIs(response, 400);
    const body = (await accountsApi.arrange.body(response)) as Record<string, unknown>;
    await accountsApi.assert.fieldEquals(body, "error", "confirmation_name_mismatch");
  });

  test("unknown id returns 404 with body.error='account_not_found'", async ({
    accountsApi,
  }) => {
    const response = await accountsApi.actions.permanentlyDeleteAccount(
      "acc-purge-missing",
      "anything",
    );
    await accountsApi.assert.statusIs(response, 404);
    const body = (await accountsApi.arrange.body(response)) as Record<string, unknown>;
    await accountsApi.assert.fieldEquals(body, "error", "account_not_found");
  });

  test("empty confirmationName (zod min:1) returns 400", async ({ accountsApi }) => {
    const created = await accountsApi.actions.createAccount({
      name: "Empty Conf Target",
      defaultCurrency: "TWD",
      accountType: "broker",
    });
    const id = String(
      ((await accountsApi.arrange.body(created)) as Record<string, unknown>).id,
    );

    const response = await accountsApi.actions.permanentlyDeleteAccount(id, "");
    await accountsApi.assert.statusIs(response, 400);
  });
});
