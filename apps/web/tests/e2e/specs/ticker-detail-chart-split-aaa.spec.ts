import { test } from "@vakwen/test-e2e/fixtures/appPages";

// seedDailyBars writes into a shared in-memory collection, so this regression
// uses a unique synthetic TW ticker to avoid inheriting bars from other specs.
const SYNTHETIC_TW_TICKER = "8897";

function isoDateDaysAgo(daysAgo: number): string {
  const date = new Date();
  date.setUTCHours(12, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date.toISOString().slice(0, 10);
}

test.describe("ticker detail chart split", () => {
  test.beforeEach(async ({ appShell }) => {
    await appShell.actions.setViewport(1440, 960);
  });

  test("[ticker-chart-split-A]: snapshot-backed ticker detail → Current Price and Unrealized P&L render Recharts lines on desktop and mobile", async ({
    appShell,
    dashboard,
    ticker,
  }) => {
    await dashboard.arrange.seedTrade({
      ticker: SYNTHETIC_TW_TICKER,
      marketCode: "TW",
      quantity: 100,
      unitPrice: 120,
      tradeDate: isoDateDaysAgo(18),
    });
    await dashboard.arrange.seedTrade({
      ticker: SYNTHETIC_TW_TICKER,
      marketCode: "TW",
      quantity: 50,
      unitPrice: 132,
      tradeDate: isoDateDaysAgo(9),
    });
    await dashboard.arrange.seedDailyBars([
      { ticker: SYNTHETIC_TW_TICKER, marketCode: "TW", barDate: isoDateDaysAgo(18), open: 118, high: 121, low: 117, close: 120, volume: 1000 },
      { ticker: SYNTHETIC_TW_TICKER, marketCode: "TW", barDate: isoDateDaysAgo(12), open: 122, high: 126, low: 121, close: 125, volume: 1200 },
      { ticker: SYNTHETIC_TW_TICKER, marketCode: "TW", barDate: isoDateDaysAgo(9), open: 130, high: 133, low: 129, close: 132, volume: 1300 },
      { ticker: SYNTHETIC_TW_TICKER, marketCode: "TW", barDate: isoDateDaysAgo(2), open: 138, high: 142, low: 137, close: 141, volume: 1500 },
    ]);

    await dashboard.actions.navigateToDashboard();
    await dashboard.assert.appIsReady();
    await dashboard.actions.generateSnapshotsAndWait();
    await dashboard.assert.snapshotStatusContains(
      /generating|generated|snapshots generated/i,
      { timeout: 10_000 },
    );

    await ticker.actions.navigateToTicker(SYNTHETIC_TW_TICKER);
    await ticker.assert.sectionIsVisible();
    await ticker.assert.chartPanelIsVisible();
    await ticker.assert.chartMetricIsSelected("Current Price");
    await ticker.assert.chartLineCurvesCountIsAtLeast(2);
    await ticker.assert.chartYAxisTickLabelsCountIsAtLeast(2);

    await ticker.actions.selectChartMetric("Unrealized P&L");
    await ticker.assert.chartMetricIsSelected("Unrealized P&L");
    await ticker.assert.chartLineCurvesCountIsAtLeast(1);
    await ticker.assert.chartYAxisTickLabelsCountIsAtLeast(2);

    await appShell.actions.setViewport(375, 667);
    await ticker.assert.chartPanelIsVisible();
    await ticker.assert.chartLineCurvesCountIsAtLeast(1);
    await ticker.assert.chartYAxisTickLabelsCountIsAtLeast(2);

    await ticker.actions.selectChartMetric("Current Price");
    await ticker.assert.chartMetricIsSelected("Current Price");
    await ticker.assert.chartLineCurvesCountIsAtLeast(2);
    await ticker.assert.chartYAxisTickLabelsCountIsAtLeast(2);
  });
});
