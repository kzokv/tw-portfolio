import { test } from "@vakwen/test-e2e/fixtures/appPages";

test.describe("sharing page", () => {
  test("[sharing page]: avatar menu shows sharing link → /sharing renders tabbed sections", async ({ appShell, page }) => {
    await appShell.actions.navigateToRoute("/dashboard");
    await appShell.assert.appIsReady();

    await appShell.actions.openAvatarMenu();
    await appShell.assert.avatarMenuSharingLinkIsVisible();
    await appShell.actions.clickAvatarMenuSharing();

    await appShell.assert.sharingPageIsVisible();
    await appShell.assert.sharingGrantButtonIsVisible();
    await appShell.assert.sharingTabsAreVisible();
    await appShell.assert.sharingOutboundSectionIsVisible();

    await page.getByTestId("sharing-tab-inbound").click();
    await appShell.assert.sharingInboundSectionIsVisible();

    await page.getByTestId("sharing-tab-anonymous").click();
    await appShell.assert.sharingPublicLinksSectionIsVisible();
  });

  test("[sharing page]: grant button opens dialog → email entry step visible", async ({ appShell }) => {
    await appShell.actions.navigateToRoute("/sharing");
    await appShell.assert.appIsReady();

    await appShell.actions.clickSharingGrantButton();

    await appShell.assert.sharingGrantDialogIsVisible();
    await appShell.assert.sharingGrantEmailInputIsVisible();
  });
});
