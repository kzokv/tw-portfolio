import { test } from "@vakwen/test-e2e/fixtures/appPages";
import { seedResolvedShareFromAdmin, seedUser, switchIdentity } from "./helpers/sharing";

test.describe("portfolio switcher visibility", () => {
  test("[switcher visibility]: 0 inbound shares hides switcher; active inbound share shows self + owner option", async ({
    appShell,
    contextSwitcher,
    dashboard,
    page,
  }) => {
    const viewer = await seedUser({
      sub: "e2e-switcher-visibility-viewer-sub",
      email: "switcher-visibility-viewer@example.com",
      name: "Switcher Visibility Viewer",
      role: "viewer",
    });

    await switchIdentity(page, { userId: viewer.userId, role: "viewer" });
    await dashboard.actions.navigateToDashboard();
    await appShell.assert.appIsReady();
    await contextSwitcher.assert.switcherIsHidden();

    const owner = await seedUser({
      sub: "e2e-switcher-visibility-owner-sub",
      email: "switcher-visibility-owner@example.com",
      name: "Switcher Visibility Owner",
      role: "member",
    });

    await seedResolvedShareFromAdmin(viewer.email, owner.userId);
    await page.reload();
    await appShell.assert.appIsReady();

    await contextSwitcher.assert.switcherIsVisible();
    await contextSwitcher.actions.openDropdown();
    await contextSwitcher.assert.optionSelfIsVisible();
    await contextSwitcher.assert.ownerOptionIsVisible(owner.userId);
    await contextSwitcher.assert.dropdownContainsText("My Portfolio");
    await contextSwitcher.assert.dropdownContainsText("Switcher Visibility Owner");
  });
});
