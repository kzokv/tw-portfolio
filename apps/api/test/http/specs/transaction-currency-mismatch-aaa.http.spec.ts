/**
 * ui-enhancement — HTTP API spec for the server-side currency_mismatch
 * guard at POST /portfolio/transactions.
 *
 * Rationale (architect-design Cluster F Option 2):
 *
 *   The ui-enhancement source change (scope items 22–23, "one-way binding
 *   account → chip") removed the KZO-169 chip→account dropdown filter +
 *   `tx-no-account-error` UX. The client form no longer blocks mismatched
 *   trades; the SERVER is the canonical enforcement layer.
 *
 *   Pre-existing E2E specs that asserted the client-side block UX
 *   (`account-market-binding-aaa`, `au-backfill-aaa`, `us-backfill-aaa`,
 *   `transaction-form-market-code-aaa`) were converted in this same change
 *   to assert only `priceCurrencyIs(<chipCurrency>)`. The server-side guard
 *   is covered HERE.
 *
 * Server-side guard:
 *   `apps/api/src/routes/registerRoutes.ts:3415-3430` — when
 *   `currencyFor(body.marketCode) !== account.defaultCurrency`, the route
 *   throws `routeError(400, "currency_mismatch", ...)`. JSON envelope per
 *   `service-error-pattern.md` — body.error carries the code; body.message
 *   carries the human text.
 */

import { transactionPayload } from "../../helpers/fixtures.js";
import { test } from "../fixtures.js";

test.describe("POST /portfolio/transactions — currency_mismatch guard (ui-enhancement)", () => {
  test("US ticker (marketCode='US') against the default TWD 'acc-1' account → 400 currency_mismatch", async ({
    accountsApi,
    transactionsApi,
  }) => {
    // Arrange — confirm acc-1 is TWD (seeded default per AGENTS.md fixtures).
    const listResponse = await accountsApi.actions.listAccounts();
    await accountsApi.assert.statusIs(listResponse, 200);
    const accounts = await accountsApi.arrange.accounts(listResponse);
    const accMain = accounts.find((a) => a["id"] === "acc-1");
    if (!accMain) {
      throw new Error("Expected seeded 'acc-1' default account");
    }
    await accountsApi.assert.fieldEquals(accMain, "defaultCurrency", "TWD");

    // Act — submit a US-market trade against the TWD account.
    const response = await transactionsApi.actions.createTransaction(
      transactionPayload({
        accountId: "acc-1",
        ticker: "AAPL",
        marketCode: "US",
        priceCurrency: "USD",
      }),
      "currency-mismatch-us-into-twd",
    );

    // Assert — 400 with `body.error === "currency_mismatch"` per
    // service-error-pattern.md JSON envelope shape.
    await transactionsApi.assert.statusIs(response, 400);
    const body = (await transactionsApi.arrange.body(response)) as Record<string, unknown>;
    await transactionsApi.assert.fieldEquals(body, "error", "currency_mismatch");
  });

  test("AU ticker (marketCode='AU') against the default TWD account → 400 currency_mismatch", async ({
    transactionsApi,
  }) => {
    const response = await transactionsApi.actions.createTransaction(
      transactionPayload({
        accountId: "acc-1",
        ticker: "BHP",
        marketCode: "AU",
        priceCurrency: "AUD",
      }),
      "currency-mismatch-au-into-twd",
    );

    await transactionsApi.assert.statusIs(response, 400);
    const body = (await transactionsApi.arrange.body(response)) as Record<string, unknown>;
    await transactionsApi.assert.fieldEquals(body, "error", "currency_mismatch");
  });

  test("matched currency (TW ticker into TWD account) → 200 happy path (regression guard)", async ({
    transactionsApi,
  }) => {
    // Regression guard: confirms the 400 path above is conditional on
    // mismatch, not a blanket reject. Uses the default fixture (TW ticker
    // 2330 against TWD acc-1) so this stays a stable smoke.
    const response = await transactionsApi.actions.createTransaction(
      transactionPayload({
        accountId: "acc-1",
        ticker: "2330",
        marketCode: "TW",
        priceCurrency: "TWD",
      }),
      "currency-mismatch-regression-guard",
    );
    await transactionsApi.assert.statusIs(response, 200);
  });
});
