import { expect, test, type Page } from "@playwright/test";
import { gotoApp } from "../helpers/flows";

type TransactionResponse = {
  commissionNtd: number;
  taxNtd: number;
  realizedPnlNtd?: number;
};

type HoldingsResponse = Array<{
  accountId: string;
  symbol: string;
  quantity: number;
  costNtd: number;
}>;

async function submitTransactionAndCapture(page: Page) {
  const transactionPosted = page.waitForResponse((response) => {
    return (
      response.request().method() === "POST" &&
      response.url().includes("/portfolio/transactions")
    );
  });
  const holdingsRefreshed = page.waitForResponse((response) => {
    return (
      response.request().method() === "GET" &&
      response.url().includes("/portfolio/holdings") &&
      response.ok()
    );
  });

  await page.getByTestId("tx-submit-button").click();
  const txResponse = await transactionPosted;
  const holdingsResponse = await holdingsRefreshed;
  return {
    txResponse,
    txBody: (await txResponse.json()) as TransactionResponse,
    holdingsBody: (await holdingsResponse.json()) as HoldingsResponse,
  };
}

test.use({
  extraHTTPHeaders: {
    "x-user-id": "e2e-tx-weighted",
  },
});

test.describe("transactions weighted-average buy/sell", () => {
  test("computes realized pnl and remaining holding cost with weighted average", async ({ page }) => {
    await gotoApp(page);

    const accountSelect = page.getByTestId("tx-account-select");
    const firstAccountId = await accountSelect.locator("option").first().getAttribute("value");
    await accountSelect.selectOption(firstAccountId ?? "acc-1");

    await page.getByTestId("tx-symbol-input").fill("2330");
    await page.getByTestId("tx-trade-date-input").fill("2026-01-01");
    await page.getByTestId("tx-type-select").selectOption("BUY");
    await page.getByTestId("tx-quantity-input").fill("10");
    await page.getByTestId("tx-price-input").fill("100");
    const firstBuy = await submitTransactionAndCapture(page);
    expect(firstBuy.txResponse.ok()).toBe(true);

    await page.getByTestId("tx-trade-date-input").fill("2026-01-02");
    await page.getByTestId("tx-type-select").selectOption("BUY");
    await page.getByTestId("tx-quantity-input").fill("10");
    await page.getByTestId("tx-price-input").fill("200");
    const secondBuy = await submitTransactionAndCapture(page);
    expect(secondBuy.txResponse.ok()).toBe(true);

    await page.getByTestId("tx-trade-date-input").fill("2026-01-03");
    await page.getByTestId("tx-type-select").selectOption("SELL");
    await page.getByTestId("tx-quantity-input").fill("5");
    await page.getByTestId("tx-price-input").fill("300");
    const sell = await submitTransactionAndCapture(page);
    expect(sell.txResponse.ok()).toBe(true);

    expect(sell.txBody.commissionNtd).toBe(20);
    expect(sell.txBody.taxNtd).toBe(4);
    expect(sell.txBody.realizedPnlNtd).toBe(716);

    const holding2330 = sell.holdingsBody.find((row) => row.accountId === (firstAccountId ?? "acc-1") && row.symbol === "2330");
    expect(holding2330).toBeDefined();
    expect(holding2330?.quantity).toBe(15);
    expect(holding2330?.costNtd).toBe(2280);

    const row = page.getByTestId("holdings-table").locator("tr", { hasText: "2330" });
    await expect(row).toContainText("15");
    await expect(row).toContainText("2,280");
  });
});
