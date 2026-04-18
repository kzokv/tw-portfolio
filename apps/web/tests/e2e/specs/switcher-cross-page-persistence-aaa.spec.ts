import { TestEnv } from "@tw-portfolio/config/test";
import { test } from "@tw-portfolio/test-e2e/fixtures/appPages";
import {
  seedResolvedShareFromAdmin,
  seedTransactionForUser,
  seedUser,
  switchIdentity,
} from "./helpers/sharing";

test.describe("portfolio switcher cross-page persistence", () => {
  test("[switcher persistence]: selected owner persists across dashboard → portfolio → transactions", async ({
    appShell,
    contextSwitcher,
    dashboard,
    page,
    portfolio,
    transactions,
  }) => {
    const owner = await seedUser({
      sub: "e2e-switcher-persist-owner-sub",
      email: "switcher-persist-owner@example.com",
      name: "Switcher Persist Owner",
      role: "member",
    });
    const grantee = await seedUser({
      sub: "e2e-switcher-persist-grantee-sub",
      email: "switcher-persist-grantee@example.com",
      name: "Switcher Persist Grantee",
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

    const dashboardRefresh = page.waitForResponse(
      (response) =>
        response.request().method() === "GET"
        && response.url().includes("/dashboard/overview")
        && response.ok(),
    );
    await contextSwitcher.actions.selectOwner(owner.userId);
    await dashboardRefresh;

    await contextSwitcher.assert.cookieEquals(owner.userId);
    await dashboard.assert.holdingsTableContains("2330");

    await page.goto(new URL("/portfolio", TestEnv.appBaseUrl).href, { waitUntil: "domcontentloaded" });
    await appShell.assert.appIsReady();
    await contextSwitcher.assert.cookieEquals(owner.userId);
    await contextSwitcher.assert.assertSwitchedIn("Switcher Persist Owner");
    await portfolio.assert.holdingsTableContains("2330");

    await page.goto(new URL("/transactions", TestEnv.appBaseUrl).href, { waitUntil: "domcontentloaded" });
    await appShell.assert.appIsReady();
    await contextSwitcher.assert.cookieEquals(owner.userId);
    await contextSwitcher.assert.assertSwitchedIn("Switcher Persist Owner");
    await transactions.assert.recentTransactionsTableIsVisible();
    await transactions.assert.recentTransactionTickerIsVisible("2330");
    await transactions.assert.readOnlyMessageIsVisible();
  });
});
