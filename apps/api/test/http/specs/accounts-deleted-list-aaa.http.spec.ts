/**
 * ui-enhancement — HTTP API tests for GET /accounts/deleted.
 *
 * Returns AccountDto-shaped rows extended with `deletedAt: string`. Ordered
 * by `deleted_at DESC` (most-recent first). Active accounts are NEVER in
 * this listing.
 */

import { test } from "../fixtures.js";

test.describe("GET /accounts/deleted (ui-enhancement)", () => {
  test("returns 200 with [] when no accounts are soft-deleted (default seeded state)", async ({
    accountsApi,
  }) => {
    const response = await accountsApi.actions.listDeletedAccounts();
    await accountsApi.assert.statusIs(response, 200);
    const body = await accountsApi.arrange.deletedAccounts(response);
    // Default seed leaves no soft-deleted rows.
    if (!Array.isArray(body)) {
      throw new Error(`Expected array body; got ${typeof body}`);
    }
    // Lenient: assert that no previously-active seeded account is here.
    if (body.find((row) => row["id"] === "acc-1")) {
      throw new Error("Did not expect default-seeded acc-1 in deleted list");
    }
  });

  test("includes soft-deleted accounts with deletedAt ISO and excludes active ones", async ({
    accountsApi,
  }) => {
    // Arrange — create two accounts; soft-delete one.
    const a = await accountsApi.actions.createAccount({
      name: "Deleted List A",
      defaultCurrency: "TWD",
      accountType: "broker",
    });
    const aId = String(((await accountsApi.arrange.body(a)) as Record<string, unknown>).id);

    const b = await accountsApi.actions.createAccount({
      name: "Active List B",
      defaultCurrency: "USD",
      accountType: "broker",
    });
    const bId = String(((await accountsApi.arrange.body(b)) as Record<string, unknown>).id);

    await accountsApi.actions.softDeleteAccount(aId);

    // Act
    const response = await accountsApi.actions.listDeletedAccounts();
    await accountsApi.assert.statusIs(response, 200);
    const body = await accountsApi.arrange.deletedAccounts(response);

    // Assert — A present with deletedAt; B absent.
    const aRow = body.find((row) => row["id"] === aId);
    if (!aRow) throw new Error(`Expected soft-deleted account ${aId} in /accounts/deleted`);
    if (typeof aRow.deletedAt !== "string" || aRow.deletedAt.length === 0) {
      throw new Error(`Expected deletedAt ISO string; got ${String(aRow.deletedAt)}`);
    }
    await accountsApi.assert.fieldEquals(aRow, "name", "Deleted List A");

    if (body.find((row) => row["id"] === bId)) {
      throw new Error(`Did not expect active account ${bId} in /accounts/deleted`);
    }
  });

  test("rows reappear after restore: a restored account leaves the deleted list", async ({
    accountsApi,
  }) => {
    const created = await accountsApi.actions.createAccount({
      name: "Restore Flow",
      defaultCurrency: "USD",
      accountType: "broker",
    });
    const id = String(((await accountsApi.arrange.body(created)) as Record<string, unknown>).id);

    await accountsApi.actions.softDeleteAccount(id);

    // Confirm in deleted list.
    const before = await accountsApi.arrange.deletedAccounts(
      await accountsApi.actions.listDeletedAccounts(),
    );
    if (!before.find((row) => row["id"] === id)) {
      throw new Error("Pre-restore: expected account to be in deleted list");
    }

    await accountsApi.actions.restoreAccount(id);

    const after = await accountsApi.arrange.deletedAccounts(
      await accountsApi.actions.listDeletedAccounts(),
    );
    if (after.find((row) => row["id"] === id)) {
      throw new Error("Post-restore: did not expect account to remain in deleted list");
    }
  });
});
