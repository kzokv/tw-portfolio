import { test } from "@vakwen/test-e2e/fixtures/appPages";
import type { ShareCapability } from "@vakwen/shared-types";
import {
  seedResolvedShareFromAdmin,
  seedUser,
  switchIdentity,
  updateActiveShareCapabilities,
} from "./helpers/sharing";

const SHARING_MANAGE = "sharing:manage" as ShareCapability;

test.describe("shared portfolio nav and permissions", () => {
  test("[shared nav]: switched-in member without sharing grant hides sharing nav and keeps accounts read-only", async ({
    appShell,
    contextSwitcher,
    page,
    sharing,
  }) => {
    const owner = await seedUser({
      sub: "e2e-shared-nav-owner-sub",
      email: "shared-nav-owner@example.com",
      name: "Shared Nav Owner",
      role: "member",
    });
    const grantee = await seedUser({
      sub: "e2e-shared-nav-grantee-sub",
      email: "shared-nav-grantee@example.com",
      name: "Shared Nav Grantee",
      role: "member",
    });
    const { shareId } = await seedResolvedShareFromAdmin(grantee.email, owner.userId);

    await switchIdentity(page, { userId: grantee.userId, role: "member" });
    await sharing.actions.navigateToSharing();
    await appShell.assert.appIsReady();
    await sharing.actions.navigateToInboundShares();
    await page.getByTestId(`sharing-open-dashboard-${shareId}`).click();
    await appShell.assert.appIsReady();

    await contextSwitcher.assert.assertSwitchedIn("Shared Nav Owner");
    await page.getByTestId("app-sidebar-nav-sharing").waitFor({ state: "hidden" });

    await appShell.actions.navigateToRoute("/settings/accounts");
    await appShell.assert.appIsReady();
    const accountNameInput = page.getByTestId("account-create-name-input");
    await accountNameInput.waitFor({ state: "visible" });
    await appShell.assert.mxAssertEqual(
      await accountNameInput.isDisabled(),
      true,
      "account creation controls are read-only without account:manage",
    );
  });

  test("[shared sharing]: switched-in member with sharing:manage sees sharing UI but public-link controls stay owner-only", async ({
    appShell,
    contextSwitcher,
    page,
    sharing,
    testUser,
  }) => {
    const grantee = await seedUser({
      sub: "e2e-shared-sharing-grantee-sub",
      email: "shared-sharing-grantee@example.com",
      name: "Shared Sharing Grantee",
      role: "member",
    });
    const { shareId } = await seedResolvedShareFromAdmin(grantee.email, testUser.userId);
    await updateActiveShareCapabilities(shareId, testUser.userId, ["portfolio:mcp_read", SHARING_MANAGE]);

    await switchIdentity(page, { userId: grantee.userId, role: "member" });
    await sharing.actions.navigateToSharing();
    await appShell.assert.appIsReady();
    await sharing.actions.navigateToInboundShares();
    await page.getByTestId(`sharing-open-dashboard-${shareId}`).click();
    await appShell.assert.appIsReady();

    await contextSwitcher.assert.cookieEquals(testUser.userId);
    await contextSwitcher.assert.assertSwitchedIn(/Portfolio/);
    await page.getByTestId("shared-context-strip").waitFor({ state: "visible" });
    await page.getByTestId("app-sidebar-nav-sharing").waitFor({ state: "visible" });

    await appShell.actions.navigateToRoute("/sharing");
    await appShell.assert.appIsReady();
    await sharing.assert.pageIsVisible();
    await sharing.assert.grantButtonIsVisible();

    await page.getByTestId("sharing-delegated-note").waitFor({ state: "visible" });
    await appShell.assert.mxAssertEqual(
      await page.getByTestId("sharing-tab-anonymous").count(),
      0,
      "public-link tab is hidden in delegated sharing context",
    );
    await appShell.assert.mxAssertEqual(
      await page.getByTestId("sharing-public-links-create").count(),
      0,
      "public-link create control is hidden in delegated sharing context",
    );

    await page.getByTestId("shared-context-strip-exit").click();
    await appShell.assert.appIsReady();
    await contextSwitcher.assert.cookieEquals(null);
  });
});
