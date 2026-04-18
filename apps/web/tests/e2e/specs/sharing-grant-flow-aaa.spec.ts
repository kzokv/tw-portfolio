import { test } from "@tw-portfolio/test-e2e/fixtures/appPages";
import { seedUser } from "./helpers/sharing";

test.describe("sharing grant flow", () => {
  test("[sharing grant]: known user email → submit → outbound row + success flash", async ({
    appShell,
    sharing,
  }) => {
    const grantee = await seedUser({
      sub: "e2e-grant-flow-grantee-sub",
      email: "grant-flow-grantee@example.com",
      name: "Grant Flow Grantee",
      role: "member",
    });

    await sharing.actions.navigateToSharing();
    await appShell.assert.appIsReady();

    await sharing.actions.openGrantDialog();
    await sharing.actions.enterGrantEmail(grantee.email);
    await sharing.actions.clickGrantContinue();
    await sharing.assert.grantConfirmIsVisible();
    await sharing.actions.clickGrantConfirm();

    await sharing.assert.grantDialogIsHidden();
    await sharing.assert.flashSuccessContains("grant-flow-grantee@example.com");
  });
});
