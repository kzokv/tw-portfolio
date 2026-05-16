import { test } from "@vakwen/test-e2e/fixtures/appPages";

// ui-reshape Phase 2D — Settings → Display density toggle.
// Writes data-density="comfortable" on <html>; Compact removes the attribute.

test.describe("density toggle", () => {
  test("compact default → flip to Comfortable → flip back to Compact", async ({
    appShell,
    dashboard,
  }) => {
    await dashboard.actions.navigateToDashboard();
    await dashboard.assert.appIsReady();

    await appShell.assert.densityIs("compact");

    await appShell.actions.openSettingsDrawer();
    await appShell.actions.clickSettingsDisplayTab();

    await appShell.actions.clickDensityToggle("comfortable");
    await appShell.assert.densityIs("comfortable");

    await appShell.actions.clickDensityToggle("compact");
    await appShell.assert.densityIs("compact");
  });

  test("comfortable persists across reload", async ({ appShell, dashboard }) => {
    await dashboard.actions.navigateToDashboard();
    await dashboard.assert.appIsReady();

    await appShell.actions.openSettingsDrawer();
    await appShell.actions.clickSettingsDisplayTab();
    await appShell.actions.clickDensityToggle("comfortable");
    await appShell.assert.densityIs("comfortable");

    await appShell.actions.reloadPage();
    await appShell.assert.densityIs("comfortable");
  });
});
