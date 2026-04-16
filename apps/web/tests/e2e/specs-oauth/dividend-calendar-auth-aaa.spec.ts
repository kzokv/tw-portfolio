import { test } from "@tw-portfolio/test-e2e/fixtures/oauthPages";
import { startInvitedOAuthAndGetState } from "@tw-portfolio/test-e2e/utils";

test.describe("dividend calendar auth", () => {
  test("dividends auth: unauthenticated visit → redirects to login with returnTo", async ({
    login,
    session,
  }) => {
    await session.actions.clearCookies();
    await session.actions.navigateToAppPath("/dividends");
    await login.assert.isOnLoginPage();
    await login.assert.googleSignInButtonHasHref(/returnTo=.*%2Fdividends/);
  });

  test("dividends auth: OAuth callback with returnTo /dividends → calendar loads", async ({
    dividends,
    session,
  }) => {
    await session.actions.clearCookies();
    const state = await startInvitedOAuthAndGetState(session, "e2e-user@example.com", "/dividends");
    await session.actions.navigateToOAuthCallback({
      code: "e2e-auth-code",
      state,
    });
    await dividends.assert.calendarLoaded();
  });
});
