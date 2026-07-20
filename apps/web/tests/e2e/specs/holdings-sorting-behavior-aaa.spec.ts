import { randomUUID } from "node:crypto";
import { type Locator, type Page } from "@playwright/test";
import { test } from "@vakwen/test-e2e/fixtures/appPages";
import { seedQuoteBars } from "./helpers/anonymousShare.js";
import { HoldingsSortingAssert } from "./helpers/HoldingsSortingAssert.js";
import {
  seedAccountForUser,
  seedTransactionForUser,
  seedUser,
  switchIdentity,
} from "./helpers/sharing.js";

const sortingAssert = new HoldingsSortingAssert();

async function seedHolding(
  userId: string,
  ticker: string,
  quantity: number,
  accountId?: string,
): Promise<void> {
  await seedTransactionForUser(userId, {
    accountId,
    quantity,
    ticker,
    tradeDate: "2026-07-15",
    unitPrice: 100,
  });
  await seedQuoteBars([{
    barDate: "2026-07-16",
    close: 110,
    high: 112,
    low: 108,
    open: 109,
    ticker,
    volume: 10_000,
  }]);
}

async function createSortingUser(label: string): Promise<{ userId: string }> {
  const seedId = randomUUID();
  return seedUser({
    email: `holdings-sorting-${label}-${seedId}@example.com`,
    name: `Holdings Sorting ${label}`,
    role: "member",
    sub: `e2e-holdings-sorting-${label}-${seedId}`,
  });
}

async function clickAndWaitForPreferencePatch(page: Page, target: Locator): Promise<Record<string, unknown>> {
  const responsePromise = page.waitForResponse((response) => (
    response.request().method() === "PATCH"
    && response.url().endsWith("/user-preferences")
  ));
  await target.click();
  const response = await responsePromise;
  await sortingAssert.preferencePatchSucceeded(response);
  return response.request().postDataJSON() as Record<string, unknown>;
}

