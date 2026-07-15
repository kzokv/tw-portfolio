import { test } from "@vakwen/test-e2e/fixtures/appPages";

const viewports = [
  { label: "desktop", width: 1280, height: 800 },
  { label: "mobile", width: 390, height: 844 },
] as const;

function dateThisMonth(day: number): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), day))
    .toISOString()
    .slice(0, 10);
}

for (const viewport of viewports) {
  test(`[dividend expected guidance ${viewport.label}]: open expected row → removal guidance links to the scoped Transactions tab`, async ({
    dividendReview,
    page,
    ticker,
  }) => {
    await page.setViewportSize(viewport);
    const seeded = await dividendReview.arrange.seedExpectedDividend({
      accountId: "acc-1",
      ticker: "2330",
      exDividendDate: dateThisMonth(8),
      paymentDate: dateThisMonth(22),
      tradeDate: dateThisMonth(1),
      eligibleQuantity: 1_000,
    });

    await dividendReview.actions.navigateToReview();
    await dividendReview.assert.pageLoaded();
    const navigationCount = await page.evaluate(() => performance.getEntriesByType("navigation").length);
    await dividendReview.actions.clickRow(seeded.expectedReviewRowId);

    await dividendReview.assert.removalGuidanceContains(/underlying transaction|來源交易|交易紀錄/);
    await dividendReview.assert.removalGuidanceHasNoDeleteAction();
    await dividendReview.assert.openTickerTransactionsHrefContains([
      "/tickers/2330",
      "marketCode=TW",
      "accountId=acc-1",
      "tab=transactions",
    ]);
    await dividendReview.assert.viewportHasNoHorizontalOverflow();

    await dividendReview.actions.openTickerTransactions();
    await dividendReview.assert.urlMatches(/\/tickers\/2330\?.*marketCode=TW/);
    await dividendReview.assert.urlMatches(/accountId=acc-1/);
    await dividendReview.assert.urlMatches(/tab=transactions/);
    await ticker.assert.sectionIsVisible();
    await ticker.assert.transactionsTabIsActive();
    await dividendReview.assert.navigationCountIs(navigationCount);
    await ticker.assert.viewportHasNoHorizontalOverflow();
  });

  test(`[dividend posted guidance ${viewport.label}]: open posted row → correction guidance renders without direct dividend deletion`, async ({
    dividendReview,
    page,
  }) => {
    await page.setViewportSize(viewport);
    const seeded = await dividendReview.arrange.seedPostedDividend({
      accountId: "acc-1",
      ticker: "2330",
      exDividendDate: dateThisMonth(9),
      paymentDate: dateThisMonth(23),
      tradeDate: dateThisMonth(2),
      receivedCashAmount: 108,
    });

    await dividendReview.actions.navigateToReview();
    await dividendReview.assert.pageLoaded();
    await dividendReview.actions.clickRow(seeded.dividendLedgerEntryId);

    await dividendReview.assert.removalGuidanceContains(/amendment|reversal|更正|沖銷/);
    await dividendReview.assert.removalGuidanceHasNoDeleteAction();
    await dividendReview.assert.openTickerTransactionsHrefContains([
      "/tickers/2330",
      "marketCode=TW",
      "accountId=acc-1",
      "tab=transactions",
    ]);
    await dividendReview.assert.viewportHasNoHorizontalOverflow();
  });
}
