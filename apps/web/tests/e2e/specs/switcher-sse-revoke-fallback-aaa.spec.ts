import { test } from "@tw-portfolio/test-e2e/fixtures/appPages";
import {
  revokeShareAsOwner,
  seedResolvedShareFromAdmin,
  seedTransactionForUser,
  seedUser,
  switchIdentity,
} from "./helpers/sharing";

test.describe("portfolio switcher SSE revoke fallback", () => {
  test("[switcher revoke]: SSE revoke resets selection, clears cookie, shows message, and refetches self data", async ({
    appShell,
    contextSwitcher,
    dashboard,
    page,
  }) => {
    // Setup + navigation + switcher settle + SSE revoke delivery. CI 2-worker
    // contention can push total test time beyond the default 30s budget.
    test.slow();
    const owner = await seedUser({
      sub: "e2e-switcher-revoke-owner-sub",
      email: "switcher-revoke-owner@example.com",
      name: "Switcher Revoke Owner",
      role: "member",
    });
    const grantee = await seedUser({
      sub: "e2e-switcher-revoke-grantee-sub",
      email: "switcher-revoke-grantee@example.com",
      name: "Switcher Revoke Grantee",
      role: "member",
    });

    await seedTransactionForUser(owner.userId, {
      ticker: "2330",
      quantity: 100,
      unitPrice: 600,
      tradeDate: "2026-01-02",
    });
    await seedTransactionForUser(grantee.userId, {
      ticker: "0050",
      quantity: 10,
      unitPrice: 180,
      tradeDate: "2026-01-03",
    });
    const { shareId } = await seedResolvedShareFromAdmin(grantee.email, owner.userId);

    await switchIdentity(page, { userId: grantee.userId, role: "member" });
    await dashboard.actions.navigateToDashboard();
    await appShell.assert.appIsReady();
    await contextSwitcher.actions.switchTo(owner.userId);
    await appShell.assert.appIsReady();
    await contextSwitcher.assert.assertSwitchedIn("Switcher Revoke Owner");
    await dashboard.assert.holdingsTableContains("2330");

    await revokeShareAsOwner(shareId, owner.userId);

    await appShell.assert.statusToastContains(/revoked/i);
    await contextSwitcher.assert.cookieEquals(null);
    await contextSwitcher.assert.assertSwitchedOut();
    await dashboard.assert.holdingsTableContains("0050");
    await dashboard.assert.holdingsTableNotContains("2330");
  });
});
