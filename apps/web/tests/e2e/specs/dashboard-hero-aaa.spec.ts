import { test } from "@vakwen/test-e2e/fixtures/appPages";

// Phase 5d/5e — slim hero block (DashboardHero + BiggestMoversCard) renders
// above the SortableCardGrid. Verifies the new layout's smoke-level shape.

test("[hero-A] DashboardHero renders total + day Δ above the grid", async ({
  dashboard,
  appShell,
}) => {
  await appShell.actions.setViewport(1440, 960);
  await dashboard.arrange.seedTrade({ ticker: "2330", quantity: 100, unitPrice: 500 });
  await dashboard.actions.navigateToDashboard();
  await dashboard.assert.appIsReady();

  await dashboard.assert.dashboardHeroIsVisible();
  await dashboard.assert.dashboardHeroTotalIsVisible();
  await dashboard.assert.dashboardHeroDayDeltaIsVisible();
});

test("[hero-C] BiggestMoversCard shows empty state when no holdings have quotes", async ({
  dashboard,
  appShell,
}) => {
  await appShell.actions.setViewport(1440, 960);
  // Use a ticker that NO other spec seeds daily bars for. MemoryPersistence
  // stores bars in a process-global array (see
  // .claude/rules/e2e-shared-memory-bars-ticker-hygiene.md); reusing `2330`
  // would import bar pollution from parallel specs and break the
  // empty-state assertion. `9876` is a synthetic ticker reserved for this
  // dashboard-hero empty-state case only.
  await dashboard.arrange.seedTrade({ ticker: "9876", quantity: 100, unitPrice: 500 });
  await dashboard.actions.navigateToDashboard();
  await dashboard.assert.appIsReady();

  await dashboard.assert.dashboardBiggestMoversIsVisible();
  await dashboard.assert.dashboardBiggestMoversIsEmpty();
});
