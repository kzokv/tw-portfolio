import { test } from "@vakwen/test-e2e/fixtures/appPages";

// NOTE: _seedDailyBars appends to a global (non-per-user) array in MemoryPersistence.
// It is never cleared between tests. Tests that seed bars for the same ticker
// accumulate entries; getLatestBars(ticker, 2) always returns the 2 most-recent dates.
// Test 3 seeds 2330 bars from 2026-04-04/05. Test 4 uses "0050" (a catalog-backed
// fresh ticker) to avoid duplicate-date accumulation with test 3's 2330 bars. Test 5 uses "00919"
// (another default catalog-backed ticker) to guarantee its stale bars are the latest while staying quoteable.
//
// Provisional note: computeIsProvisional() returns false on weekends (Sat/Sun TST).
// Test 5 is skipped on weekends. Tests 3 and 4 still pass on weekends because the
// daily change value and color class render regardless of provisional status.

test("dashboard: daily change column renders with missing quote indicators", async ({
  dashboard,
  appShell,
}) => {
  await appShell.actions.setViewport(1440, 960);
  // Seed a trade so the holdings table renders; no bars → quoteStatus = "missing"
  await dashboard.arrange.seedTrade({ ticker: "2330", quantity: 100, unitPrice: 500 });
  await dashboard.actions.navigateToDashboard();
  await dashboard.assert.appIsReady();

  await dashboard.assert.holdingsTableHasDailyChangeColumn();
  await dashboard.assert.holdingRowContainsText("2330", /Missing quote/i);
  await dashboard.assert.heroPanelContains(/Waiting for market value data/i);
});

test("dashboard: daily change metric cards render in summary section", async ({
  dashboard,
  appShell,
}) => {
  await appShell.actions.setViewport(1440, 960);
  // Seed a trade so the dashboard is in an active state; no bars → dailyChangeAmount = null
  await dashboard.arrange.seedTrade({ ticker: "2330", quantity: 100, unitPrice: 500 });
  await dashboard.actions.navigateToDashboard();
  await dashboard.assert.appIsReady();

  await dashboard.assert.heroPanelContains(/Daily Change/i);
  await dashboard.assert.heroPanelContains(/Waiting for market value data/i);
});

test("dashboard: positive daily change → green color coding and percent display", async ({
  dashboard,
  appShell,
}) => {
  await appShell.actions.setViewport(1440, 960);
  await dashboard.arrange.seedTrade({ ticker: "2330", quantity: 100, unitPrice: 500 });
  await dashboard.arrange.seedDailyBars([
    { ticker: "2330", barDate: "2026-04-04", open: 98, high: 100, low: 97, close: 99, volume: 1000 },
    { ticker: "2330", barDate: "2026-04-05", open: 99, high: 101, low: 98, close: 100, volume: 1200 },
  ]);
  await dashboard.actions.navigateToDashboard();
  await dashboard.assert.appIsReady();

  // change = close(2026-04-05) - close(2026-04-04) = 100 - 99 = 1 TWD (positive → emerald)
  await dashboard.assert.holdingRowHasColorClass("2330", "text-emerald-600");
  await dashboard.assert.holdingRowContainsText("2330", /\d+/);
});

test("dashboard: mixed quote coverage → summary daily change shows fallback", async ({
  dashboard,
  appShell,
}) => {
  await appShell.actions.setViewport(1440, 960);
  // Use "0050" (not "2330") — test 3 seeds current-date bars for 2330.
  // Reusing 2330 would accumulate duplicate-date entries: getLatestBars would return
  // two 2026-04-05 bars (same close), yielding change = 0 instead of a positive value.
  await dashboard.arrange.seedTrade({ ticker: "0050", quantity: 100, unitPrice: 100 });
  await dashboard.arrange.seedTrade({ ticker: "2317", quantity: 50, unitPrice: 100 });
  // Only 00919 gets bars; 2317 has none → quoteStatus = "missing" for 2317
  await dashboard.arrange.seedDailyBars([
    { ticker: "0050", barDate: "2026-04-04", open: 98, high: 100, low: 97, close: 99, volume: 1000 },
    { ticker: "0050", barDate: "2026-04-05", open: 99, high: 101, low: 98, close: 100, volume: 1200 },
  ]);
  await dashboard.actions.navigateToDashboard();
  await dashboard.assert.appIsReady();

  // 2317 has no bars → missing quote fallback
  await dashboard.assert.holdingRowContainsText("2317", /Missing quote/i);
  // hasMissingQuote = true (any missing quote) → dailyChangeAmount = null → fallback text
  await dashboard.assert.heroPanelContains(/Waiting for market value data/i);
});

test("dashboard: provisional quote shows status badge", async ({
  dashboard,
  appShell,
}) => {
  // computeIsProvisional() returns false on weekends (Sat/Sun TST) — market is closed.
  // Skip this test on weekends to avoid false failures.
  const tstDayOfWeek = new Date(Date.now() + 8 * 60 * 60 * 1000).getUTCDay();
  // eslint-disable-next-line playwright/no-skipped-test
  test.skip(tstDayOfWeek === 0 || tstDayOfWeek === 6, "computeIsProvisional returns false on weekends — provisional status not rendered");

  await appShell.actions.setViewport(1440, 960);
  // Use "00919" (not "2330" or "0050") — tests 3 and 4 seed current-date (2026-04-05)
  // bars for those tickers. If we reused either ticker here, getLatestBars would return the 2026-04-05 bar (= today),
  // and computeIsProvisional would return false, masking the provisional indicator.
  await dashboard.arrange.seedTrade({ ticker: "00919", quantity: 100, unitPrice: 100 });
  await dashboard.arrange.seedDailyBars([
    { ticker: "00919", barDate: "2026-03-20", open: 98, high: 100, low: 97, close: 99, volume: 1000 },
    { ticker: "00919", barDate: "2026-03-21", open: 99, high: 101, low: 98, close: 100, volume: 1200 },
  ]);
  await dashboard.actions.navigateToDashboard();
  await dashboard.assert.appIsReady();

  // Stale bars (2026-03-21 < today on weekdays) → isProvisional = true → Provisional status renders
  await dashboard.assert.holdingRowContainsText("00919", /Provisional/i);
});
