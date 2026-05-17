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
  // Seed a trade with no daily bars → quoteStatus = "missing" → no movers.
  await dashboard.arrange.seedTrade({ ticker: "2330", quantity: 100, unitPrice: 500 });
  await dashboard.actions.navigateToDashboard();
  await dashboard.assert.appIsReady();

  await dashboard.assert.dashboardBiggestMoversIsVisible();
  await dashboard.assert.dashboardBiggestMoversIsEmpty();
});
