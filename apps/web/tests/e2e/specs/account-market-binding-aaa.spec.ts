/**
 * KZO-183 — Account-market binding E2E (dev_bypass / MemoryPersistence).
 *
 * Covers F4 scope items:
 *   AMB-1  Create account with "United States" currency card → market badge shown.
 *   AMB-2  BUY trade against TW account with US ticker (MSFT) → rejected at form-time
 *          with trade_market_mismatch error displayed in the global-error banner.
 *   AMB-3  BUY trade against US account with US ticker (MSFT) → succeeds.
 *
 * Ticker hygiene (e2e-shared-memory-bars-ticker-hygiene.md):
 *   MSFT — verified absent from all specs/http-specs/integration test files
 *   before this file was created.
 *
 * Default seeded state (MemoryPersistence):
 *   - Account: { id: "acc-1", name: "Main", defaultCurrency: "TWD", accountType: "broker" }
 *   - Profile: { accountId: "acc-1", name: "Default Broker" }
 *   - Instruments: 2330 / 0050 / 00919 / 0056 (all TW market).
 *     MSFT must be seeded via settings.arrange.seedInstruments for AMB-2 and AMB-3.
 *
 * Rules followed:
 *   - 2 workers parallel (e2e-aaa-guardrails.md).
 *   - No networkidle (playwright-navigation-patterns.md).
 *   - Bundle rebuild via `npm run test:e2e:bypass:mem --prefix apps/web`.
 */

import { test } from "@tw-portfolio/test-e2e/fixtures/appPages";

// ─── AMB-1 ────────────────────────────────────────────────────────────────────

test("[settings drawer]: create account with United States currency card → market badge shows for that account", async ({
  appShell,
  settings,
}) => {
  // ── Arrange ───────────────────────────────────────────────────────────────
  await appShell.actions.navigateToRoute("/portfolio");
  await appShell.actions.openSettingsDrawer();
  await settings.arrange.openAccountsTab();

  // ── Act: fill the create-account form with USD (United States) ────────────
  await settings.actions.fillAccountCreateName("US Brokerage");
  await settings.actions.selectAccountCreateType("broker");
  await settings.actions.selectAccountCreateCurrency("USD");

  // Preview chip should contain "USD" (currency code still present post-KZO-183 i18n rename).
  await settings.assert.accountCreatePreviewContains(/USD/);

  const submitResponse = await settings.actions.submitAccountCreate();
  const newAccount = (await submitResponse.json()) as { id: string };

  // ── Assert: market badge for the new account is visible ───────────────────
  // The market badge is derived from default_currency: USD → "United States" (or "US").
  // asserting with /United States|US/i guards against either label form.
  await settings.assert.accountMarketBadgeContains(newAccount.id, /United States|US/i);
});

// ─── AMB-2 ────────────────────────────────────────────────────────────────────

test("[transactions]: BUY trade against TW account with US ticker MSFT is rejected with trade_market_mismatch", async ({
  appShell,
  settings,
  transactions,
}) => {
  // ── Arrange: seed MSFT as a US-market instrument ──────────────────────────
  await settings.arrange.seedInstruments([
    {
      ticker: "MSFT",
      name: "Microsoft Corporation",
      instrumentType: "STOCK",
      marketCode: "US",
      barsBackfillStatus: "none",
    },
  ]);

  // ── Act: navigate to transactions page and attempt the mismatch trade ─────
  await transactions.actions.navigateToTransactions();

  // acc-1 is the default TWD/TW account — it is always the first option.
  await transactions.actions.selectFirstAccount();
  await transactions.assert.selectedAccountOptionContains(/Main/i);

  await transactions.actions.selectTransactionType("BUY");
  await transactions.actions.typeInTickerSearch("MSFT");
  await transactions.actions.selectTickerOption("MSFT");
  await transactions.actions.fillTradeDate("2026-01-15");
  await transactions.actions.fillQuantity(10);
  await transactions.actions.fillUnitPrice(400);

  await transactions.actions.submitTransaction();

  // ── Assert: global error banner reports the mismatch ─────────────────────
  // The service-layer guard throws:
  //   routeError(400, "trade_market_mismatch",
  //     `Trade market US does not match account acc-1 market TW`)
  // useTransactionSubmission.ts resolves error.message and sets it on the banner.
  await appShell.assert.globalErrorContains(/does not match|trade.*market/i);
});

// ─── AMB-3 ────────────────────────────────────────────────────────────────────

test("[transactions]: BUY trade against US account with US ticker MSFT succeeds (market match)", async ({
  appShell,
  settings,
  transactions,
}) => {
  // ── Arrange: seed MSFT + create a USD brokerage account ──────────────────
  await settings.arrange.seedInstruments([
    {
      ticker: "MSFT",
      name: "Microsoft Corporation",
      instrumentType: "STOCK",
      marketCode: "US",
      barsBackfillStatus: "none",
    },
  ]);

  await appShell.actions.navigateToRoute("/portfolio");
  await appShell.actions.openSettingsDrawer();
  await settings.arrange.openAccountsTab();

  await settings.actions.fillAccountCreateName("US Brokerage");
  await settings.actions.selectAccountCreateType("broker");
  await settings.actions.selectAccountCreateCurrency("USD");
  const accountResponse = await settings.actions.submitAccountCreate();
  const usAccount = (await accountResponse.json()) as { id: string };

  await settings.actions.closeWithEscape();

  // ── Act: submit a MSFT BUY against the US account ────────────────────────
  await transactions.actions.navigateToTransactions();
  await transactions.actions.selectAccountById(usAccount.id);

  await transactions.actions.selectTransactionType("BUY");
  await transactions.actions.typeInTickerSearch("MSFT");
  await transactions.actions.selectTickerOption("MSFT");
  await transactions.actions.fillTradeDate("2026-01-15");
  await transactions.actions.fillQuantity(5);
  await transactions.actions.fillUnitPrice(400);

  const txResponsePromise = transactions.actions.waitForTransactionPost();
  await transactions.actions.submitTransaction();
  await txResponsePromise;

  // ── Assert: transaction appears in the recent-transactions table ──────────
  await transactions.assert.recentTransactionsTableIsVisible();
  await transactions.assert.recentTransactionTickerIsVisible("MSFT");
});
