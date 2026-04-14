import { test } from "@tw-portfolio/test-e2e/fixtures/appPages";

// NOTE: seedDailyBars appends to a global (non-per-user) array in MemoryPersistence.
// Tests that seed bars for the same ticker accumulate entries across tests.
// TC5 uses "0050" (not "2330") to avoid cross-contamination with TC1-TC4.

test.describe("portfolio snapshots", () => {
  test.beforeEach(async ({ appShell }) => {
    await appShell.actions.setViewport(1440, 960);
  });

  test("generate flow: click button → loading → SSE → charts populate", async ({
    dashboard,
  }) => {
    await dashboard.arrange.seedTrade({ ticker: "2330", quantity: 100, unitPrice: 500, tradeDate: "2026-01-15" });
    await dashboard.arrange.seedDailyBars([
      { ticker: "2330", barDate: "2026-01-15", open: 495, high: 505, low: 490, close: 500, volume: 1000 },
      { ticker: "2330", barDate: "2026-01-16", open: 500, high: 515, low: 498, close: 510, volume: 1100 },
      { ticker: "2330", barDate: "2026-01-17", open: 510, high: 525, low: 508, close: 520, volume: 1200 },
    ]);

    await dashboard.actions.navigateToDashboard();
    await dashboard.assert.appIsReady();
    await dashboard.assert.generateSnapshotsButtonIsVisible();

    // Generate snapshots and wait for 202
    await dashboard.actions.generateSnapshotsAndWait();

    // SSE snapshots_generated fires fast — accept both intermediate and final states
    await dashboard.assert.snapshotStatusContains(
      /generating|generated|snapshots generated/i,
      { timeout: 10_000 },
    );

    // Charts populate with data
    await dashboard.assert.performanceCardIsVisible();
    await dashboard.assert.performanceChartHasData();
    await dashboard.assert.returnPercentCardIsVisible();
    await dashboard.assert.returnPercentChartHasData();

    // Return % card shows a percentage value
    await dashboard.assert.returnPercentCardContains(/%/);
  });

  test("mutation-triggered update: edit trade → recompute → chart refreshes", async ({
    dashboard,
    ticker,
  }) => {
    await dashboard.arrange.seedTrade({ ticker: "2330", quantity: 100, unitPrice: 500, tradeDate: "2026-01-15" });
    await dashboard.arrange.seedDailyBars([
      { ticker: "2330", barDate: "2026-01-15", open: 495, high: 505, low: 490, close: 500, volume: 1000 },
      { ticker: "2330", barDate: "2026-01-16", open: 500, high: 515, low: 498, close: 510, volume: 1100 },
      { ticker: "2330", barDate: "2026-01-17", open: 510, high: 525, low: 508, close: 520, volume: 1200 },
    ]);

    // Generate snapshots to establish baseline
    await dashboard.actions.navigateToDashboard();
    await dashboard.assert.appIsReady();
    await dashboard.actions.generateSnapshotsAndWait();
    await dashboard.assert.performanceChartHasData();

    // Edit trade: change quantity
    await ticker.actions.navigateToTicker("2330");
    await ticker.actions.clickEditOnFirstRow();
    await ticker.actions.fillEditQuantity("200");
    await ticker.actions.saveEdit();

    // Recompute settles (includes snapshot recompute per scheduleReplayWithRetry)
    await ticker.assert.mutationStatusContains(
      /Recomputing|recomputed successfully|Portfolio updated/i,
      { timeout: 10_000 },
    );
    await ticker.assert.recomputeSettles();

    // Navigate back to dashboard — chart still has data after mutation
    await dashboard.actions.navigateToDashboard();
    await dashboard.assert.appIsReady();
    await dashboard.assert.performanceCardIsVisible();
    await dashboard.assert.performanceChartHasData();
    await dashboard.assert.returnPercentCardIsVisible();
    await dashboard.assert.returnPercentChartHasData();
  });

  test("delete preview: snapshot impact count shown in dialog", async ({
    dashboard,
    ticker,
  }) => {
    await dashboard.arrange.seedTrade({ ticker: "2330", quantity: 100, unitPrice: 500, tradeDate: "2026-01-10" });
    await dashboard.arrange.seedTrade({ ticker: "2330", quantity: 50, unitPrice: 550, tradeDate: "2026-01-15" });
    await dashboard.arrange.seedDailyBars([
      { ticker: "2330", barDate: "2026-01-10", open: 495, high: 505, low: 490, close: 500, volume: 1000 },
      { ticker: "2330", barDate: "2026-01-13", open: 500, high: 510, low: 498, close: 505, volume: 1100 },
      { ticker: "2330", barDate: "2026-01-14", open: 505, high: 515, low: 503, close: 510, volume: 1200 },
      { ticker: "2330", barDate: "2026-01-15", open: 510, high: 520, low: 508, close: 515, volume: 1300 },
      { ticker: "2330", barDate: "2026-01-16", open: 515, high: 525, low: 513, close: 520, volume: 1400 },
      { ticker: "2330", barDate: "2026-01-17", open: 520, high: 530, low: 518, close: 525, volume: 1500 },
    ]);

    // Generate snapshots first
    await dashboard.actions.navigateToDashboard();
    await dashboard.assert.appIsReady();
    await dashboard.actions.generateSnapshotsAndWait();

    // Open delete dialog on the second trade
    await ticker.actions.navigateToTicker("2330");
    await ticker.actions.clickDeleteOnRow("550");

    await ticker.assert.deleteDialogIsVisible();
    await ticker.assert.deleteImpactCountsAreVisible();
    await ticker.assert.deleteSnapshotImpactIsVisible();

    await ticker.actions.cancelDelete();
    await ticker.assert.deleteDialogIsHidden();
  });

  test("delete confirm: trade removed → chart still renders", async ({
    dashboard,
    ticker,
  }) => {
    await dashboard.arrange.seedTrade({ ticker: "2330", quantity: 100, unitPrice: 500, tradeDate: "2026-01-10" });
    await dashboard.arrange.seedTrade({ ticker: "2330", quantity: 50, unitPrice: 550, tradeDate: "2026-01-15" });
    await dashboard.arrange.seedDailyBars([
      { ticker: "2330", barDate: "2026-01-10", open: 495, high: 505, low: 490, close: 500, volume: 1000 },
      { ticker: "2330", barDate: "2026-01-13", open: 500, high: 510, low: 498, close: 505, volume: 1100 },
      { ticker: "2330", barDate: "2026-01-14", open: 505, high: 515, low: 503, close: 510, volume: 1200 },
      { ticker: "2330", barDate: "2026-01-15", open: 510, high: 520, low: 508, close: 515, volume: 1300 },
      { ticker: "2330", barDate: "2026-01-16", open: 515, high: 525, low: 513, close: 520, volume: 1400 },
      { ticker: "2330", barDate: "2026-01-17", open: 520, high: 530, low: 518, close: 525, volume: 1500 },
    ]);

    // Generate snapshots
    await dashboard.actions.navigateToDashboard();
    await dashboard.assert.appIsReady();
    await dashboard.actions.generateSnapshotsAndWait();

    // Delete the second trade
    await ticker.actions.navigateToTicker("2330");
    await ticker.assert.rowCountIs(2);
    await ticker.actions.clickDeleteOnRow("550");
    await ticker.assert.deleteDialogIsVisible();
    await ticker.actions.confirmDelete();

    await ticker.assert.mutationStatusContains(
      /deleted|Recomputing|recomputed successfully|Portfolio updated/i,
      { timeout: 10_000 },
    );
    await ticker.assert.recomputeSettles();
    await ticker.assert.rowCountIs(1);

    // Navigate back — chart still has data (one remaining trade)
    await dashboard.actions.navigateToDashboard();
    await dashboard.assert.appIsReady();
    await dashboard.assert.performanceCardIsVisible();
    await dashboard.assert.performanceChartHasData();
  });

  test("provisional data: missing bars → amber warning visible", async ({
    dashboard,
  }) => {
    // Use "9999" — outside DEFAULT_INSTRUMENTS and unused by any other spec so
    // global daily_bars never contain bars for this ticker. Ticker "0050" was
    // unsafe here because dashboard-daily-change-aaa.spec seeds "0050" bars on
    // 2026-03-20/21 which fall inside the snapshot walker's range (firstTrade→today),
    // making tradingDays.length > 0 and causing the provisional branch to be skipped.
    // "9999" is registered as a provisional STOCK via ensureInstrumentDefinition
    // when the trade is booked (type=STOCK from DEFAULT_PROVISIONAL_TYPE → trade accepted).
    await dashboard.arrange.seedTrade({ ticker: "9999", quantity: 100, unitPrice: 100, tradeDate: "2026-01-15" });
    // NO daily bars seeded and none exist from other specs — all snapshots provisional (market_value=NULL).

    await dashboard.actions.navigateToDashboard();
    await dashboard.assert.appIsReady();
    await dashboard.actions.generateSnapshotsAndWait();

    // Verify snapshot generation actually produced provisional rows. Message format is
    // "{totalRows} snapshots generated ({provisionalRows} provisional)" — assert the
    // parenthesized count is non-zero. This is the gate that separates "warning will
    // render" from the silent-failure case (hasProvisional=false when provisionalRows=0).
    await dashboard.assert.snapshotStatusContains(
      /\([1-9]\d* provisional\)/,
      { timeout: 10_000 },
    );

    // Performance card renders (stroke-only paths in no-quote state — no bbox check)
    await dashboard.assert.performanceCardIsVisible();

    // Return percent card shows provisional warning (no totalReturnPercent in synthetic data)
    await dashboard.assert.returnPercentCardIsVisible();
    await dashboard.assert.returnPercentProvisionalWarningIsVisible();
  });

  test("two chart cards: amounts and return % render with data", async ({
    dashboard,
  }) => {
    await dashboard.arrange.seedTrade({ ticker: "2330", quantity: 100, unitPrice: 500, tradeDate: "2026-01-15" });
    await dashboard.arrange.seedDailyBars([
      { ticker: "2330", barDate: "2026-01-15", open: 495, high: 505, low: 490, close: 500, volume: 1000 },
      { ticker: "2330", barDate: "2026-01-16", open: 500, high: 515, low: 498, close: 510, volume: 1100 },
      { ticker: "2330", barDate: "2026-01-17", open: 510, high: 525, low: 508, close: 520, volume: 1200 },
    ]);

    await dashboard.actions.navigateToDashboard();
    await dashboard.assert.appIsReady();
    await dashboard.actions.generateSnapshotsAndWait();

    // Amounts chart card: visible with data (3 series: cost basis, market value, total return)
    await dashboard.assert.performanceCardIsVisible();
    await dashboard.assert.performanceChartHasData();

    // Return % chart card: visible with data and percentage in legend
    await dashboard.assert.returnPercentCardIsVisible();
    await dashboard.assert.returnPercentChartHasData();
    await dashboard.assert.returnPercentCardContains(/%/);

    // No provisional warnings when all bars are present
    await dashboard.assert.performancePartialWarningIsHidden();
    await dashboard.assert.returnPercentProvisionalWarningIsHidden();
  });
});
