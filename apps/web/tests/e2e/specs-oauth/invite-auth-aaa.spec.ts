import { TestEnv } from "@vakwen/config/test";
import { test } from "@vakwen/test-e2e/fixtures/authPages";

test.describe("invite auth", () => {
  test("invite auth: unauthenticated valid invite → remains on invite page after hydration", async ({
    appShell,
    login,
    session,
  }) => {
    const adminSession = await session.actions.requestOAuthSession();
    const adminCookieValue = await session.arrange.extractSessionCookieValueFromHeader(
      adminSession.headers()["set-cookie"] ?? "",
    );
    await session.assert.valueIsTruthy(adminCookieValue, "admin session cookie value");

    const inviteResponse = await session.actions.requestInvite(
      "invite-hydration@example.com",
      "member",
      `${TestEnv.sessionCookieName}=${adminCookieValue}`,
    );
    await session.assert.responseStatusIs(inviteResponse, 201);
    const inviteBody = await inviteResponse.json() as { code: string };

    await session.actions.clearCookies();
    await session.actions.navigateToAppPath(`/invite/${inviteBody.code}`);

    await appShell.assert.isOnRoute(new RegExp(`/invite/${inviteBody.code}$`));
    await appShell.assert.pageContainsText("Accept your invite");
    await login.assert.googleSignInButtonIsVisible();
    await login.assert.googleSignInButtonHasHref(new RegExp(`/auth/google/start\\?invite_code=${inviteBody.code}`));
  });
});
