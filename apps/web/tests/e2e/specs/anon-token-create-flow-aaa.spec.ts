import { test } from "@vakwen/test-e2e/fixtures/appPages";

test.describe("anonymous share links: create flow", () => {
  test("[anon token create]: sharing section C create 30d link → row renders with copy button", async ({
    appShell,
    sharing,
  }) => {
    await sharing.actions.navigateToPublicLinks();
    await appShell.assert.appIsReady();
    await sharing.assert.publicLinksSectionIsVisible();
    await sharing.assert.createPublicLinkButtonIsEnabled();

    await sharing.actions.openCreatePublicLinkDialog();
    await sharing.assert.createPublicLinkDialogIsVisible();
    await sharing.actions.selectPublicLinkExpiry("30");
    await sharing.actions.confirmCreatePublicLink();

    await sharing.assert.firstPublicLinkRowIsVisible();
    await sharing.assert.firstPublicLinkRowHasCopyButton();
    await sharing.assert.firstPublicLinkRowHasNewBadge();
  });
});
