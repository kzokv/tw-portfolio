import { test } from "@vakwen/test-e2e/fixtures/appPages";

// ui-reshape Phase 2D — Settings → Display accent preset picker (8 swatches).
// Persists per-account via /user-preferences. Updates --primary at runtime.

test.describe("accent preset", () => {
  test("default is indigo; click Emerald → --primary updates + swatch selected", async ({
    appShell,
    dashboard,
  }) => {
    await dashboard.actions.navigateToDashboard();
    await dashboard.assert.appIsReady();

    // Ensure deterministic theme (light) so the preset's light HSL applies.
    await appShell.actions.clickThemeToggle("light");
    await appShell.assert.themeIs("light");

    // Default accent (indigo, light) = "238 84% 60%".
    await appShell.assert.primaryAccentIs({ h: 238, s: 84, l: 60 });

    await appShell.actions.openSettingsDrawer();
    await appShell.actions.clickSettingsDisplayTab();
    await appShell.assert.accentSwatchIsSelected("indigo");

    // Switch to Emerald → light HSL "158 64% 40%".
    await appShell.actions.clickAccentSwatch("emerald");
    await appShell.assert.accentSwatchIsSelected("emerald");
    await appShell.assert.primaryAccentIs({ h: 158, s: 64, l: 40 });
  });

  test("preset persists across reload (user_preferences)", async ({
    appShell,
    dashboard,
  }) => {
    await dashboard.actions.navigateToDashboard();
    await dashboard.assert.appIsReady();
    await appShell.actions.clickThemeToggle("light");

    await appShell.actions.openSettingsDrawer();
    await appShell.actions.clickSettingsDisplayTab();
    await appShell.actions.clickAccentSwatch("rose");
    await appShell.assert.primaryAccentIs({ h: 347, s: 77, l: 50 });

    await appShell.actions.reloadPage();
    await appShell.assert.primaryAccentIs({ h: 347, s: 77, l: 50 });
  });
});
