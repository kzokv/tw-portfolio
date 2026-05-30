import { test } from "@vakwen/test-e2e/fixtures/appPages";

// ui-reshape Phase 2D — TopBar theme toggle (light · system · dark).
// Mode persists per-device via next-themes localStorage ("vakwen-theme").

test.describe("theme toggle", () => {
  test("toggle Dark → <html class='dark'>; toggle Light → class removed", async ({
    appShell,
    dashboard,
  }) => {
    await dashboard.actions.navigateToDashboard();
    await dashboard.assert.appIsReady();

    // Default = system; resolved theme depends on OS pref. Force Light first
    // to get a deterministic baseline regardless of headless Chrome's pref.
    await appShell.actions.clickThemeToggle("light");
    await appShell.assert.themeIs("light");

    await appShell.actions.clickThemeToggle("dark");
    await appShell.assert.themeIs("dark");

    await appShell.actions.clickThemeToggle("light");
    await appShell.assert.themeIs("light");
  });

  test("dark choice persists across reload (localStorage)", async ({
    appShell,
    dashboard,
  }) => {
    await dashboard.actions.navigateToDashboard();
    await dashboard.assert.appIsReady();

    await appShell.actions.clickThemeToggle("dark");
    await appShell.assert.themeIs("dark");

    await appShell.actions.reloadPage();
    await appShell.assert.themeIs("dark");
  });
});
