import { test } from "@tw-portfolio/test-e2e/fixtures/appPages";
import { seedResolvedShareFromAdmin, seedUser } from "./helpers/sharing";

test.describe("sharing revoke + notification", () => {
  test("[sharing revoke]: owner revokes active share → row disappears + grantee notification persisted", async ({
    appShell,
    sharing,
    testUser,
  }) => {
    const grantee = await seedUser({
      sub: "e2e-revoke-grantee-sub",
      email: "revoke-grantee@example.com",
      name: "Revoke Grantee",
      role: "viewer",
    });
    // Seed the share FROM the test user so it appears in their outbound list
    // when the UI navigates to /sharing (dev_bypass test user != "user-1").
    const { shareId } = await seedResolvedShareFromAdmin(grantee.email, testUser.userId);

    await sharing.actions.navigateToSharing();
    await appShell.assert.appIsReady();
    await sharing.assert.outboundRowVisibleWithEmail(shareId, grantee.email);

    await sharing.actions.clickRevokeOnRow(shareId);
    await sharing.actions.confirmRevoke();
    await sharing.assert.outboundRowHidden(shareId);

    await sharing.assert.granteeReceivedNotification(grantee.userId, "Portfolio access revoked");
  });
});
