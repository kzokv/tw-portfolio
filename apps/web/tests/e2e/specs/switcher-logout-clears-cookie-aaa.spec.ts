import { TestEnv } from "@tw-portfolio/config/test";
import { test } from "@tw-portfolio/test-e2e/fixtures/appPages";
import {
  seedResolvedShareFromAdmin,
  seedUser,
  switchIdentity,
} from "./helpers/sharing";

test.describe("portfolio switcher logout cleanup", () => {
  test("[switcher logout]: switched-in grantee signs out → context cookie clears", async ({
    appShell,
    contextSwitcher,
    page,
  }) => {
    const owner = await seedUser({
      sub: "e2e-switcher-logout-owner-sub",
      email: "switcher-logout-owner@example.com",
      name: "Switcher Logout Owner",
      role: "member",
    });
    const grantee = await seedUser({
      sub: "e2e-switcher-logout-grantee-sub",
      email: "switcher-logout-grantee@example.com",
      name: "Switcher Logout Grantee",
      role: "member",
    });

    await seedResolvedShareFromAdmin(grantee.email, owner.userId);

    await switchIdentity(page, { userId: grantee.userId, role: "member" });
    await appShell.actions.navigateToRoute("/dashboard");
    await appShell.assert.appIsReady();

    await contextSwitcher.actions.selectOwner(owner.userId);
    await contextSwitcher.assert.assertSwitchedIn("Switcher Logout Owner");
    await contextSwitcher.assert.cookieEquals(owner.userId);

    await appShell.actions.openAvatarMenu();
    await appShell.actions.clickAvatarMenuSignOut();

    await appShell.assert.isOnRoute(/\/login$/);
    await contextSwitcher.assert.cookieEquals(null);
  });

  test("[switcher logout direct]: direct-GET /auth/logout response clears context cookie", async ({
    contextSwitcher,
    page,
  }) => {
    const grantee = await seedUser({
      sub: "e2e-switcher-logout-direct-sub",
      email: "switcher-logout-direct@example.com",
      name: "Switcher Logout Direct",
      role: "member",
    });

    await switchIdentity(page, { userId: grantee.userId, role: "member" });
    // Plant a context cookie directly so we don't depend on UI selection.
    await page.context().addCookies([
      {
        name: "tw_context_user_id",
        value: "owner-42",
        domain: TestEnv.host,
        path: "/",
        sameSite: "Lax",
      },
    ]);
    await contextSwitcher.assert.cookieEquals("owner-42");

    // Navigate directly to the Fastify logout URL (bypasses any UI onClick).
    await page.goto(`http://${TestEnv.host}:${TestEnv.ports.api}/auth/logout`, {
      waitUntil: "domcontentloaded",
    });

    await contextSwitcher.assert.cookieEquals(null);
  });
});
