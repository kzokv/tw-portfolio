import { TestEnv } from "@tw-portfolio/config/test";
import { test } from "@tw-portfolio/test-e2e/fixtures/appPages";
import {
  seedResolvedShareFromAdmin,
  seedTransactionForUser,
  seedUser,
  switchIdentity,
} from "./helpers/sharing";

test.describe("portfolio switcher deep link", () => {
  test("[switcher deep link]: /dashboard?as=owner writes cookie, strips URL, and shows owner context", async ({
    appShell,
    contextSwitcher,
    dashboard,
    page,
  }) => {
    // CI runners (2 vCPU GitHub Actions) with 2 Playwright workers can
    // saturate on cold-start navigation + hydration + deep-link effect chain
    // (refresh → router.refresh → RSC refetch). Triple the default 30s
    // budget so this test isn't bounded by Playwright's test-level timeout.
    test.slow();
    const owner = await seedUser({
      sub: "e2e-switcher-deeplink-owner-sub",
      email: "switcher-deeplink-owner@example.com",
      name: "Switcher Deep Link Owner",
      role: "member",
    });
    const grantee = await seedUser({
      sub: "e2e-switcher-deeplink-grantee-sub",
      email: "switcher-deeplink-grantee@example.com",
      name: "Switcher Deep Link Grantee",
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
    await page.goto(new URL(`/dashboard?as=${owner.userId}`, TestEnv.appBaseUrl).href, {
      waitUntil: "domcontentloaded",
    });
    await appShell.assert.appIsReady();
    await contextSwitcher.assert.switcherIsVisible();
    await contextSwitcher.assert.cookieEquals(owner.userId);
    await appShell.assert.isOnRoute(/\/dashboard$/);
    await contextSwitcher.assert.assertSwitchedIn("Switcher Deep Link Owner");
    await dashboard.assert.holdingsTableContains("2330");
  });
});
