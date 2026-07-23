import { test } from "@vakwen/test-e2e/fixtures/appPages";

const TEST_TICKER = "7788";
const TEST_TICKER_NAME = "Mobile Dividend Systems";
const TEST_MARKET = "TW";
const TEST_MONTH = "2026-07";

async function seedMobileDividendScope({
  ticker,
  dividends,
}: {
  ticker: import("@vakwen/test-e2e/fixtures/appPages").TAppPagesFixtures["ticker"];
  dividends: import("@vakwen/test-e2e/fixtures/appPages").TAppPagesFixtures["dividends"];
}) {
  await ticker.arrange.seedInstruments([
    {
      ticker: TEST_TICKER,
      name: TEST_TICKER_NAME,
      instrumentType: "STOCK",
      marketCode: TEST_MARKET,
      barsBackfillStatus: "ready",
    },
  ]);

  return await dividends.arrange.seedPostedDividendWithReconciliation({
    ticker: TEST_TICKER,
    eventType: "CASH",
    exDividendDate: "2026-07-09",
    paymentDate: "2026-07-25",
    cashDividendPerShare: 0.16,
    receivedCashAmount: 152,
    sourceCompositionStatus: "unknown_pending_disclosure",
    deductions: [],
    sourceLines: [],
    reconciliationStatus: "open",
  });
}

test("[mobile-dividends-ui-ux-A]: Overview stacks action queue before monthly events and ticker Dividends tab remains reachable", async ({
  appShell,
  dividends,
  ticker,
}) => {
  await seedMobileDividendScope({ ticker, dividends });

  await appShell.actions.navigateToRouteForResponsiveTest(`/dividends?month=${TEST_MONTH}`);
  await dividends.assert.calendarLoaded();
  await dividends.assert.monthInputHasValue(TEST_MONTH);
  await dividends.assert.actionQueueContains(TEST_TICKER_NAME);
  await dividends.assert.thisMonthContains(TEST_TICKER_NAME);
  await dividends.assert.actionQueueAppearsBeforeThisMonth();

  await appShell.actions.navigateToRouteForResponsiveTest(`/tickers/${TEST_TICKER}?marketCode=${TEST_MARKET}`);
  await ticker.assert.sectionIsVisible();
  await ticker.actions.openDividendsTabFromMobileSelect();
  await ticker.assert.dividendsPanelIsVisible();
  await ticker.assert.dividendsPanelContains(TEST_TICKER_NAME);
});

test("dividends review mobile: consolidated cash/stock cards → retired sort fields remain absent", async ({
  appShell,
  dividendReview,
  dividends,
  page,
  ticker,
}) => {
  await ticker.arrange.seedInstruments([
    { ticker: "7790", name: "Mobile Mixed Dividend", instrumentType: "STOCK", marketCode: "TW", barsBackfillStatus: "ready" },
  ]);
  const seeded = await dividends.arrange.seedPostedDividend({
    ticker: "7790",
    eventType: "CASH_AND_STOCK",
    exDividendDate: "2026-07-09",
    paymentDate: "2026-07-25",
    cashDividendPerShare: 1.6,
    stockDividendPerShare: 0.1,
    receivedCashAmount: 152,
    receivedStockQuantity: 8,
    sourceCompositionStatus: "unknown_pending_disclosure",
    deductions: [],
    sourceLines: [],
  });

  await appShell.actions.navigateToRouteForResponsiveTest("/dividends?view=ledger");
  await dividendReview.assert.pageLoaded();
  const row = page.getByTestId(`review-row-${seeded.dividendLedgerEntryId}`);
  await dividendReview.assert.locatorContains(row, /Cash \+ Stock/);
  await dividendReview.assert.locatorContains(row, /per share|Expected|Received|Variance/);
  await dividendReview.assert.mobileSortExcludes(["exDate", "recordDate", "dividendType"]);
  await dividendReview.assert.viewportHasNoHorizontalOverflow();
});
