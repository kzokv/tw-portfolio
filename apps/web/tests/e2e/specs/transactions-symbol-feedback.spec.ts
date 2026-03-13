import { expect, test, type Page } from "@playwright/test";
import { gotoApp, openQuickTransaction } from "../helpers/flows";

async function submitTransactionAndRefresh(page: Page) {
  const transactionPosted = page.waitForResponse((response) => {
    return response.request().method() === "POST" && response.url().includes("/portfolio/transactions") && response.ok();
  });
  const dashboardRefreshed = page.waitForResponse((response) => {
    return response.request().method() === "GET" && response.url().includes("/dashboard/overview") && response.ok();
  });

  await page.getByTestId("tx-submit-button").click();
  await transactionPosted;
  await dashboardRefreshed;
}

test.describe("transaction symbol suggestions and feedback", () => {
  test("records 0050 buy and sell transactions and shows submit feedback", async ({ page }) => {
    await page.context().setExtraHTTPHeaders({ "x-user-id": "e2e-tx-0050-success" });
    await gotoApp(page);
    await openQuickTransaction(page);

    const accountSelect = page.getByTestId("tx-account-select");
    const firstAccountId = await accountSelect.locator("option").first().getAttribute("value");
    await accountSelect.selectOption(firstAccountId ?? "acc-1");

    const symbolSelect = page.getByTestId("tx-symbol-select");
    await expect(symbolSelect.locator("option")).toHaveCount(4);
    await expect(symbolSelect.locator("option")).toHaveText([
      "2330 (Stock)",
      "0050 (ETF)",
      "00919 (ETF)",
      "0056 (ETF)",
    ]);

    await symbolSelect.selectOption("0050");
    await page.getByTestId("tx-trade-date-input").fill("2026-02-03");
    await page.getByTestId("tx-type-select").selectOption("BUY");
    await page.getByTestId("tx-quantity-input").fill("20");
    await page.getByTestId("tx-price-input").fill("100");

    await submitTransactionAndRefresh(page);
    await expect(page.getByTestId("transaction-status")).toContainText(/Transaction recorded successfully|交易已成功寫入/);
    await expect(page.getByTestId("holdings-table").locator("tr", { hasText: "0050" })).toContainText("20");

    await page.getByTestId("tx-trade-date-input").fill("2026-02-05");
    await page.getByTestId("tx-type-select").selectOption("SELL");
    await page.getByTestId("tx-quantity-input").fill("5");
    await page.getByTestId("tx-price-input").fill("120");

    await submitTransactionAndRefresh(page);
    await expect(page.getByTestId("transaction-status")).toContainText(/Transaction recorded successfully|交易已成功寫入/);
    await expect(page.getByTestId("holdings-table").locator("tr", { hasText: "0050" })).toContainText("15");
  });
});
