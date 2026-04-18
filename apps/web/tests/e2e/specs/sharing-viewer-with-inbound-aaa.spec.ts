import { test } from "@tw-portfolio/test-e2e/fixtures/appPages";
import { seedResolvedShareFromAdmin, seedUser, switchIdentity } from "./helpers/sharing";

test.describe("sharing viewer with inbound", () => {
  test("[sharing viewer]: viewer with one inbound share → inbound card visible, no outbound", async ({
    appShell,
    page,
    sharing,
  }) => {
    const viewer = await seedUser({
      sub: "e2e-viewer-inbound-sub",
      email: "viewer-inbound@example.com",
      name: "Viewer Inbound",
      role: "viewer",
    });

    // Default dev_bypass admin (user-1) grants a share to the viewer.
    const { shareId } = await seedResolvedShareFromAdmin(viewer.email);

    // Swap into the viewer's identity.
    await switchIdentity(page, { userId: viewer.userId, role: "viewer" });

    await sharing.actions.navigateToSharing();
    await appShell.assert.appIsReady();

    await sharing.assert.pageIsVisible();
    await sharing.assert.outboundSectionIsHidden();
    await sharing.assert.inboundSectionIsVisible();
    await sharing.assert.inboundCardVisible(shareId);
  });
});
