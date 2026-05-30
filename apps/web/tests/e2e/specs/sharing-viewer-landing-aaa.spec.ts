import { test } from "@vakwen/test-e2e/fixtures/appPages";
import { seedUser, switchIdentity } from "./helpers/sharing";

test.describe("sharing viewer landing", () => {
  test("[sharing viewer]: viewer with no inbound → outbound hidden, inbound empty-state visible", async ({
    appShell,
    page,
    sharing,
  }) => {
    const viewer = await seedUser({
      sub: "e2e-viewer-landing-sub",
      email: "viewer-landing@example.com",
      name: "Viewer Landing",
      role: "viewer",
    });

    await switchIdentity(page, { userId: viewer.userId, role: "viewer" });

    await sharing.actions.navigateToSharing();
    await appShell.assert.appIsReady();

    await sharing.assert.pageIsVisible();
    await sharing.assert.roleNoteIsVisible();
    await sharing.assert.grantButtonIsHidden();
    await sharing.assert.outboundSectionIsHidden();
    await sharing.assert.inboundSectionIsVisible();
    await sharing.assert.inboundEmptyIsVisible();
  });
});
