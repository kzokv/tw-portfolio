import { expect, test, type Page } from "@playwright/test";
import { appUrl, gotoApp, openQuickTransaction } from "../helpers/flows";

async function submitTransaction(page: Page, symbol: string): Promise<string> {
  await gotoApp(page);
  await openQuickTransaction(page);

  const accountSelect = page.getByTestId("tx-account-select");
  const firstAccountOption = accountSelect.locator("option").first();
  const accountId = await firstAccountOption.evaluate((option) => option.getAttribute("value"));
  await accountSelect.selectOption(accountId!);
  await page.getByTestId("tx-symbol-select").selectOption(symbol);

  const transactionPosted = page.waitForResponse((response) => {
    return response.request().method() === "POST" && response.url().includes("/portfolio/transactions") && response.ok();
  });
  const dashboardRefreshed = page.waitForResponse((response) => {
    return response.request().method() === "GET" && response.url().includes("/dashboard/overview") && response.ok();
  });

  await page.getByTestId("tx-submit-button").click();
  await transactionPosted;
  await dashboardRefreshed;

  return accountId ?? "acc-1";
}

test.describe("dashboard symbol history", () => {
  test("submits a predefined symbol and shows it in holdings", async ({ page }) => {
    const symbol = "00919";
    const accountId = await submitTransaction(page, symbol);

    await expect(
      page.getByTestId("holdings-table").getByTestId(`holding-history-link-${accountId}-${symbol}`),
    ).toBeVisible();
  });

  test("builds a dedicated symbol history link from holdings and loads the target page", async ({ page }) => {
    const symbol = "0056";
    const accountId = await submitTransaction(page, symbol);

    const historyLink = page
      .getByTestId("holdings-table")
      .getByTestId(`holding-history-link-${accountId}-${symbol}`);
    await expect(historyLink).toHaveAttribute(
      "href",
      `/symbols/${symbol}?accountId=${accountId}`,
    );
    await page.goto(appUrl(`/symbols/${symbol}?accountId=${accountId}`));

    await expect(page).toHaveURL(new RegExp(`/symbols/${symbol}\\?accountId=${accountId}$`));
    await expect(page.getByTestId("symbol-history-title")).toHaveText(symbol);
    await expect(page.getByTestId("symbol-history-account-scope")).toHaveText(accountId);
  });

  test("keeps desktop holdings columns reachable through horizontal scroll", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await submitTransaction(page, "2330");

    const metrics = await page.getByTestId("holdings-table-scroll").evaluate((element) => {
      const node = element as HTMLDivElement;
      node.scrollLeft = node.scrollWidth;
      return {
        clientWidth: node.clientWidth,
        scrollWidth: node.scrollWidth,
        scrollLeft: node.scrollLeft,
      };
    });

    expect(metrics.scrollWidth).toBeGreaterThan(metrics.clientWidth);
    expect(metrics.scrollLeft).toBeGreaterThan(0);
  });
});
