import { test } from "@vakwen/test-e2e/fixtures/appPages";

test.describe("notification center", () => {
  test("notification bell: visible in AppShell header", async ({ appShell }) => {
    await appShell.actions.navigateToRoute("/dashboard");
    await appShell.assert.appIsReady();
    await appShell.assert.notificationBellIsVisible();
  });

  test("notification bell: badge hidden when no unread notifications", async ({ appShell }) => {
    await appShell.actions.navigateToRoute("/dashboard");
    await appShell.assert.appIsReady();
    await appShell.assert.notificationBellIsVisible();
    await appShell.assert.notificationBadgeIsHidden();
  });

  test("notification dropdown: opens on bell click → shows empty state", async ({ appShell }) => {
    await appShell.actions.navigateToRoute("/dashboard");
    await appShell.assert.appIsReady();

    await appShell.actions.clickNotificationBell();
    await appShell.assert.notificationDropdownIsVisible();
    await appShell.assert.notificationEmptyStateIsVisible();
  });

  test("notification dropdown: closes on outside click", async ({ appShell }) => {
    await appShell.actions.navigateToRoute("/dashboard");
    await appShell.assert.appIsReady();

    await appShell.actions.clickNotificationBell();
    await appShell.assert.notificationDropdownIsVisible();

    await appShell.actions.clickOutsideDropdown();
    await appShell.assert.notificationDropdownIsHidden();
  });

  test("notification bell: visible across different routes", async ({ appShell }) => {
    // Bell should appear on all authenticated routes
    await appShell.actions.navigateToRoute("/dashboard");
    await appShell.assert.appIsReady();
    await appShell.assert.notificationBellIsVisible();

    await appShell.actions.navigateToRoute("/portfolio");
    await appShell.assert.appIsReady();
    await appShell.assert.notificationBellIsVisible();

    await appShell.actions.navigateToRoute("/transactions");
    await appShell.assert.appIsReady();
    await appShell.assert.notificationBellIsVisible();
  });
});
