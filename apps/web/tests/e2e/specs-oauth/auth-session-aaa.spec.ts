import { test } from "@tw-portfolio/test-e2e/fixtures/oauthPages";

test.describe("authenticated session", () => {
  test("dashboard loads at /dashboard after root redirect", async ({ dashboard }) => {
    await dashboard.actions.navigateToDashboard();
    await dashboard.assert.isOnDashboard();
    await dashboard.assert.appIsReady();
  });

  test("login page is accessible when already authenticated", async ({ login }) => {
    await login.actions.navigateToLogin();
    await login.assert.googleSignInButtonIsVisible();
  });

  test("logout clears session and redirects to /login", async ({ dashboard, login, session }) => {
    await dashboard.actions.navigateToDashboard();
    await dashboard.assert.isOnDashboard();

    await session.actions.logoutViaApi();
    await login.assert.isOnLoginPage();

    await session.actions.navigateToAppPath("/");
    await login.assert.isOnLoginPage();
  });
});

test.describe("HMAC session cookie integrity", () => {
  test("tampered HMAC session cookie redirects to /auth/error?reason=session_expired", async ({ authError, session }) => {
    const validValue = await session.arrange.currentSessionCookieValue();
    await session.assert.valueIsDefined(validValue, "current session cookie value");
    await session.assert.valueMatches(validValue, /\./, "signed session cookie value");
    const tamperedValue = await session.arrange.tamperSignedValue(validValue ?? "");

    await session.actions.clearCookies();
    await session.actions.plantSessionCookie(tamperedValue);

    await session.actions.navigateToAppPath("/");
    await authError.assert.isOnAuthErrorPage("session_expired");
  });

  test("plain sub without HMAC (old format) redirects to /auth/error?reason=session_expired", async ({ authError, session }) => {
    await session.actions.clearCookies();
    await session.actions.plantSessionCookie("google-sub-001");

    await session.actions.navigateToAppPath("/");
    await authError.assert.isOnAuthErrorPage("session_expired");
  });
});

test.describe("/__e2e/oauth-session endpoint", () => {
  test("creates a working browser session", async ({ dashboard, session }) => {
    await session.actions.clearCookies();

    const response = await session.actions.requestOAuthSession();
    await session.assert.responseStatusIs(response, 200);

    const cookieValue = await session.arrange.extractSessionCookieValueFromHeader(
      response.headers()["set-cookie"] ?? "",
    );
    await session.assert.valueIsTruthy(cookieValue, "oauth session cookie value");

    await session.actions.plantSessionCookie(cookieValue ?? "");
    await dashboard.actions.navigateToDashboard();
    await dashboard.assert.isOnDashboard();
    await dashboard.assert.appIsReady();
  });
});

test.describe("stateless session re-use after logout", () => {
  test("re-planted pre-logout cookie still grants access (stateless HMAC — no server-side revocation)", async ({ dashboard, login, session }) => {
    await dashboard.actions.navigateToDashboard();
    await dashboard.assert.isOnDashboard();

    const savedCookieValue = await session.arrange.currentSessionCookieValue();
    await session.assert.valueIsDefined(savedCookieValue, "saved session cookie value");

    await session.actions.logoutViaApi();
    await login.assert.isOnLoginPage();

    await session.actions.plantSessionCookie(savedCookieValue ?? "");
    await dashboard.actions.navigateToDashboard();
    await dashboard.assert.isOnDashboard();
  });
});

test.describe("unknown sub handling", () => {
  test("valid HMAC signature but unknown sub does not crash the app", async ({ dashboard, session }) => {
    const unknownSub = "unknown-sub-999";
    const payload = Buffer.from(
      JSON.stringify({
        sub: unknownSub,
        email: "unknown@example.com",
        email_verified: true,
        name: "Unknown User",
        iss: "https://accounts.google.com",
        aud: "e2e-test-client-id",
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    ).toString("base64url");
    const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
    const fakeIdToken = `${header}.${payload}.mock-sig`;

    const response = await session.actions.requestOAuthSession(fakeIdToken);
    await session.assert.responseStatusIs(response, 200);

    const cookieValue = await session.arrange.extractSessionCookieValueFromHeader(
      response.headers()["set-cookie"] ?? "",
    );
    await session.assert.valueIsTruthy(cookieValue, "oauth session cookie value");

    await session.actions.clearCookies();
    await session.actions.plantSessionCookie(cookieValue ?? "");
    await dashboard.actions.navigateToDashboard();
    await session.assert.noGlobalErrorBanner();
  });
});

test.describe("route protection", () => {
  test("unauthenticated visit to / redirects to /login", async ({ login, session }) => {
    await session.actions.clearCookies();
    await session.actions.navigateToAppPath("/");
    await login.assert.isOnLoginPage();
  });

  test("unauthenticated visit to /login renders login page without redirect", async ({ login, session }) => {
    await session.actions.clearCookies();
    await login.actions.navigateToLogin();
    await login.assert.isOnLoginPage();
    await login.assert.googleSignInButtonIsVisible();
  });

  test("unauthenticated visit to /auth/error renders error page without redirect", async ({ authError, session }) => {
    await session.actions.clearCookies();
    await authError.actions.navigateToAuthError("server_error");
    await authError.assert.isOnAuthErrorPage("server_error");
    await authError.assert.tryAgainButtonIsVisible();
  });
});
