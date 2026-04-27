/**
 * HTTP AAA tests for KZO-167: account default_currency + account_type fields.
 *
 * Covers:
 *   - GET /accounts includes defaultCurrency + accountType with correct defaults
 *   - PATCH accountType → new value (unguarded per D4)
 *   - PATCH defaultCurrency → USD on empty account (allowed per D7)
 *   - PATCH defaultCurrency after trade booked → 409 currency_change_blocked (D7 lockdown)
 *   - PATCH defaultCurrency with invalid enum value → 400 Zod validation
 *
 * Full D7 persistence/SQL layer coverage is in:
 *   apps/api/test/integration/account-currency-change-guard.integration.test.ts
 */

import { randomUUID } from "node:crypto";
import { transactionPayload } from "../../helpers/fixtures.js";
import { test } from "../fixtures.js";

test.describe("account currency and type (KZO-167)", () => {
  // ── GET shape ──────────────────────────────────────────────────────────────

  test("GET /accounts — default account includes defaultCurrency 'TWD' and accountType 'broker'", async ({
    accountsApi,
  }) => {
    const listResponse = await accountsApi.actions.listAccounts();
    await accountsApi.assert.statusIs(listResponse, 200);

    const accounts = await accountsApi.arrange.accounts(listResponse);
    await accountsApi.assert.accountCountAtLeast(accounts, 1);

    const account = await accountsApi.arrange.firstAccount(accounts);
    await accountsApi.assert.fieldEquals(account, "defaultCurrency", "TWD");
    await accountsApi.assert.fieldEquals(account, "accountType", "broker");

    // Existing fields remain intact
    await accountsApi.assert.fieldEquals(account, "id", "acc-1");
    await accountsApi.assert.fieldEquals(account, "name", "Main");
  });

  // ── PATCH accountType (unguarded) ──────────────────────────────────────────

  test("PATCH accountType → 'bank' returns 200 and GET reflects the change", async ({
    accountsApi,
  }) => {
    const patchResponse = await accountsApi.actions.patchAccount("acc-1", {
      accountType: "bank",
    });
    await accountsApi.assert.statusIs(patchResponse, 200);

    const updated = (await accountsApi.arrange.body(patchResponse)) as Record<string, unknown>;
    await accountsApi.assert.fieldEquals(updated, "accountType", "bank");

    // Confirm via a fresh GET
    const listResponse = await accountsApi.actions.listAccounts();
    const accounts = await accountsApi.arrange.accounts(listResponse);
    const account = await accountsApi.arrange.firstAccount(accounts);
    await accountsApi.assert.fieldEquals(account, "accountType", "bank");
  });

  test("PATCH accountType → 'wallet' returns 200", async ({ accountsApi }) => {
    const patchResponse = await accountsApi.actions.patchAccount("acc-1", {
      accountType: "wallet",
    });
    await accountsApi.assert.statusIs(patchResponse, 200);
    const updated = (await accountsApi.arrange.body(patchResponse)) as Record<string, unknown>;
    await accountsApi.assert.fieldEquals(updated, "accountType", "wallet");
  });

  // ── PATCH defaultCurrency on empty account (D7 — allowed) ─────────────────

  test("PATCH defaultCurrency → 'USD' on empty account returns 200 and persists", async ({
    accountsApi,
  }) => {
    const patchResponse = await accountsApi.actions.patchAccount("acc-1", {
      defaultCurrency: "USD",
    });
    await accountsApi.assert.statusIs(patchResponse, 200);

    const updated = (await accountsApi.arrange.body(patchResponse)) as Record<string, unknown>;
    await accountsApi.assert.fieldEquals(updated, "defaultCurrency", "USD");

    // Confirm persisted via re-GET
    const listResponse = await accountsApi.actions.listAccounts();
    const accounts = await accountsApi.arrange.accounts(listResponse);
    const account = await accountsApi.arrange.firstAccount(accounts);
    await accountsApi.assert.fieldEquals(account, "defaultCurrency", "USD");
  });

  test("PATCH defaultCurrency → 'AUD' on empty account returns 200", async ({
    accountsApi,
  }) => {
    const patchResponse = await accountsApi.actions.patchAccount("acc-1", {
      defaultCurrency: "AUD",
    });
    await accountsApi.assert.statusIs(patchResponse, 200);
    const updated = (await accountsApi.arrange.body(patchResponse)) as Record<string, unknown>;
    await accountsApi.assert.fieldEquals(updated, "defaultCurrency", "AUD");
  });

  // ── PATCH defaultCurrency after trade booked (D7 — blocked) ───────────────

  test("PATCH defaultCurrency → 'USD' after booking a TWD trade returns 409 currency_change_blocked", async ({
    accountsApi,
    transactionsApi,
  }) => {
    // Arrange — book a trade to create cash ledger entries for acc-1
    const txResponse = await transactionsApi.actions.createTransaction(
      transactionPayload({
        accountId: "acc-1",
        ticker: "2330",
        priceCurrency: "TWD",
        type: "BUY",
        quantity: 10,
        unitPrice: 1000,
        commissionAmount: 20,
        taxAmount: 0,
        isDayTrade: false,
      }),
      randomUUID(),
    );
    await transactionsApi.assert.statusIs(txResponse, 200);

    // Act — attempt to change defaultCurrency (now blocked by D7)
    const patchResponse = await accountsApi.actions.patchAccount("acc-1", {
      defaultCurrency: "USD",
    });

    // Assert — blocked with 409
    await accountsApi.assert.statusIs(patchResponse, 409);
    const errorBody = (await accountsApi.arrange.body(patchResponse)) as Record<string, unknown>;
    await accountsApi.assert.fieldEquals(errorBody, "error", "currency_change_blocked");
  });

  // ── Zod enum validation ────────────────────────────────────────────────────

  test("PATCH defaultCurrency → 'EUR' (not in enum) returns 400", async ({
    accountsApi,
  }) => {
    // EUR is not in ['TWD','USD','AUD']; Zod should reject it before the route handler runs
    const patchResponse = await accountsApi.actions.patchAccount("acc-1", {
      defaultCurrency: "EUR",
    });
    await accountsApi.assert.statusIs(patchResponse, 400);
  });

  test("PATCH accountType → 'investment' (not in enum) returns 400", async ({
    accountsApi,
  }) => {
    const patchResponse = await accountsApi.actions.patchAccount("acc-1", {
      accountType: "investment",
    });
    await accountsApi.assert.statusIs(patchResponse, 400);
  });

  test("PATCH with no recognised fields returns 400 (at-least-one-field constraint)", async ({
    accountsApi,
  }) => {
    const patchResponse = await accountsApi.actions.patchAccount("acc-1", {
      unknownField: "value",
    });
    await accountsApi.assert.statusIs(patchResponse, 400);
  });

  // ── accountType change is unguarded even with trade history (D4) ───────────

  test("PATCH accountType is always allowed — even when the account has trade history", async ({
    accountsApi,
    transactionsApi,
  }) => {
    // Book a trade first
    await transactionsApi.actions.createTransaction(
      transactionPayload({
        accountId: "acc-1",
        priceCurrency: "TWD",
        type: "BUY",
        quantity: 5,
        unitPrice: 500,
      }),
      randomUUID(),
    );

    // accountType change should still succeed (D4: unguarded)
    const patchResponse = await accountsApi.actions.patchAccount("acc-1", {
      accountType: "bank",
    });
    await accountsApi.assert.statusIs(patchResponse, 200);
    const updated = (await accountsApi.arrange.body(patchResponse)) as Record<string, unknown>;
    await accountsApi.assert.fieldEquals(updated, "accountType", "bank");
  });
});
