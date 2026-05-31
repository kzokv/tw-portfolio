import { test } from "@vakwen/test-e2e/fixtures/appPages";
import { seedAnonymousShareTokens } from "./helpers/anonymousShare.js";

test.describe("anonymous share links: cap error state", () => {
  test("[anon token cap]: owner at 20 active links opens sharing → amber banner shows and create button is disabled", async ({
    appShell,
    sharing,
    testUser,
  }) => {
    await seedAnonymousShareTokens({
      ownerUserId: testUser.userId,
      count: 20,
      expiresInDays: 30,
    });

    await sharing.actions.navigateToPublicLinks();
    await appShell.assert.appIsReady();

    await sharing.assert.capBannerIsVisible();
    await sharing.assert.createPublicLinkButtonIsDisabled();
  });
});
