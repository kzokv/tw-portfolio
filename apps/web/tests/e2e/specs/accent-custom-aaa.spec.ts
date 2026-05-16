import { test } from "@vakwen/test-e2e/fixtures/appPages";

// ui-reshape Phase 2D — Custom accent picker (9th swatch). HSL panel + hex
// input + AA contrast badge (soft-warn). Apply writes a discriminated-union
// {kind:"custom",h,s,l} value to user_preferences.

test.describe("accent custom", () => {
  test("open picker, set hex, Apply → --primary updates + persists", async ({
    appShell,
    dashboard,
  }) => {
    await dashboard.actions.navigateToDashboard();
    await dashboard.assert.appIsReady();
    await appShell.actions.clickThemeToggle("light");

    await appShell.actions.openSettingsSection("display");
    await appShell.actions.openCustomAccentPicker();
    await appShell.assert.customAccentPanelIsVisible();

    // #5B6FFF → HSL(233, 100%, 68%) via lib/theme.ts hexToHsl.
    await appShell.actions.setCustomAccentHex("#5B6FFF");
    await appShell.actions.applyCustomAccent();
    await appShell.assert.primaryAccentIs({ h: 233, s: 100, l: 68 });

    // Persists across reload (per-account via /user-preferences JSONB).
    await appShell.actions.reloadPage();
    await appShell.assert.primaryAccentIs({ h: 233, s: 100, l: 68 });
  });

  test("Reset-to-Indigo restores the default preset", async ({
    appShell,
    dashboard,
  }) => {
    await dashboard.actions.navigateToDashboard();
    await dashboard.assert.appIsReady();
    await appShell.actions.clickThemeToggle("light");

    await appShell.actions.openSettingsSection("display");
    await appShell.actions.openCustomAccentPicker();
    await appShell.actions.setCustomAccentHex("#22D3EE");
    await appShell.actions.applyCustomAccent();

    // Now Reset.
    await appShell.actions.resetCustomAccent();
    await appShell.assert.primaryAccentIs({ h: 238, s: 84, l: 60 });
  });
});
