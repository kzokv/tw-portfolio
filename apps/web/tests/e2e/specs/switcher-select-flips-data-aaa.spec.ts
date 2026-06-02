import { TestEnv } from "@vakwen/config/test";
import { test } from "@vakwen/test-e2e/fixtures/appPages";
import {
  seedResolvedShareFromAdmin,
  seedTransactionForUser,
  seedUser,
  switchIdentity,
} from "./helpers/sharing";

test.describe("portfolio switcher selection", () => {
  test("[switcher select]: choose owner option → owner data renders, cookie persists, write controls hide", async ({
    appShell,
    contextSwitcher,
    dashboard,
    page,
  }) => {
    const owner = await seedUser({
      sub: "e2e-switcher-select-owner-sub",
      email: "switcher-select-owner@example.com",
      name: "Switcher Select Owner",
      role: "member",
    });
    const grantee = await seedUser({
      sub: "e2e-switcher-select-grantee-sub",
      email: "switcher-select-grantee@example.com",
      name: "Switcher Select Grantee",
      role: "member",
    });

    await seedTransactionForUser(owner.userId, {
      ticker: "2330",
      quantity: 100,
      unitPrice: 600,
      tradeDate: "2026-01-02",
    });
    await seedResolvedShareFromAdmin(grantee.email, owner.userId);

    await switchIdentity(page, { userId: grantee.userId, role: "member" });
    await page.goto(new URL("/dashboard", TestEnv.appBaseUrl).href, { waitUntil: "domcontentloaded" });
    await appShell.assert.appIsReady();
    await contextSwitcher.assert.switcherIsVisible();
    await contextSwitcher.assert.assertSwitchedOut();
    await dashboard.assert.recomputeButtonIsVisible();
    await dashboard.assert.generateSnapshotsButtonIsVisible();

    const dashboardRefresh = page.waitForResponse(
      (response) =>
        response.request().method() === "GET"
        && response.url().includes("/dashboard/primary")
        && response.ok(),
    );

    await contextSwitcher.actions.selectOwner(owner.userId);
    await dashboardRefresh;

    await contextSwitcher.assert.assertSwitchedIn("Switcher Select Owner");
    await contextSwitcher.assert.cookieEquals(owner.userId);
    await dashboard.assert.holdingsTableContains("2330");
    await dashboard.assert.recomputeButtonIsHidden();
    await dashboard.assert.generateSnapshotsButtonIsHidden();
  });
});
