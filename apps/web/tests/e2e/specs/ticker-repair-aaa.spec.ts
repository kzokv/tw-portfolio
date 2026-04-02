import { test } from "@tw-portfolio/test-e2e/fixtures/appPages";

test.describe("ticker detail repair", () => {
  test("header repair: open modal → submit bars-only request surfaces repair feedback", async ({ ticker }) => {
    // ARRANGE
    await ticker.arrange.seedInstruments([
      {
        ticker: "2330",
        name: "TSMC",
        instrumentType: "STOCK",
        marketCode: "TW",
        barsBackfillStatus: "ready",
      },
    ]);
    await ticker.arrange.setManualMonitoredTickers(["2330"]);
    await ticker.arrange.seedTrade({ ticker: "2330", quantity: 100, unitPrice: 500, tradeDate: "2026-01-15" });
    await ticker.actions.navigateToTicker("2330");

    // ACT
    await ticker.assert.repairButtonIsVisible();
    await ticker.actions.openRepairDialog();
    await ticker.actions.setRepairDateRange("2026-03-01", "2026-03-31");
    await ticker.actions.setRepairIncludeBars(true);
    await ticker.actions.setRepairIncludeDividends(false);
    await ticker.actions.submitRepair();

    // ASSERT
    await ticker.assert.repairErrorToastContains(/queue|available|repair|修復/i);
    await ticker.assert.repairDialogIsVisible();
  });

  test("repair SSE: receives repair_complete event and updates feedback state", async ({ ticker }) => {
    // ARRANGE
    await ticker.arrange.seedInstruments([
      {
        ticker: "2330",
        name: "TSMC",
        instrumentType: "STOCK",
        marketCode: "TW",
        barsBackfillStatus: "ready",
      },
    ]);
    await ticker.arrange.setManualMonitoredTickers(["2330"]);
    await ticker.arrange.seedTrade({ ticker: "2330", quantity: 100, unitPrice: 500, tradeDate: "2026-01-15" });
    await ticker.actions.navigateToTicker("2330");

    // ACT
    await ticker.arrange.publishRepairEvent("repair_started", { ticker: "2330" });
    await ticker.arrange.publishRepairEvent("repair_complete", {
      ticker: "2330",
      barsCount: 12,
      dividendsCount: 1,
    });

    // ASSERT
    await ticker.assert.repairStatusBadgeContains(/last repaired|ready|修復完成|已完成/i);
    await ticker.assert.repairSuccessToastContains(/repair|repaired|修復/i);
  });
});
