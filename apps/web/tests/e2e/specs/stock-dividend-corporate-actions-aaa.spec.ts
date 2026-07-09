import { test } from "@vakwen/test-e2e/fixtures/appPages";

test("[stock-dividend]: post-sell correction → adjusted review row renders on desktop and mobile", async ({
  dashboard,
  dividends,
  dividendReview,
  settings,
  page,
}) => {
  const stockTicker = "8898";
  await settings.arrange.seedInstruments([
    {
      ticker: stockTicker,
      name: "Synthetic Stock Dividend Co",
      instrumentType: "STOCK",
      marketCode: "TW",
      barsBackfillStatus: "ready",
    },
  ]);

  await dashboard.arrange.seedTrade({
    ticker: stockTicker,
    marketCode: "TW",
    quantity: 100,
    unitPrice: 100,
    tradeDate: "2026-01-05",
  });

  const posted = await dividends.arrange.seedPostedDividend({
    ticker: stockTicker,
    eventType: "STOCK",
    exDividendDate: "2026-02-01",
    paymentDate: "2026-02-20",
    cashDividendPerShare: 0,
    stockDividendPerShare: 0.1,
    eligibleQuantity: 100,
    receivedCashAmount: 0,
    receivedStockQuantity: 10,
    deductions: [],
    sourceCompositionStatus: "unknown_pending_disclosure",
    sourceLines: [],
  });

  await dashboard.arrange.seedTrade({
    ticker: stockTicker,
    marketCode: "TW",
    quantity: 2,
    unitPrice: 120,
    tradeDate: "2026-03-01",
    type: "SELL",
  });

  const correctionResponse = await dividends.actions.updatePostedDividendViaApi({
    accountId: "acc-1",
    dividendEventId: posted.dividendEventId,
    dividendLedgerEntryId: posted.dividendLedgerEntryId,
    expectedVersion: posted.version,
    receivedCashAmount: 0,
    receivedStockQuantity: 12,
    deductions: [],
    sourceCompositionStatus: "unknown_pending_disclosure",
    sourceLines: [],
  });
  const correctionBody = await correctionResponse.text();
  if (!correctionResponse.ok()) {
    throw new Error(`stock dividend correction failed: ${correctionResponse.status()} ${correctionBody}`);
  }

  const correction = JSON.parse(correctionBody) as {
    dividendLedgerEntry?: {
      id?: string;
      postingStatus?: string;
      receivedStockQuantity?: number;
    };
  };
  const adjustedLedgerEntryId = correction.dividendLedgerEntry?.id;
  if (!adjustedLedgerEntryId) {
    throw new Error("stock dividend correction response did not include dividendLedgerEntry.id");
  }
  if (correction.dividendLedgerEntry?.postingStatus !== "adjusted") {
    throw new Error(`expected adjusted posting status, received ${correction.dividendLedgerEntry?.postingStatus ?? "missing"}`);
  }
  if (correction.dividendLedgerEntry?.receivedStockQuantity !== 12) {
    throw new Error(`expected receivedStockQuantity 12, received ${correction.dividendLedgerEntry?.receivedStockQuantity ?? "missing"}`);
  }

  await dividendReview.actions.navigateToReviewWithParams("status=needs-review");
  await dividendReview.assert.pageLoaded();
  await dividendReview.assert.rowContainsText(String(adjustedLedgerEntryId), stockTicker);
  await dividendReview.assert.rowContainsText(String(adjustedLedgerEntryId), "12");
  await dividendReview.assert.rowStatusContains(String(adjustedLedgerEntryId), /Open|未完成/i);
  await dashboard.assert.mxAssertTruthy(await viewportFits(page), "desktop dividend review viewport fit");

  await page.setViewportSize({ width: 390, height: 1000 });
  await dividendReview.actions.navigateToReviewWithParams("status=needs-review");
  await dividendReview.assert.pageLoaded();
  await dividendReview.assert.rowContainsText(String(adjustedLedgerEntryId), /Stock rec\.\s*12|配股.*12|12/);
  await dashboard.assert.mxAssertTruthy(await viewportFits(page), "mobile dividend review viewport fit");
});

