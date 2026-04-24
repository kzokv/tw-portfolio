import { test } from "@tw-portfolio/test-e2e/fixtures/appPages";

// Synthetic tickers per .claude/rules/e2e-shared-memory-bars-ticker-hygiene.md.

test("[transactions form]: buy estimate → commission renders and tax stays hidden", async ({
  appShell,
  dashboard,
  settings,
  transactions,
  page,
}) => {
  await settings.arrange.seedInstruments([
    { ticker: "8304", name: "Synthetic ETF 8304", instrumentType: "ETF", marketCode: "TW", barsBackfillStatus: "pending" },
  ]);
  await dashboard.arrange.seedDailyBars([
    { ticker: "8304", barDate: "2026-01-15", open: 41, high: 43, low: 40, close: 42.5, volume: 200_000 },
  ]);

  await appShell.actions.navigateToRoute("/transactions");
  await transactions.actions.selectFirstAccount();
  await transactions.actions.typeInTickerSearch("8304");
  await transactions.actions.selectTickerOption("8304");
  const priceLookup = transactions.actions.waitForPriceLookup();
  const feeEstimate = transactions.actions.waitForFeeEstimate();
  await transactions.actions.fillTradeDate("2026-01-15");

  await priceLookup;
  await feeEstimate;
  await transactions.assert.commissionEstimateContains(/Estimated|預估/);
  await transactions.assert.taxEstimateIsHidden();

  const submitRequest = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      request.url().includes("/portfolio/transactions") &&
      !request.url().includes("/estimate"),
  );
  await page.getByTestId("commission-override-input").fill("321");
  await transactions.actions.submitTransaction();
  const request = await submitRequest;
  const payload = request.postDataJSON() as { commissionAmount?: number; taxAmount?: number };
  await transactions.assert.mxAssertEqual(payload.commissionAmount, 321, "commission override amount");
  await transactions.assert.mxAssertEqual(payload.taxAmount, undefined, "tax override amount");
});

test("[transactions form]: sell estimate → commission and tax render and overrides submit verbatim", async ({
  appShell,
  dashboard,
  settings,
  transactions,
  page,
}) => {
  await settings.arrange.seedInstruments([
    { ticker: "8305", name: "Synthetic Stock 8305", instrumentType: "STOCK", marketCode: "TW", barsBackfillStatus: "pending" },
  ]);
  await dashboard.arrange.seedDailyBars([
    { ticker: "8305", barDate: "2026-01-15", open: 998, high: 1008, low: 995, close: 1005, volume: 100_000 },
  ]);
  await dashboard.arrange.seedTrade({ ticker: "8305", quantity: 1000, unitPrice: 900 });

  await appShell.actions.navigateToRoute("/transactions");
  await transactions.actions.selectFirstAccount();
  await transactions.actions.selectTransactionType("SELL");
  await transactions.actions.typeInTickerSearch("8305");
  await transactions.actions.selectTickerOption("8305");
  const priceLookup = transactions.actions.waitForPriceLookup();
  const feeEstimate = transactions.actions.waitForFeeEstimate();
  await transactions.actions.fillTradeDate("2026-01-15");

  await priceLookup;
  await feeEstimate;
  await transactions.assert.commissionEstimateContains(/Estimated|預估/);
  await transactions.assert.taxEstimateContains(/Estimated|預估/);

  const submitRequest = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      request.url().includes("/portfolio/transactions") &&
      !request.url().includes("/estimate"),
  );
  await page.getByTestId("commission-override-input").fill("123");
  await page.getByTestId("tax-override-input").fill("456");
  await transactions.actions.submitTransaction();
  const request = await submitRequest;
  const payload = request.postDataJSON() as { commissionAmount?: number; taxAmount?: number };
  await transactions.assert.mxAssertEqual(payload.commissionAmount, 123, "commission override amount");
  await transactions.assert.mxAssertEqual(payload.taxAmount, 456, "tax override amount");
});
