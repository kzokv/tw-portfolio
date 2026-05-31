import { test } from "@vakwen/test-e2e/fixtures/oauthPages";

test.describe("route redirects", () => {
  test("signed-in user at / is redirected to /dashboard", async ({ dashboard }) => {
    await dashboard.actions.navigateToDashboard();
    await dashboard.assert.isOnDashboard();
  });

  test("signed-in user at /dashboard loads dashboard", async ({ appShell }) => {
    await appShell.actions.navigateToRoute("/dashboard");
    await appShell.assert.appIsReady();
  });

  test("unauthenticated /transactions redirects to /login with returnTo", async ({ login, session }) => {
    await session.actions.clearCookies();
    await session.actions.navigateToAppPath("/transactions");
    await login.assert.isOnLoginPage();
    await login.assert.googleSignInButtonHasHref(/returnTo=.*%2Ftransactions/);
  });

  test("unauthenticated /portfolio redirects to /login with returnTo", async ({ login, session }) => {
    await session.actions.clearCookies();
    await session.actions.navigateToAppPath("/portfolio");
    await login.assert.isOnLoginPage();
    await login.assert.googleSignInButtonHasHref(/returnTo=.*%2Fportfolio/);
  });

  test("unauthenticated /login does not produce returnTo loop", async ({ login, session }) => {
    await session.actions.clearCookies();
    await login.actions.navigateToLogin();
    await login.assert.isOnLoginPage();
    await login.assert.googleSignInButtonIsVisible();
    await login.assert.googleSignInButtonHasHref(/^((?!returnTo).)*$/);
  });

  test("login page threads returnTo to sign-in button", async ({ login, session }) => {
    await session.actions.clearCookies();
    await login.actions.navigateToLoginWithQuery("?returnTo=/transactions");
    await login.assert.googleSignInButtonHasHref(/returnTo=.*%2Ftransactions/);
  });
});

test.describe("session expired", () => {
  test("session_expired error page renders correct content", async ({ authError, session }) => {
    await session.actions.clearCookies();
    await authError.actions.navigateToAuthError("session_expired");
    await authError.assert.pageContains("Your session has expired");
    await authError.assert.pageContains("Please sign in again to continue.");
  });

  test("session_expired page has sign-in-again link", async ({ authError, session }) => {
    await session.actions.clearCookies();
    await authError.actions.navigateToAuthError("session_expired");
    await authError.assert.tryAgainButtonIsVisible();
    await authError.assert.tryAgainButtonLinksTo("/login");
    await authError.assert.tryAgainButtonContains("Sign in again");
  });
});

test.describe("avatar dropdown menu", () => {
  test("avatar dropdown shows Settings and Sign out items", async ({ appShell }) => {
    await appShell.actions.navigateToRoute("/dashboard");
    await appShell.assert.appIsReady();
    await appShell.actions.openAvatarMenu();
    await appShell.assert.avatarMenuShowsSettingsAndSignOut();
  });

  test("clicking Sign out clears session and redirects to /login", async ({ appShell, login }) => {
    await appShell.actions.navigateToRoute("/dashboard");
    await appShell.assert.appIsReady();
    await appShell.actions.openAvatarMenu();
    await appShell.actions.clickAvatarMenuSignOut();
    await login.assert.isOnLoginPage();
  });

  test("after sign-out, /dashboard redirects to /login", async ({ login, session }) => {
    await session.actions.logoutViaApi();
    await login.assert.isOnLoginPage();

    await session.actions.navigateToAppPath("/dashboard");
    await login.assert.isOnLoginPage();
  });
});

test.describe("returnTo roundtrip", () => {
  test("full returnTo roundtrip through OAuth", async ({ appShell, login, session }) => {
    await session.actions.clearCookies();
    await session.actions.navigateToAppPath("/transactions");
    await login.assert.isOnLoginPage();
    await login.assert.googleSignInButtonHasHref(/returnTo=.*%2Ftransactions/);

    const startResponse = await session.actions.requestOAuthStart("/transactions");
    const state = await session.arrange.oauthState(startResponse);
    await session.assert.valueIsTruthy(state, "oauth state");

    const callbackResponse = await session.actions.requestOAuthCallback({
      code: "e2e-auth-code",
      state,
    });
    await session.assert.responseStatusIs(callbackResponse, 302);
    await session.assert.redirectLocationContains(callbackResponse, "/transactions");

    const cookieValue = await session.arrange.extractSessionCookieValueFromHeader(
      callbackResponse.headers()["set-cookie"] ?? "",
    );
    await session.assert.valueIsTruthy(cookieValue, "oauth callback session cookie");

    await session.actions.plantSessionCookie(cookieValue ?? "");
    await session.actions.navigateToAppPath("/transactions");
    await appShell.assert.isOnRoute(/\/transactions/);
  });
});