test("[stock-dividend-drawer]: pre-sell amendment → stock quantity saves through drawer and refreshes row", async ({
  dashboard,
  dividends,
  dividendReview,
  page,
  settings,
}) => {
  const stockTicker = "8899";
  await settings.arrange.seedInstruments([
    {
      ticker: stockTicker,
      name: "Drawer Stock Dividend Co",
      instrumentType: "STOCK",
      marketCode: "TW",
      barsBackfillStatus: "ready",
    },
  ]);

  await dashboard.arrange.seedTrade({
    ticker: stockTicker,
    marketCode: "TW",
    quantity: 100,
    unitPrice: 100,
    tradeDate: "2026-01-05",
  });

  const posted = await dividends.arrange.seedPostedDividend({
    ticker: stockTicker,
    eventType: "STOCK",
    exDividendDate: "2026-02-01",
    paymentDate: "2026-02-20",
    cashDividendPerShare: 0,
    stockDividendPerShare: 0.1,
    eligibleQuantity: 100,
    receivedCashAmount: 0,
    receivedStockQuantity: 10,
    deductions: [],
    sourceCompositionStatus: "unknown_pending_disclosure",
    sourceLines: [],
  });

  await dividendReview.actions.navigateToReviewWithParams("status=needs-review");
  await dividendReview.assert.pageLoaded();
  await dividendReview.assert.rowContainsText(posted.dividendLedgerEntryId, "10");

  await page.getByTestId(`review-row-${posted.dividendLedgerEntryId}`).click();
  await page.getByTestId("ui-drawer").waitFor({ state: "visible" });
  await dashboard.assert.mxAssertTruthy(await page.getByTestId("dividend-received-stock").isEnabled(), "stock quantity input enabled");
  await page.getByTestId("dividend-received-stock").fill("15");

  const postingResponse = page.waitForResponse((response) =>
    response.request().method() === "POST"
    && response.url().includes("/portfolio/dividends/postings"));
  await page.getByTestId("dividend-save").click();
  await dashboard.assert.mxAssertTruthy((await postingResponse).ok(), "stock dividend amendment response ok");

  await page.getByTestId("ui-drawer").waitFor({ state: "hidden" });
  await dividendReview.assert.rowContainsText(posted.dividendLedgerEntryId, "15");
  await dashboard.assert.mxAssertTruthy(await viewportFits(page), "desktop dividend review drawer amendment viewport fit");
});

test("[holding-actions]: reverse split preview blocks fractions until cash-in-lieu then posts without reload", async ({
  dashboard,
  page,
  portfolio,
  settings,
}) => {
  const stockTicker = "8897";
  await settings.arrange.seedInstruments([
    {
      ticker: stockTicker,
      name: "Reverse Split Preview Co",
      instrumentType: "STOCK",
      marketCode: "TW",
      barsBackfillStatus: "ready",
    },
  ]);

  await dashboard.arrange.seedTrade({
    ticker: stockTicker,
    marketCode: "TW",
    quantity: 101,
    unitPrice: 50,
    tradeDate: "2026-01-05",
  });

  await portfolio.actions.navigateToPortfolio();
  await portfolio.assert.holdingsTableIsVisible();
  await portfolio.assert.holdingGroupRowIsVisible(stockTicker, "TW");
  await portfolio.actions.openHoldingGroup(stockTicker, "TW");

  const panel = page.getByTestId("holding-split-action-panel");
  await panel.waitFor({ state: "visible" });
  await panel.getByRole("tab", { name: /Reverse split|反向分割/i }).click();
  await page.getByTestId("holding-split-date").fill("2026-02-01");
  await page.getByTestId("holding-split-old-shares").fill("2");
  await page.getByTestId("holding-split-new-shares").fill("1");

  await page.getByTestId("holding-split-blocked-preview").waitFor({ state: "visible" });
  await portfolio.assert.mxAssertEqual(await page.getByTestId("holding-split-submit").isDisabled(), true, "split submit disabled before cash-in-lieu");

  await page.getByTestId("holding-split-cash-in-lieu").fill("25");
  await page.getByTestId("holding-split-impact-preview").waitFor({ state: "visible" });
  await portfolio.assert.mxAssertEqual(await page.getByTestId("holding-split-submit").isEnabled(), true, "split submit enabled after cash-in-lieu");

  const corporateActionResponse = page.waitForResponse((response) =>
    response.request().method() === "POST"
    && response.url().includes("/corporate-actions"));
  await page.getByTestId("holding-split-submit").click();
  await portfolio.assert.mxAssertTruthy((await corporateActionResponse).ok(), "corporate action response ok");
  await page.getByTestId("holding-split-submit-success").waitFor({ state: "visible" });

  await portfolio.assert.mxAssertTruthy(await viewportFits(page), "desktop holding reverse-split action viewport fit");

  await page.setViewportSize({ width: 390, height: 1000 });
  await panel.waitFor({ state: "visible" });
  await portfolio.assert.mxAssertTruthy(await viewportFits(page), "mobile holding reverse-split action viewport fit");
});

async function viewportFits(page: { evaluate: <T>(fn: () => T) => Promise<T> }): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
}
