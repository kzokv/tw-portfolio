import { test } from "@vakwen/test-e2e/fixtures/appPages";

// Phase 5e — floating ⨁ button + Sheet (replaces ActionCenter recompute/snapshots).
// Hidden when shared-context active; on /dashboard only.

test("[floating-A] trigger visible on /dashboard; opens sheet with 3 actions", async ({
  dashboard,
  appShell,
}) => {
  await appShell.actions.setViewport(1440, 960);
  await dashboard.actions.navigateToDashboard();
  await dashboard.assert.appIsReady();

  await dashboard.assert.floatingQuickActionsTriggerIsVisible();
  await dashboard.actions.openFloatingQuickActions();
  await dashboard.assert.floatingQuickActionsSheetIsVisible();
  await dashboard.assert.floatingActionAddTransactionIsVisible();
  await dashboard.assert.floatingActionRecomputeIsVisible();
  await dashboard.assert.floatingActionGenerateSnapshotsIsVisible();
});

test("[floating-E] trigger hidden on non-dashboard routes", async ({
  dashboard,
  appShell,
}) => {
  await appShell.actions.setViewport(1440, 960);
  await appShell.actions.navigateToRoute("/portfolio");
  await appShell.assert.appIsReady();

  await dashboard.assert.floatingQuickActionsTriggerIsHidden();
});
