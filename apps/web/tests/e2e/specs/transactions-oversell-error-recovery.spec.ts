import { expect, test } from "@playwright/test";
import { gotoApp, openQuickTransaction } from "../helpers/flows";

test.use({
  extraHTTPHeaders: {
    "x-user-id": "e2e-tx-oversell",
  },
});

test.describe("transactions oversell recovery", () => {
  test("shows error for oversell and recovers after a valid buy", async ({ page }) => {
    await gotoApp(page);
    await openQuickTransaction(page);

    const accountSelect = page.getByTestId("tx-account-select");
    const firstAccountId = await accountSelect.locator("option").first().getAttribute("value");
    await accountSelect.selectOption(firstAccountId ?? "acc-1");

    await page.getByTestId("tx-symbol-select").selectOption("0050");
    await page.getByTestId("tx-trade-date-input").fill("2026-01-01");
    await page.getByTestId("tx-type-select").selectOption("SELL");
    await page.getByTestId("tx-quantity-input").fill("999999");
    await page.getByTestId("tx-price-input").fill("100");

    const failedSell = page.waitForResponse((response) => {
      return (
        response.request().method() === "POST" &&
        response.url().includes("/portfolio/transactions")
      );
    });

    await page.getByTestId("tx-submit-button").click();
    const failedSellResponse = await failedSell;
    expect(failedSellResponse.ok()).toBe(false);
    await expect(page.getByTestId("global-error-banner")).toBeVisible();
    await expect(page.getByTestId("global-error-banner")).not.toContainText("Error:");
    await expect(page.getByTestId("global-error-banner")).not.toContainText("{\"statusCode\"");

    await page.getByTestId("tx-type-select").selectOption("BUY");
    await page.getByTestId("tx-quantity-input").fill("1");
    await page.getByTestId("tx-price-input").fill("100");

    const successfulBuy = page.waitForResponse((response) => {
      return (
        response.request().method() === "POST" &&
        response.url().includes("/portfolio/transactions") &&
        response.ok()
      );
    });
    const holdingsRefreshed = page.waitForResponse((response) => {
      return (
        response.request().method() === "GET" &&
        response.url().includes("/dashboard/overview") &&
        response.ok()
      );
    });

    await page.getByTestId("tx-submit-button").click();
    await successfulBuy;
    await holdingsRefreshed;

    await expect(page.getByTestId("global-error-banner")).toHaveCount(0);
    await expect(page.getByTestId("transaction-status")).toContainText(/Transaction recorded successfully|交易已成功寫入/);
    await expect(page.getByTestId("holdings-table").locator("tr", { hasText: "0050" })).toBeVisible();
  });
});
