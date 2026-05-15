import { test } from "@vakwen/test-e2e/fixtures/appPages";
import {
  seedResolvedShareFromAdmin,
  seedUser,
  switchIdentity,
} from "./helpers/sharing";

test.describe("portfolio switcher on admin routes", () => {
  test("[switcher admin route]: admin switched into member owner → /admin/users still uses admin session", async ({
    appShell,
    contextSwitcher,
    page,
  }) => {
    const owner = await seedUser({
      sub: "e2e-switcher-admin-owner-sub",
      email: "switcher-admin-owner@example.com",
      name: "Switcher Admin Owner",
      role: "member",
    });
    const admin = await seedUser({
      sub: "e2e-switcher-admin-grantee-sub",
      email: "switcher-admin-grantee@example.com",
      name: "Switcher Admin Grantee",
      role: "admin",
    });

    await seedResolvedShareFromAdmin(admin.email, owner.userId);

    await switchIdentity(page, { userId: admin.userId, role: "admin" });
    await appShell.actions.navigateToRoute("/dashboard");
    await appShell.assert.appIsReady();

    await contextSwitcher.actions.selectOwner(owner.userId);
    await contextSwitcher.assert.assertSwitchedIn("Switcher Admin Owner");
    await contextSwitcher.assert.cookieEquals(owner.userId);

    await appShell.actions.navigateToRoute("/admin/users");
    await appShell.assert.adminUsersPageIsVisible();
    await appShell.assert.adminUsersTableIsVisible();
    await appShell.assert.adminYouBadgeIsVisible();
    await contextSwitcher.assert.cookieEquals(owner.userId);
  });
});
