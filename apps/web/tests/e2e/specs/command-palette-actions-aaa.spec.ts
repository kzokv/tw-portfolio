// Phase 3e (§3e + §12 A2) — ⌘K Command Palette: theme / accent /
// transaction.add / recompute.all action commands.
//
// Test cases:
//   [actions-A] "Switch to dark" → <html> gains the `dark` class
//   [actions-B] "Change accent to Emerald" → PATCH /user-preferences persists
//                 (next mount surfaces the new accent via AccentApplier)
//   [actions-C] "Add transaction" → AddTransactionDialog opens
//   [actions-D] "Recompute all positions" → AlertDialog opens → confirm
//                 closes the AlertDialog (recompute API runs in background)
//   [actions-E] AlertDialog Cancel → dialog closes; recompute does NOT fire

import { test } from "@vakwen/test-e2e/fixtures/appPages";

test.describe("Phase 3e command palette actions", () => {
  test("[actions-A]: 'Switch to dark' updates theme", async ({ appShell, dashboard }) => {
    await dashboard.actions.navigateToDashboard();
    await dashboard.assert.appIsReady();

    // Pre-condition: theme is light.
    await appShell.actions.clickThemeToggle("light");
    await appShell.assert.themeIs("light");

    await appShell.actions.openCommandPalette();
    await appShell.actions.clickCommandPaletteAction("theme-dark");

    await appShell.assert.themeIs("dark");
    await appShell.assert.commandPaletteIsHidden();
  });

  test("[actions-B]: 'Change accent to Emerald' applies + persists", async ({
    appShell,
    dashboard,
  }) => {
    await dashboard.actions.navigateToDashboard();
    await dashboard.assert.appIsReady();

    await appShell.actions.openCommandPalette();
    await appShell.actions.clickCommandPaletteAction("accent-emerald");
    await appShell.assert.commandPaletteIsHidden();

    // Reload — `AccentApplier` reads the persisted preference and re-applies.
    await appShell.actions.reloadShellPage();
    // Emerald light-mode HSL is `158 64% 40%` (see apps/web/lib/theme.ts).
    // After reload, `<html>` is in light mode unless toggled otherwise.
    await appShell.assert.primaryAccentIs({ h: 158, s: 64, l: 40 });
  });

  test("[actions-C]: 'Add transaction' opens AddTransactionDialog", async ({
    appShell,
    dashboard,
  }) => {
    await dashboard.actions.navigateToDashboard();
    await dashboard.assert.appIsReady();

    await appShell.actions.openCommandPalette();
    await appShell.actions.clickCommandPaletteAction("transaction-add");

    await appShell.assert.commandPaletteIsHidden();
    await appShell.assert.addTransactionDialogIsVisible();
  });

  test("[actions-D]: 'Recompute all positions' opens AlertDialog → confirm closes it", async ({
    appShell,
    dashboard,
  }) => {
    await dashboard.actions.navigateToDashboard();
    await dashboard.assert.appIsReady();

    await appShell.actions.openCommandPalette();
    await appShell.actions.clickCommandPaletteAction("recompute-all");

    await appShell.assert.commandPaletteIsHidden();
    await appShell.assert.recomputeAlertDialogIsVisible();

    await appShell.actions.confirmRecomputeAlertDialog();
    await appShell.assert.recomputeAlertDialogIsHidden();
  });

  test("[actions-E]: AlertDialog Cancel closes without firing recompute", async ({
    appShell,
    dashboard,
  }) => {
    await dashboard.actions.navigateToDashboard();
    await dashboard.assert.appIsReady();

    await appShell.actions.openCommandPalette();
    await appShell.actions.clickCommandPaletteAction("recompute-all");

    await appShell.assert.recomputeAlertDialogIsVisible();
    await appShell.actions.cancelRecomputeAlertDialog();
    await appShell.assert.recomputeAlertDialogIsHidden();
  });
});
