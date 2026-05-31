// Phase 3g (§12 A8) — Mobile shell behavior across viewport gates.
//
// This spec runs under the two Phase 3g viewport projects:
//   - chromium-mobile (375 × 667)
//   - chromium-tablet (768 × 1024)
//
// Each `test()` branches on the runtime viewport so the same spec exercises
// the mobile-Sheet path on `<md` and the desktop-collapse path at `≥md`.
// Phase 3g does NOT add mobile coverage to the desktop chromium project —
// the project-level `testMatch: /mobile-.*-aaa\.spec\.ts/` filter in
// `playwright.config.ts` scopes this file to the two narrow projects.
//
// Test cases:
//   [mobile-shell-A]  <md: brand button opens the sidebar Sheet
//   [mobile-shell-B]  <md: clicking a nav item closes the Sheet and navigates
//   [mobile-shell-C]  ≥md: desktop sidebar visible; trigger collapses to icon
//
// Page-object surface used:
//   - appShell.actions.openMobileSidebar()  / closeMobileSidebar()  (Phase 3g)
//   - appShell.actions.navigateViaMobileSidebar(destination)        (Phase 3c)
//   - appShell.actions.toggleDesktopSidebar()                       (Phase 3c)
//   - appShell.assert.desktopSidebarCollapsedStateIs(boolean)       (Phase 3c)
//   - appShell.assert.sidebarNavItemIsVisible(key)                  (Phase 3g)

import { test } from "@vakwen/test-e2e/fixtures/appPages";

const MD_BREAKPOINT_PX = 768;

test.describe("Phase 3g mobile shell", () => {
  test("[mobile-shell-A]: brand button opens mobile sheet at <md viewport", async ({
    appShell,
    page,
  }) => {
    const viewport = page.viewportSize();
    // eslint-disable-next-line playwright/no-skipped-test
    test.skip(
      !viewport || viewport.width >= MD_BREAKPOINT_PX,
      "Mobile-only — exercises the <md Sheet path",
    );

    await appShell.actions.navigateToRouteForResponsiveTest("/dashboard");

    // The mobile brand trigger is the only sidebar anchor visible on <md.
    await appShell.assert.mobileNavToggleIsVisible();

    await appShell.actions.openMobileSidebar();

    // Sheet content carries the same app-sidebar testid; nav items must be
    // visible after the open animation completes.
    await appShell.assert.sidebarNavItemIsVisible("dashboard");
  });

  test("[mobile-shell-B]: nav-item click closes the sheet and routes at <md", async ({
    appShell,
    page,
  }) => {
    const viewport = page.viewportSize();
    // eslint-disable-next-line playwright/no-skipped-test
    test.skip(
      !viewport || viewport.width >= MD_BREAKPOINT_PX,
      "Mobile-only — exercises the <md Sheet path",
    );

    await appShell.actions.navigateToRouteForResponsiveTest("/dashboard");

    await appShell.actions.openMobileSidebar();
    await appShell.actions.navigateViaMobileSidebar("portfolio");

    // After the nav-item click the AppSidebar invokes `setOpenMobile(false)`;
    // Radix Sheet unmounts its content. The sheet's nav-item locator must
    // become hidden / detached, and the URL must reflect the new route.
    await appShell.assert.sidebarNavItemIsHidden("dashboard");
    await appShell.assert.isOnRoute(/\/portfolio(?:[?#/]|$)/);
  });

  test("[mobile-shell-C]: desktop sidebar visible and collapses to icon at ≥md", async ({
    appShell,
    page,
  }) => {
    const viewport = page.viewportSize();
    // eslint-disable-next-line playwright/no-skipped-test
    test.skip(
      !viewport || viewport.width < MD_BREAKPOINT_PX,
      "Tablet+ only — exercises the ≥md desktop collapse path",
    );

    await appShell.actions.navigateToRouteForResponsiveTest("/dashboard");

    await appShell.assert.desktopSidebarIsVisible();
    await appShell.assert.desktopNavToggleIsVisible();

    // Expanded by default, then collapse via the app-sidebar-trigger button.
    await appShell.assert.desktopSidebarCollapsedStateIs(false);
    await appShell.actions.toggleDesktopSidebar();
    await appShell.assert.desktopSidebarCollapsedStateIs(true);
  });
});
