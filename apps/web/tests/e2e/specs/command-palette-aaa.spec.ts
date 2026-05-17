// Phase 3e (§3e + §12 A2) — ⌘K Command Palette: route navigation + ticker
// typeahead surface.
//
// Test cases:
//   [palette-A] Trigger click opens the palette dialog
//   [palette-B] Type "dashboard" → Dashboard route item visible; Enter navigates
//   [palette-C] Empty state surfaces when query matches nothing
//   [palette-D] Closing the palette via Escape hides the dialog
//
// Live ticker typeahead (TW/US/AU markets) lives behind /market-data/search;
// the underlying provider is mocked at the API layer in dev_bypass mode
// (`AU_PROVIDER_MOCK=true`). To keep this spec deterministic we assert on the
// route + action surfaces only — ticker results are exercised in the
// command-palette-actions spec via the in-memory route fallback path.

import { test } from "@vakwen/test-e2e/fixtures/appPages";

test.describe("Phase 3e command palette", () => {
  test("[palette-A]: trigger click opens dialog", async ({ appShell, dashboard }) => {
    await dashboard.actions.navigateToDashboard();
    await dashboard.assert.appIsReady();

    await appShell.assert.commandPaletteIsHidden();
    await appShell.actions.openCommandPalette();
    await appShell.assert.commandPaletteIsVisible();
  });

  test("[palette-B]: type 'dashboard' → route item visible; Enter navigates", async ({
    appShell,
    dashboard,
  }) => {
    await dashboard.actions.navigateToDashboard();
    await dashboard.assert.appIsReady();

    // Start somewhere other than /dashboard so the routing change is real.
    await appShell.actions.navigateToRoute("/portfolio");
    await appShell.assert.appIsReady();

    await appShell.actions.openCommandPalette();
    await appShell.actions.typeInCommandPalette("dashboard");
    await appShell.assert.commandPaletteRouteIsVisible("dashboard");

    await appShell.actions.pressEnterInCommandPalette();
    await appShell.assert.isOnRoute(/\/dashboard(?:[?#/]|$)/);
    await appShell.assert.commandPaletteIsHidden();
  });

  test("[palette-C]: query with no matches shows the empty state", async ({
    appShell,
    dashboard,
  }) => {
    await dashboard.actions.navigateToDashboard();
    await dashboard.assert.appIsReady();

    await appShell.actions.openCommandPalette();
    // Random unicode that cannot match any route / action / live ticker.
    await appShell.actions.typeInCommandPalette("ZZZ__nothing__matches__XYZ");
    await appShell.assert.commandPaletteEmptyStateIsVisible();
  });

  test("[palette-D]: Escape closes the dialog", async ({ appShell, dashboard }) => {
    await dashboard.actions.navigateToDashboard();
    await dashboard.assert.appIsReady();

    await appShell.actions.openCommandPalette();
    await appShell.assert.commandPaletteIsVisible();
    await appShell.actions.pressEscapeInCommandPalette();
    await appShell.assert.commandPaletteIsHidden();
  });
});
