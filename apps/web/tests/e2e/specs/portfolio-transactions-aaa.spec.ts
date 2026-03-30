import { test } from "@tw-portfolio/test-e2e/fixtures/appPages";

test("transaction submission updates the verification panel and recent ledger", async ({ transactions }) => {
  await transactions.actions.navigateToTransactions();

  const transactionPosted = transactions.actions.waitForTransactionPost();
  const dashboardRefreshed = transactions.actions.waitForDashboardRefresh();
  const ledgerRefreshed = transactions.actions.waitForLedgerRefresh();

  await transactions.actions.selectFirstAccount();
  await transactions.actions.submitTransaction();
  await transactionPosted;
  await dashboardRefreshed;
  await ledgerRefreshed;

  await transactions.assert.transactionStatusContains(/Transaction recorded successfully|交易已成功寫入/);
  await transactions.assert.verificationPanelIsVisible();
  await transactions.assert.recentTransactionsTableIsVisible();
  await transactions.assert.recentTransactionTickerIsVisible("2330");
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
