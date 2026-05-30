// Phase 3g (§12 A8) — Settings two-pane shell mobile dropdown.
//
// At `<md` the SettingsTwoPaneLayout swaps the desktop inner sidebar for a
// shadcn `<Select>` dropdown (testid `settings-nav-mobile`). This spec
// verifies the dropdown is visible at the mobile viewport AND that picking
// an entry navigates to the matching `/settings/{slug}` route. At the
// tablet viewport (≥md) the inner sidebar wins and the mobile dropdown is
// hidden.
//
// Test cases:
//   [mobile-settings-A]  <md: dropdown visible; desktop nav hidden
//   [mobile-settings-B]  <md: picking "Display" routes to /settings/display
//   [mobile-settings-C]  ≥md: inner sidebar visible; mobile dropdown hidden

import { test } from "@vakwen/test-e2e/fixtures/appPages";

const MD_BREAKPOINT_PX = 768;

test.describe("Phase 3g settings mobile nav", () => {
  test("[mobile-settings-A]: dropdown visible and desktop nav hidden at <md", async ({
    appShell,
    page,
  }) => {
    const viewport = page.viewportSize();
    // eslint-disable-next-line playwright/no-skipped-test
    test.skip(
      !viewport || viewport.width >= MD_BREAKPOINT_PX,
      "Mobile-only — exercises the <md dropdown",
    );

    await appShell.actions.navigateToRouteForResponsiveTest("/settings/profile");

    await appShell.assert.settingsLayoutIsVisible();
    await appShell.assert.mobileSettingsNavIsVisible();
    await appShell.assert.desktopSettingsNavIsHidden();
  });

  test("[mobile-settings-B]: picking Display routes to /settings/display at <md", async ({
    appShell,
    page,
  }) => {
    const viewport = page.viewportSize();
    // eslint-disable-next-line playwright/no-skipped-test
    test.skip(
      !viewport || viewport.width >= MD_BREAKPOINT_PX,
      "Mobile-only — exercises the <md dropdown",
    );

    await appShell.actions.navigateToRouteForResponsiveTest("/settings/profile");

    // shadcn <Select> is built on Radix — open via click on the trigger,
    // then click the matching <SelectItem> by role + accessible name. Radix
    // SelectItem uses role="option" in the open listbox.
    await appShell.actions.openMobileSettingsNav();
    await appShell.actions.selectMobileSettingsOption("Display");

    await appShell.assert.isOnRoute(/\/settings\/display(?:[?#/]|$)/);
    await appShell.assert.settingsSectionIsVisible("display");
  });

  test("[mobile-settings-C]: desktop nav visible and dropdown hidden at ≥md", async ({
    appShell,
    page,
  }) => {
    const viewport = page.viewportSize();
    // eslint-disable-next-line playwright/no-skipped-test
    test.skip(
      !viewport || viewport.width < MD_BREAKPOINT_PX,
      "Tablet+ only — exercises the ≥md desktop-nav path",
    );

    await appShell.actions.navigateToRouteForResponsiveTest("/settings/profile");

    await appShell.assert.settingsLayoutIsVisible();
    await appShell.assert.desktopSettingsNavIsVisible();
    await appShell.assert.mobileSettingsNavIsHidden();
  });
});
