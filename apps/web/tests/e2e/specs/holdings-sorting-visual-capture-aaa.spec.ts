import path from "node:path";
import { type Locator, type Page } from "@playwright/test";
import { test } from "@vakwen/test-e2e/fixtures/appPages";
import { publicPagesTest } from "@vakwen/test-e2e/fixtures";
import { seedQuoteBars, seedSingleAnonymousShareToken } from "./helpers/anonymousShare.js";
import { seedTransactionForUser, seedUser } from "./helpers/sharing.js";
import { HoldingsSortingAssert } from "./helpers/HoldingsSortingAssert.js";

const sortingAssert = new HoldingsSortingAssert();

const screenshotsDir = path.resolve(
  process.cwd(),
  "../../.worklog/team/screenshots/holdings-sorting",
);

async function capture(
  page: Page,
  target: Locator,
  name: string,
  width: number,
  height: number,
): Promise<void> {
  await page.setViewportSize({ width, height });
  await target.scrollIntoViewIfNeeded();
  await page.evaluate(async () => { await document.fonts.ready; });
  await page.screenshot({
    animations: "disabled",
    fullPage: false,
    path: path.join(screenshotsDir, `${name}-${width}x${height}.png`),
  });
}

async function seedVisualHolding(e2eUserId: string, ticker: string): Promise<void> {
  await seedTransactionForUser(e2eUserId, {
    quantity: 18,
    ticker,
    tradeDate: "2026-02-04",
    unitPrice: 120,
  });
  await seedQuoteBars([{
    barDate: "2026-05-15",
    close: 150,
    high: 150,
    low: 150,
    open: 150,
    ticker,
    volume: 1_000,
  }]);
}

test.describe("holdings sorting visual capture", () => {
  test("[visual dashboard]: seeded holdings → desktop and mobile sorting surfaces are captured", async ({
    appShell,
    e2eUserId,
    page,
  }) => {
    await seedVisualHolding(e2eUserId, "6861");
    await appShell.actions.navigateToRoute("/dashboard");
    const holdings = page.getByTestId("dashboard-holdings-section");
    await sortingAssert.isVisible(holdings);
    await capture(page, holdings, "dashboard-desktop", 1_440, 960);
    await capture(page, holdings, "dashboard-mobile", 390, 844);
  });

  test("[visual portfolio]: detailed and compact holdings → desktop and mobile surfaces are captured", async ({
    appShell,
    e2eUserId,
    page,
  }) => {
    await seedVisualHolding(e2eUserId, "6862");
    await appShell.actions.navigateToRoute("/portfolio");
    const holdings = page.getByTestId("portfolio-holdings-section");
    await sortingAssert.isVisible(holdings);
    await page.getByTestId("portfolio-holdings-style-portfolio").click();
    await capture(page, holdings, "portfolio-detailed-desktop", 1_440, 960);
    await page.getByTestId("portfolio-holdings-style-dashboard").click();
    const compactHoldings = page.getByTestId("dashboard-holdings-section");
    await capture(page, compactHoldings, "portfolio-compact-desktop", 1_440, 960);
    await capture(page, compactHoldings, "portfolio-compact-mobile", 390, 844);
  });

  test("[visual reports]: portfolio holdings report → desktop and mobile sorting surfaces are captured", async ({
    appShell,
    e2eUserId,
    page,
  }) => {
    await seedVisualHolding(e2eUserId, "6863");
    await appShell.actions.navigateToRoute("/reports?tab=portfolio&scope=all&range=1Y");
    const holdings = page.getByTestId("reports-holdings-table-reports.portfolio.holdings");
    await sortingAssert.isVisible(holdings);
    await capture(page, holdings, "reports-desktop", 1_440, 960);
    await capture(
      page,
      page.getByTestId("reports-holdings-reports.portfolio.holdings-mobile-sort-field"),
      "reports-mobile",
      390,
      844,
    );
  });

  test("[visual analysis]: unrealized P&L workspace → desktop and mobile terminology is captured", async ({
    appShell,
    e2eUserId,
    page,
  }) => {
    await seedVisualHolding(e2eUserId, "6864");
    await appShell.actions.navigateToRoute("/analysis/unrealized-pnl");
    const heading = page.getByRole("heading", { name: /Unrealized P&L Analysis/i });
    await sortingAssert.isVisible(heading);
    await capture(page, heading, "analysis-desktop", 1_440, 960);
    await capture(page, heading, "analysis-mobile", 390, 844);
  });
});

publicPagesTest.describe("public share holdings visual capture", () => {
  publicPagesTest("[visual public share]: canonical read-only holdings → desktop and mobile surfaces are captured", async ({
    anonymousShare,
    page,
  }) => {
    const owner = await seedUser({
      email: "sorting-visual-owner@example.com",
      name: "Sorting Visual Owner",
      role: "member",
      sub: "sorting-visual-owner-sub",
    });
    await seedTransactionForUser(owner.userId, {
      quantity: 12,
      ticker: "6865",
      tradeDate: "2026-02-04",
      unitPrice: 120,
    });
    await seedQuoteBars([{
      barDate: "2026-05-15",
      close: 150,
      high: 150,
      low: 150,
      open: 150,
      ticker: "6865",
      volume: 1_000,
    }]);
    const token = await seedSingleAnonymousShareToken({ ownerUserId: owner.userId, expiresInDays: 30 });
    await anonymousShare.actions.navigateToPublicShare(token.token);
    const holdings = page.getByTestId("public-share-holdings");
    await sortingAssert.isVisible(holdings);
    await capture(page, holdings, "public-share-desktop", 1_440, 960);
    await capture(page, holdings, "public-share-mobile", 390, 844);
  });
});
