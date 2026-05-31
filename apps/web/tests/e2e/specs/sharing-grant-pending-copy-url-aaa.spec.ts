import { test } from "@vakwen/test-e2e/fixtures/appPages";

test.describe("sharing grant pending copy URL", () => {
  test("[sharing grant]: unknown email → confirmation → copy-URL modal renders invite URL", async ({
    appShell,
    sharing,
  }) => {
    const pendingEmail = "unregistered-grantee@example.com";

    await sharing.actions.navigateToSharing();
    await appShell.assert.appIsReady();

    await sharing.actions.openGrantDialog();
    await sharing.actions.enterGrantEmail(pendingEmail);
    await sharing.actions.clickGrantContinue();
    await sharing.assert.grantConfirmIsVisible();
    await sharing.actions.clickGrantConfirm();

    // Success step of the dialog displays the copyable invite URL.
    await sharing.assert.grantInviteUrlIsVisible();
    await sharing.assert.grantInviteUrlContains("/invite/");
  });
});
