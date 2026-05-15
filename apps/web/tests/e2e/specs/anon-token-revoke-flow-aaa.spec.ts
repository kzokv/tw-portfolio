import { TestEnv } from "@vakwen/config/test";
import { test } from "@vakwen/test-e2e/fixtures/appPages";
import { seedSingleAnonymousShareToken } from "./helpers/anonymousShare.js";

test.describe("anonymous share links: revoke flow", () => {
  test("[anon token revoke]: revoke dialog confirm → row becomes revoked and public route 404s", async ({
    appShell,
    page,
    sharing,
    testUser,
  }) => {
    const token = await seedSingleAnonymousShareToken({
      ownerUserId: testUser.userId,
      expiresInDays: 30,
    });

    await sharing.actions.navigateToSharing();
    await appShell.assert.appIsReady();

    await sharing.assert.publicLinkRowVisible(token.id);
    await sharing.actions.clickRevokePublicLink(token.id);
    await sharing.actions.confirmRevoke();
    await sharing.assert.publicLinkRowStatus(token.id, "Revoked");

    await page.context().clearCookies();
    await page.goto(new URL(`/share/${token.token}`, TestEnv.appBaseUrl).href, {
      waitUntil: "domcontentloaded",
    });
    await sharing.assert.publicShareNotFoundIsVisible();
  });
});
