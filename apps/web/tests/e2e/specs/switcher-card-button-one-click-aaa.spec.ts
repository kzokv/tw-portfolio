import { TestEnv } from "@tw-portfolio/config/test";
import { test } from "@tw-portfolio/test-e2e/fixtures/appPages";
import {
  seedResolvedShareFromAdmin,
  seedTransactionForUser,
  seedUser,
  switchIdentity,
} from "./helpers/sharing";

test.describe("sharing inbound card open-in-switcher", () => {
  test("[switcher card button]: inbound card click sets cookie, routes to dashboard, and shows owner context", async ({
    appShell,
    contextSwitcher,
    dashboard,
    page,
    sharing,
  }) => {
    const owner = await seedUser({
      sub: "e2e-switcher-card-owner-sub",
      email: "switcher-card-owner@example.com",
      name: "Switcher Card Owner",
      role: "member",
    });
    const grantee = await seedUser({
      sub: "e2e-switcher-card-grantee-sub",
      email: "switcher-card-grantee@example.com",
      name: "Switcher Card Grantee",
      role: "viewer",
    });

    await seedTransactionForUser(owner.userId, {
      ticker: "2330",
      quantity: 100,
      unitPrice: 600,
      tradeDate: "2026-01-02",
    });
    const { shareId } = await seedResolvedShareFromAdmin(grantee.email, owner.userId);

    await switchIdentity(page, { userId: grantee.userId, role: "viewer" });
    await page.goto(new URL("/sharing", TestEnv.appBaseUrl).href, { waitUntil: "domcontentloaded" });
    await appShell.assert.appIsReady();
    await sharing.assert.inboundCardVisible(shareId);
    await sharing.assert.openDashboardButtonIsVisible(shareId);
    await page.getByTestId(`sharing-open-dashboard-${shareId}`).click();
    await dashboard.assert.isOnDashboard();
    await appShell.assert.appIsReady();

    await contextSwitcher.assert.cookieEquals(owner.userId);
    await contextSwitcher.assert.assertSwitchedIn("Switcher Card Owner");
    await dashboard.assert.holdingsTableContains("2330");
  });
});
