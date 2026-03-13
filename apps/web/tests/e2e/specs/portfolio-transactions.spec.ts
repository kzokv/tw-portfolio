import { test, expect } from "../fixtures/test";
import { gotoRoute, waitForAppReady } from "../helpers/flows";

test("transaction submission updates the verification panel and recent ledger", async ({ page }) => {
  await gotoRoute(page, "/transactions");

  const accountSelect = page.getByTestId("tx-account-select");
  const firstAccountOption = accountSelect.locator("option").first();
  await expect(firstAccountOption).toHaveAttribute("value", /.+/);
  const firstAccountId = await firstAccountOption.getAttribute("value");
  await accountSelect.selectOption(firstAccountId ?? "acc-1");

  const transactionPosted = page.waitForResponse((response) =>
    response.request().method() === "POST" && response.url().includes("/portfolio/transactions") && response.ok());
  const dashboardRefreshed = page.waitForResponse((response) =>
    response.request().method() === "GET" && response.url().includes("/dashboard/overview") && response.ok());
  const ledgerRefreshed = page.waitForResponse((response) =>
    response.request().method() === "GET" && response.url().includes("/portfolio/transactions?limit=6") && response.ok());

  await page.getByTestId("tx-submit-button").click();
  await transactionPosted;
  await dashboardRefreshed;
  await ledgerRefreshed;

  await expect(page.getByTestId("transaction-status")).toContainText(/Transaction recorded successfully|交易已成功寫入/);
  await expect(page.getByTestId("transactions-verification-panel")).toBeVisible();

  const recentTransactionsTable = page
    .getByTestId("recent-transactions-card")
    .getByTestId("recent-transactions-table");

  await expect(recentTransactionsTable).toBeVisible();
  await expect(
    recentTransactionsTable.getByRole("link", { name: "2330" }),
  ).toBeVisible();

});

test("recompute flow completes within the dashboard route", async ({ page }) => {
  await gotoRoute(page, "/");

  page.once("dialog", (dialog) => dialog.accept());

  const previewResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" && response.url().includes("/portfolio/recompute/preview") && response.ok());
  const confirmResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" && response.url().includes("/portfolio/recompute/confirm") && response.ok());

  await page.getByTestId("recompute-button").click();
  await previewResponse;
  await confirmResponse;
  await waitForAppReady(page);

  await expect(page.getByTestId("recompute-status")).toContainText(/Recompute CONFIRMED|重算已確認/);
});
