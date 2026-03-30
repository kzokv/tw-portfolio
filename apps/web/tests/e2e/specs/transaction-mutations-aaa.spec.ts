import { test } from "@tw-portfolio/test-e2e/fixtures/appPages";

// The ticker-history route and mutation replay path are still too heavy for
// fullyParallel test fan-out within a single spec file. Keep one mutation
// scenario per file at a time so the old and AAA pair can still run side by side
// on two workers without route cold-start contention.
test.describe("transaction mutations", () => {
  test.beforeEach(async ({ appShell }) => {
    await appShell.actions.setViewport(1440, 960);
  });

  test("edit flow: change quantity → save → toast → table refresh", async ({ ticker }) => {
    await ticker.arrange.seedTrade({ quantity: 100, unitPrice: 500, tradeDate: "2026-01-15" });

    await ticker.actions.navigateToTicker("2330");
    await ticker.assert.rowCountIs(1);

    await ticker.actions.clickEditOnFirstRow();
    await ticker.assert.editableRowIsVisible();
    await ticker.actions.fillEditQuantity("200");
    await ticker.actions.saveEdit();

    await ticker.assert.mutationStatusContains(/updated|Recomputing|recomputed successfully/i, { timeout: 10_000 });
    await ticker.assert.recomputeSettles();
    await ticker.assert.firstRowContains("200");
  });

  test("edit cancel does not persist changes", async ({ ticker }) => {
    await ticker.arrange.seedTrade({ quantity: 100, unitPrice: 500, tradeDate: "2026-01-15" });

    await ticker.actions.navigateToTicker("2330");
    await ticker.actions.clickEditOnFirstRow();
    await ticker.assert.editableRowIsVisible();

    await ticker.actions.fillEditQuantity("999");
    await ticker.actions.cancelEdit();

    await ticker.assert.editableRowIsHidden();
    await ticker.assert.firstRowContains("100");
  });

  test("negative lots warning appears when deleting a BUY consumed by sells", async ({ ticker }) => {
    await ticker.arrange.seedTrade({ quantity: 100, unitPrice: 500, tradeDate: "2026-01-15", type: "BUY" });
    await ticker.arrange.seedTrade({ quantity: 80, unitPrice: 600, tradeDate: "2026-01-20", type: "SELL" });

    await ticker.actions.navigateToTicker("2330");
    await ticker.actions.clickDeleteOnRow("BUY");

    await ticker.assert.deleteDialogIsVisible();
    await ticker.assert.deleteNegativeLotsWarningIsVisible();
    await ticker.assert.deleteTradeSummaryContains(/BUY/);
    await ticker.assert.deleteConfirmButtonIsHidden();

    await ticker.actions.cancelDelete();
    await ticker.assert.deleteDialogIsHidden();
  });

  test("delete flow: dialog → confirm → toast → table refresh", async ({ ticker }) => {
    await ticker.arrange.seedTrade({ unitPrice: 500, tradeDate: "2026-01-10" });
    await ticker.arrange.seedTrade({ unitPrice: 550, tradeDate: "2026-01-15" });
    await ticker.arrange.seedTrade({ unitPrice: 600, tradeDate: "2026-01-20" });

    await ticker.actions.navigateToTicker("2330");
    await ticker.assert.rowCountIs(3);

    await ticker.actions.clickDeleteOnRow("550");
    await ticker.assert.deleteDialogIsVisible();
    await ticker.assert.deleteTradeSummaryContains("550");
    await ticker.assert.deleteImpactCountsAreVisible();
    await ticker.assert.deleteNegativeLotsWarningIsHidden();

    await ticker.actions.confirmDelete();
    await ticker.assert.mutationStatusContains(/deleted|Recomputing|recomputed successfully/i, { timeout: 10_000 });
    await ticker.assert.recomputeSettles();
    await ticker.assert.rowCountIs(2);
    await ticker.assert.rowMatchingTextsCount(["550"], 0);
  });

  test("BUY→SELL side flip via edit (sufficient lots — no warning)", async ({ ticker }) => {
    await ticker.arrange.seedTrade({ quantity: 100, unitPrice: 500, tradeDate: "2026-01-10" });
    await ticker.arrange.seedTrade({ quantity: 50, unitPrice: 520, tradeDate: "2026-01-15" });

    await ticker.actions.navigateToTicker("2330");
    await ticker.assert.rowCountIs(2);

    await ticker.actions.clickEditOnRow("520");
    await ticker.actions.selectEditSide("SELL");
    await ticker.actions.saveEdit();

    await ticker.assert.editConfirmDialogIsHidden();
    await ticker.assert.recomputeSettles();
    await ticker.assert.rowContainingTextContains("520", "SELL");
  });

  test("BUY→SELL side flip shows negative lots warning when insufficient lots", async ({ ticker }) => {
    await ticker.arrange.seedTrade({ quantity: 100, unitPrice: 500, tradeDate: "2026-01-15" });

    await ticker.actions.navigateToTicker("2330");
    await ticker.assert.rowCountIs(1);

    await ticker.actions.clickEditOnFirstRow();
    await ticker.actions.selectEditSide("SELL");
    await ticker.actions.submitEditForPreview();

    await ticker.assert.editConfirmDialogIsVisible();
    await ticker.assert.editNegativeLotsWarningIsVisible();
    await ticker.assert.editNegativeLotsWarningContains(/negative position/i);
    await ticker.assert.editCancelButtonIsVisible();

    await ticker.actions.cancelEditConfirmation();
    await ticker.assert.editConfirmDialogIsHidden();
    await ticker.assert.firstRowContains("BUY");
  });

  test("edit auto-refreshes after recompute without manual reload", async ({ ticker }) => {
    await ticker.arrange.seedTrade({ quantity: 100, unitPrice: 500, tradeDate: "2026-01-15" });

    await ticker.actions.navigateToTicker("2330");
    await ticker.actions.clickEditOnFirstRow();
    await ticker.actions.fillEditPrice("800");
    await ticker.actions.saveEdit();

    await ticker.assert.mutationStatusContains(/Recomputing|recomputed successfully|Portfolio updated/i);
    await ticker.assert.mutationStatusContains(/recomputed successfully|Portfolio updated/i, { timeout: 15_000 });
    await ticker.assert.firstRowContains("800");
  });

  test("delete auto-refreshes after recompute without manual reload", async ({ ticker }) => {
    await ticker.arrange.seedTrade({ unitPrice: 500, tradeDate: "2026-01-10" });
    await ticker.arrange.seedTrade({ unitPrice: 600, tradeDate: "2026-01-15" });

    await ticker.actions.navigateToTicker("2330");
    await ticker.assert.rowCountIs(2);

    await ticker.actions.clickDeleteOnRow("500");
    await ticker.assert.deleteDialogIsVisible();
    await ticker.actions.confirmDelete();

    await ticker.assert.mutationStatusContains(/deleted.*Recomputing|recomputed successfully|Portfolio updated/i);
    await ticker.assert.mutationStatusContains(/recomputed successfully|Portfolio updated/i, { timeout: 15_000 });
    await ticker.assert.rowCountIs(1);
    await ticker.assert.rowMatchingTextsCount(["500"], 0);
  });

  test("weighted-average cost correctness after delete", async ({ ticker }) => {
    await ticker.arrange.seedTrade({ quantity: 100, unitPrice: 500, tradeDate: "2026-01-10" });
    await ticker.arrange.seedTrade({ quantity: 200, unitPrice: 600, tradeDate: "2026-01-15" });

    await ticker.actions.navigateToTicker("2330");
    await ticker.assert.avgCostStatContains(/567/);
    await ticker.actions.clickDeleteOnRow("500");
    await ticker.assert.deleteDialogIsVisible();
    await ticker.actions.confirmDelete();
    await ticker.assert.recomputeSettles();
    await ticker.assert.rowMatchingTextsCount(["500"], 0);
    await ticker.assert.rowCountIs(1);
    await ticker.assert.quantityStatContains("200");
    await ticker.assert.avgCostStatContains(/600|601/);
    await ticker.assert.avgCostStatNotContains(/567/);
  });

  test("delete all trades shows empty state", async ({ ticker }) => {
    await ticker.arrange.seedTrade({ quantity: 100, unitPrice: 500, tradeDate: "2026-01-15" });

    await ticker.actions.navigateToTicker("2330");
    await ticker.assert.rowCountIs(1);
    await ticker.actions.clickDeleteOnRow("500");
    await ticker.assert.deleteDialogIsVisible();

    await ticker.actions.confirmDelete();
    await ticker.assert.recomputeSettles();
    await ticker.assert.emptyStateIsVisible();
  });

  test("record transaction dialog on symbol page: submit with locked symbol/account", async ({ ticker }) => {
    await ticker.arrange.seedTrade({ quantity: 100, unitPrice: 500, tradeDate: "2026-01-15" });

    await ticker.actions.navigateToTicker("2330");
    await ticker.assert.rowCountIs(1);
    await ticker.actions.openRecordDialog();

    await ticker.assert.recordDialogFieldValueIs("ticker", "2330");
    await ticker.assert.recordDialogFieldValueIs("account", "acc-1");
    await ticker.assert.recordDialogFieldValueIs("quantity", "1000");

    await ticker.actions.fillRecordPrice("999");
    await ticker.actions.submitRecord();

    await ticker.assert.recordDialogIsHidden();
    await ticker.assert.rowCountIs(2);
    await ticker.assert.rowMatchingTextsCount(["999"], 1);
  });

  test("navigate to symbol page from portfolio holdings link", async ({ portfolio, ticker }) => {
    await ticker.arrange.seedTrade({ quantity: 100, unitPrice: 500, tradeDate: "2026-01-15" });

    await portfolio.actions.navigateToPortfolio();
    await portfolio.assert.holdingsTableIsVisible();
    await portfolio.assert.holdingLinkIsVisible("2330");
    await portfolio.actions.openHoldingByTicker("2330");

    await ticker.assert.sectionIsVisible();
    await ticker.assert.titleContains("2330");
    await ticker.assert.rowCountIs(1);
  });

  test("form defaults: quantity=1000, tradeDate=today", async ({ ticker }) => {
    await ticker.arrange.seedTrade({ quantity: 100, unitPrice: 500, tradeDate: "2026-01-15" });

    await ticker.actions.navigateToTicker("2330");
    await ticker.actions.openRecordDialog();

    await ticker.assert.recordDialogFieldValueIs("quantity", "1000");
    await ticker.assert.recordDialogFieldValueIs("tradeDate", new Date().toISOString().slice(0, 10));
    await ticker.assert.recordDialogFieldHasAttribute("price", "min", "0.01");
    await ticker.assert.recordDialogFieldHasAttribute("quantity", "min", "1");
  });

  test("edit price change persists after recompute", async ({ ticker }) => {
    await ticker.arrange.seedTrade({ quantity: 100, unitPrice: 500, tradeDate: "2026-01-15" });

    await ticker.actions.navigateToTicker("2330");
    await ticker.actions.clickEditOnFirstRow();
    await ticker.assert.editPriceInputIsVisible();
    await ticker.actions.fillEditPrice("750");

    await ticker.actions.saveEdit();
    await ticker.assert.recomputeSettles();

    await ticker.assert.firstRowContains("750");
  });

  test("decimal unit price: seed and display with 2dp", async ({ ticker }) => {
    await ticker.arrange.seedTrade({ quantity: 3, unitPrice: 152.35, tradeDate: "2026-01-15" });

    await ticker.actions.navigateToTicker("2330");
    await ticker.assert.rowCountIs(1);
    await ticker.assert.firstRowContains("152.35");
  });

  test("edit to decimal price persists after recompute", async ({ ticker }) => {
    await ticker.arrange.seedTrade({ quantity: 100, unitPrice: 500, tradeDate: "2026-01-15" });

    await ticker.actions.navigateToTicker("2330");
    await ticker.actions.clickEditOnFirstRow();
    await ticker.assert.editPriceInputIsVisible();
    await ticker.actions.fillEditPrice("750.25");

    await ticker.actions.saveEdit();
    await ticker.assert.recomputeSettles();

    await ticker.assert.firstRowContains("750.25");
  });

  test("record transaction dialog accepts decimal price", async ({ ticker }) => {
    await ticker.arrange.seedTrade({ quantity: 100, unitPrice: 500, tradeDate: "2026-01-15" });

    await ticker.actions.navigateToTicker("2330");
    await ticker.actions.openRecordDialog();
    await ticker.actions.fillRecordPrice("185.50");

    await ticker.assert.recordDialogFieldHasAttribute("price", "step", "0.01");
  });
});
