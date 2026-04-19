import { TestEnv } from "@tw-portfolio/config/test";
import { test } from "@tw-portfolio/test-e2e/fixtures/oauthPages";
import { makeDeterministicIdToken } from "@tw-portfolio/test-e2e/utils";

function apiPath(path: string): string {
  return new URL(path, TestEnv.apiBaseUrl).href;
}

test.describe("admin impersonation", () => {
  test("[admin impersonation]: start from users page → banner persists across routes → profile write is blocked → exit returns to users", async ({
    appShell,
    page,
    request,
    session,
    settings,
  }) => {
    const uniqueId = Date.now();
    const targetEmail = `impersonation-target-${uniqueId}@example.com`;
    const targetResponse = await request.post(apiPath("/__e2e/oauth-session?role=member"), {
      data: {
        id_token: makeDeterministicIdToken({
          sub: `impersonation-target-sub-${uniqueId}`,
          email: targetEmail,
          name: "OAuth Impersonation Target",
        }),
      },
    });
    await session.assert.responseStatusIs(targetResponse, 200);
    const targetBody = await targetResponse.json() as { userId: string };

    await appShell.actions.navigateToRoute("/admin/users");
    await appShell.assert.adminUsersPageIsVisible();

    const impersonateButton = page.getByTestId(`impersonate-btn-${targetBody.userId}`);
    await appShell.assert.mxAssertTruthy(await impersonateButton.isVisible(), "impersonate button visible");
    await impersonateButton.click();

    await appShell.assert.impersonationBannerContains(targetEmail);
    await appShell.assert.impersonationCountdownIsVisible();

    await appShell.actions.navigateToRoute("/portfolio");
    await appShell.assert.appIsReady();
    await appShell.assert.impersonationBannerContains(targetEmail);

    await appShell.actions.openSettingsDrawer();
    await settings.actions.openProfileTab();
    await settings.actions.clearProfileEmail();
    await settings.actions.fillProfileEmail(`blocked-${uniqueId}@example.com`);

    const saveResponse = await settings.actions.saveProfileEmail();
    await session.assert.responseStatusIs(saveResponse, 403);
    await appShell.assert.clientApiErrorToastContains(
      /Writes are disabled while impersonating/i,
    );

    await settings.actions.closeWithEscape();
    await settings.assert.drawerIsClosed();
    await page.getByTestId("exit-impersonation-button").click();
    await appShell.assert.isOnRoute(/\/admin\/users$/);
    await appShell.assert.impersonationBannerIsHidden();
  });
});
