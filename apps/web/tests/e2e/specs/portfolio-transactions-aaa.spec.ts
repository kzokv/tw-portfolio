import { test } from "@vakwen/test-e2e/fixtures/appPages";

test("transaction combobox: search by ticker → submit updates the verification panel and recent ledger", async ({ settings, transactions }) => {
  await settings.arrange.seedInstruments([
    { ticker: "2330", name: "台積電", instrumentType: "STOCK", marketCode: "TW", barsBackfillStatus: "pending" },
  ]);
  await transactions.actions.navigateToTransactions();

  const transactionPosted = transactions.actions.waitForTransactionPost();
  const dashboardRefreshed = transactions.actions.waitForDashboardRefresh();
  const ledgerRefreshed = transactions.actions.waitForLedgerRefresh();

  await transactions.actions.selectFirstAccount();
  await transactions.actions.typeInTickerSearch("233");
  await transactions.assert.comboboxShowsOptions(1);
  await transactions.actions.selectTickerOption("2330");
  await transactions.assert.selectedTickerContains(/2330/);
  await transactions.actions.submitTransaction();
  await transactionPosted;
  await dashboardRefreshed;
  await ledgerRefreshed;

  await transactions.assert.transactionStatusContains(/Transaction recorded successfully|交易已成功寫入/);
  await transactions.assert.verificationPanelIsVisible();
  await transactions.assert.recentTransactionsTableIsVisible();
  await transactions.assert.recentTransactionTickerIsVisible("2330");
});

test("transaction combobox: empty catalog shows guidance", async ({ settings, transactions }) => {
  await settings.arrange.seedInstruments([]);
  await transactions.actions.navigateToTransactions();
  await transactions.actions.openTickerCombobox();
  await transactions.assert.comboboxIsEmpty(/No instruments available|目前沒有可用標的/);
});

test("transaction combobox: search by name → selection fills the field", async ({ settings, transactions }) => {
  await settings.arrange.seedInstruments([
    { ticker: "2330", name: "台積電", instrumentType: "STOCK", marketCode: "TW", barsBackfillStatus: "pending" },
    { ticker: "2317", name: "鴻海", instrumentType: "STOCK", marketCode: "TW", barsBackfillStatus: "ready" },
  ]);

  await transactions.actions.navigateToTransactions();
  await transactions.actions.typeInTickerSearch("台積");
  await transactions.assert.comboboxShowsOptions(1);
  await transactions.actions.selectTickerOption("2330");
  await transactions.assert.selectedTickerContains(/2330/);
});

test("recompute flow completes within the dashboard route", async ({ dashboard }) => {
  await dashboard.actions.navigateToDashboard();
  await dashboard.actions.acceptNextDialog();

  const previewResponse = dashboard.actions.waitForRecomputePreview();
  const confirmResponse = dashboard.actions.waitForRecomputeConfirm();

  await dashboard.actions.clickRecompute();
  await previewResponse;
  await confirmResponse;

  await dashboard.assert.recomputeStatusContains(/Recompute CONFIRMED|重算已確認/);
});