test.describe("holdings sorting behavior", () => {
  test("[Dashboard sorting]: sort Ticker ascending → order persists after reload", async ({
    appShell,
    page,
  }) => {
    const member = await createSortingUser("dashboard");
    await seedHolding(member.userId, "8892", 10);
    await seedHolding(member.userId, "8891", 20);
    await switchIdentity(page, { role: "member", userId: member.userId });

    await appShell.actions.navigateToRoute("/dashboard");
    await appShell.assert.appIsReady();
    const holdings = page.getByTestId("dashboard-holdings-section");
    await sortingAssert.isVisible(holdings);

    const tickerSort = holdings.getByTestId("dashboard-holdings-column-sort-ticker");
    await clickAndWaitForPreferencePatch(page, tickerSort);
    await sortingAssert.ariaSort(tickerSort, "ascending");
    await sortingAssert.testIdOrder(
      holdings.locator('tbody > tr[data-testid^="dashboard-holding-table-row-"]'),
      ["dashboard-holding-table-row-8891-TW", "dashboard-holding-table-row-8892-TW"],
    );

    await page.reload({ waitUntil: "domcontentloaded" });
    await appShell.assert.appIsReady();
    await sortingAssert.isVisible(holdings);
    await sortingAssert.ariaSort(tickerSort, "ascending");
    await sortingAssert.testIdOrder(
      holdings.locator('tbody > tr[data-testid^="dashboard-holding-table-row-"]'),
      ["dashboard-holding-table-row-8891-TW", "dashboard-holding-table-row-8892-TW"],
    );
  });

  test("[Portfolio hierarchy]: sort aggregate and child Quantity → mobile direction stays synchronized", async ({
    appShell,
    page,
  }) => {
    const member = await createSortingUser("portfolio");
    const primary = await seedAccountForUser(member.userId, { name: "Quantity Primary" });
    const secondary = await seedAccountForUser(member.userId, { name: "Quantity Secondary" });
    await seedHolding(member.userId, "8893", 30, primary.id);
    await seedHolding(member.userId, "8893", 10, secondary.id);
    await seedHolding(member.userId, "8894", 5, primary.id);
    await switchIdentity(page, { role: "member", userId: member.userId });

    await appShell.actions.navigateToRoute("/portfolio");
    await appShell.assert.appIsReady();
    const holdings = page.getByTestId("portfolio-holdings-section");
    await sortingAssert.isVisible(holdings);

    await page.getByTestId("holdings-display-mode-select").click();
    await page.getByTestId("holdings-display-mode-expanded").click();
    const quantitySort = holdings.getByTestId("holdings-column-sort-quantity");
    await clickAndWaitForPreferencePatch(page, quantitySort);
    await sortingAssert.ariaSort(quantitySort, "descending");
    await sortingAssert.testIdOrder(
      holdings.locator('tbody > tr[data-testid^="holding-group-row-"]'),
      ["holding-group-row-8893-TW", "holding-group-row-8894-TW"],
    );
    await sortingAssert.testIdOrder(
      holdings.locator('tbody > tr[data-testid^="holding-child-row-8893-TW-"]'),
      [
        `holding-child-row-8893-TW-${primary.id}`,
        `holding-child-row-8893-TW-${secondary.id}`,
      ],
    );

    await page.setViewportSize({ height: 844, width: 390 });
    const mobileDirection = holdings.getByTestId("holdings-mobile-sort-direction");
    await sortingAssert.containsText(mobileDirection, /descending/i);
    await clickAndWaitForPreferencePatch(page, mobileDirection);
    await sortingAssert.containsText(mobileDirection, /ascending/i);
    await sortingAssert.testIdOrder(
      holdings.locator('[data-testid^="holding-group-mobile-row-"]'),
      ["holding-group-mobile-row-8894-TW", "holding-group-mobile-row-8893-TW"],
    );
    await sortingAssert.testIdOrder(
      holdings.locator('[data-testid^="holding-child-mobile-row-8893-TW-"]'),
      [
        `holding-child-mobile-row-8893-TW-${secondary.id}`,
        `holding-child-mobile-row-8893-TW-${primary.id}`,
      ],
    );
  });

  test("[Reports isolation]: sort Portfolio Ticker → Daily Review retains its own default sort", async ({
    appShell,
    page,
  }) => {
    const member = await createSortingUser("reports");
    await seedHolding(member.userId, "8896", 10);
    await seedHolding(member.userId, "8895", 20);
    await switchIdentity(page, { role: "member", userId: member.userId });

    await appShell.actions.navigateToRoute("/reports?tab=portfolio&scope=all&range=1Y");
    await appShell.assert.appIsReady();
    const portfolioTable = page.getByTestId("reports-holdings-table-reports.portfolio.holdings");
    await sortingAssert.isVisible(portfolioTable);
    const tickerSort = portfolioTable.getByTestId("holdings-column-sort-ticker");
    const patch = await clickAndWaitForPreferencePatch(page, tickerSort);
    await sortingAssert.preferencePatchHasIsolatedSort(patch, "reports.portfolio.holdings", {
      sortDirection: "asc",
      sortField: "ticker",
      sortMode: "field",
    }, "reports.dailyReview.holdings");
    await sortingAssert.ariaSort(tickerSort, "ascending");

    await appShell.actions.navigateToRoute("/reports?tab=daily-review&scope=all&range=1Y");
    const dailyTable = page.getByTestId("reports-holdings-table-reports.dailyReview.holdings");
    await sortingAssert.isVisible(dailyTable);
    const dailyMarketValueSort = dailyTable.getByTestId("holdings-column-sort-marketValue");
    await sortingAssert.ariaSort(dailyMarketValueSort, "descending");
    await sortingAssert.hasNoAriaSort(dailyTable.getByTestId("holdings-column-sort-ticker"));
  });
});
