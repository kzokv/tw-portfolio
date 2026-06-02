import type { APIResponse } from "@playwright/test";
import type { TSessionAssistant } from "@vakwen/test-e2e/assistants";
import { test } from "@vakwen/test-e2e/fixtures/authPages";
import {
  apiUrl,
  makeDeterministicIdToken,
  startInvitedOAuthAndGetState,
  startOAuthAndGetState,
  startOAuthAndGetTamperedState,
} from "@vakwen/test-e2e/utils";
import { TestEnv } from "@vakwen/config/test";

const sessionCookieRequiresSecure = TestEnv.sessionCookieName.startsWith("__Host-");
const firstSigninEmail = "e2e-user@example.com";
const existingUserIdToken = makeDeterministicIdToken({
  sub: "e2e-google-sub-001",
  email: "e2e-user@example.com",
  name: "E2E Test User",
});

async function assertSecureCookieAttribute(
  session: TSessionAssistant,
  response: APIResponse,
): Promise<void> {
  if (sessionCookieRequiresSecure) {
    await session.assert.responseHeaderContains(response, "set-cookie", "; Secure");
    return;
  }

  await session.assert.valueNotIncludes(
    response.headers()["set-cookie"],
    "; Secure",
    "set-cookie header",
  );
}

async function ensureExistingOAuthUser(session: TSessionAssistant): Promise<void> {
  const response = await session.actions.requestOAuthSession(existingUserIdToken);
  await session.assert.responseStatusIs(response, 200);
}

test.describe("login page", () => {
  test("renders with sign-in button visible", async ({ login }) => {
    await login.actions.navigateToLogin();
    await login.assert.googleSignInButtonIsVisible();
  });

  test("sign-in button links to OAuth start", async ({ login }) => {
    await login.actions.navigateToLogin();
    await login.assert.googleSignInButtonHasHref("/auth/google/start");
  });

  test("clicking sign-in button redirects browser to Google OAuth", async ({ login, session }) => {
    await login.actions.navigateToLogin();
    const navigatedUrl = await login.actions.clickGoogleSignInAndCaptureStartNavigation();
    await session.assert.valueMatches(navigatedUrl, /\/auth\/google\/start/, "captured oauth start url");
  });
});

test.describe("GET /auth/google/start", () => {
  test("redirects to Google authorization endpoint", async ({ session }) => {
    const response = await session.actions.requestOAuthStart();
    await session.assert.responseStatusIs(response, 302);
    await session.assert.redirectLocationMatches(response, /accounts\.google\.com/);
  });

  test("redirect URL includes required OAuth parameters with prompt=select_account", async ({ session }) => {
    const response = await session.actions.requestOAuthStart();
    const location = await session.arrange.oauthRedirectLocation(response);
    const redirectUrl = new URL(location);

    await session.assert.valueEquals(
      redirectUrl.searchParams.get("client_id"),
      "e2e-test-client-id",
      "oauth client_id",
    );
    await session.assert.valueEquals(
      redirectUrl.searchParams.get("response_type"),
      "code",
      "oauth response_type",
    );
    await session.assert.valueEquals(
      redirectUrl.searchParams.get("prompt"),
      "select_account",
      "oauth prompt",
    );
  });

  test("each call generates a unique state to prevent replay", async ({ session }) => {
    const response1 = await session.actions.requestOAuthStart();
    const response2 = await session.actions.requestOAuthStart();
    const state1 = await session.arrange.oauthState(response1);
    const state2 = await session.arrange.oauthState(response2);

    await session.assert.valueIsTruthy(state1, "first oauth state");
    await session.assert.valueIsTruthy(state2, "second oauth state");
    await session.assert.valuesDiffer(state1, state2, "oauth state values");
  });
});

test.describe("GET /auth/google/callback", () => {
  test(`signup flow sets ${TestEnv.sessionCookieName} cookie and redirects to app`, async ({ session }) => {
    const state = await startInvitedOAuthAndGetState(session, firstSigninEmail);
    const response = await session.actions.requestOAuthCallback({
      code: "e2e-auth-code",
      state,
    });

    await session.assert.responseStatusIs(response, 302);
    await session.assert.responseHeaderContains(response, "set-cookie", `${TestEnv.sessionCookieName}=`);
    await session.assert.responseHeaderContains(response, "set-cookie", "HttpOnly");
  });

  test(`login flow sets ${TestEnv.sessionCookieName} cookie and redirects (same as signup)`, async ({ session }) => {
    await ensureExistingOAuthUser(session);
    const state = await startOAuthAndGetState(session);
    const response = await session.actions.requestOAuthCallback({
      code: "e2e-auth-code",
      state,
    });

    await session.assert.responseStatusIs(response, 302);
    await session.assert.responseHeaderContains(response, "set-cookie", `${TestEnv.sessionCookieName}=`);
  });

  test("missing state redirects to /auth/error?reason=invalid_state", async ({ session }) => {
    const response = await session.actions.requestOAuthCallback({ code: "e2e-auth-code" });
    await session.assert.responseStatusIs(response, 302);
    await session.assert.redirectLocationContains(response, "/auth/error?reason=invalid_state");
  });

  test("tampered state redirects to /auth/error?reason=invalid_state", async ({ session }) => {
    const tampered = await startOAuthAndGetTamperedState(session);
    const response = await session.actions.requestOAuthCallback({
      code: "e2e-auth-code",
      state: tampered,
    });

    await session.assert.responseStatusIs(response, 302);
    await session.assert.redirectLocationContains(response, "/auth/error?reason=invalid_state");
  });

  test("provider error param redirects to /auth/error?reason=oauth_error", async ({ session }) => {
    const response = await session.actions.requestOAuthCallback({
      error: "access_denied",
      state: "irrelevant",
    });
    await session.assert.responseStatusIs(response, 302);
    await session.assert.redirectLocationContains(response, "/auth/error?reason=oauth_error");
  });
});

test.describe("POST /auth/token/refresh", () => {
  test("exchanges refresh token and returns new access token", async ({ session }) => {
    const response = await session.actions.requestRefreshToken("mock-e2e-refresh-token");
    const body = await response.json();

    await session.assert.responseStatusIs(response, 200);
    await session.assert.valueIsDefined(body.accessToken, "refresh access token");
    await session.assert.valueIsDefined(body.expiresIn, "refresh expiresIn");
  });

  test("missing refreshToken field returns 400", async ({ session }) => {
    const response = await session.actions.requestRefreshToken();
    await session.assert.responseStatusIs(response, 400);
  });

  test("refresh endpoint is accessible without session cookie", async ({ session }) => {
    const response = await session.actions.requestRefreshToken("mock-e2e-refresh-token");
    const body = await response.json();

    await session.assert.responseStatusIs(response, 200);
    await session.assert.valueIsDefined(body.accessToken, "cookie-less refresh access token");
    await session.assert.valueIsDefined(body.expiresIn, "cookie-less refresh expiresIn");
  });
});

test.describe("401 session expiry", () => {
  test("API 401 response redirects browser to /login without error banner", async ({ login, session }) => {
    await session.actions.stubDashboardEnrichmentUnauthorized();
    await session.actions.navigateToAppPath("/");
    await login.assert.isOnLoginPage();
    await session.assert.noGlobalErrorBanner();
  });

  test("401 on dashboard enrichment API redirects root page to /login", async ({ login, session }) => {
    await session.actions.stubDashboardEnrichmentUnauthorized();
    await session.actions.navigateToAppPath("/");
    await login.assert.isOnLoginPage();
  });
});

test.describe("x-authenticated-user-id header trust", () => {
  test("x-authenticated-user-id header alone does not grant access without session cookie", async ({ request, session }) => {
    const response = await request.get(apiUrl("/settings"), {
      headers: { "x-authenticated-user-id": "attacker-sub" },
    });
    const body = await response.json();

    await session.assert.responseStatusIs(response, 200);
    await session.assert.valuesDiffer(body.userId, "attacker-sub", "resolved userId");
  });
});

test.describe("full browser OAuth flow", () => {
  test(`OAuth callback sets ${TestEnv.sessionCookieName} cookie and redirects browser to /dashboard`, async ({
    dashboard,
    session,
  }) => {
    await ensureExistingOAuthUser(session);
    const state = await startOAuthAndGetState(session);

    await session.actions.navigateToOAuthCallback({
      code: "e2e-auth-code",
      state,
    });
    await dashboard.assert.isOnDashboard();

    const cookie = await session.arrange.currentSessionCookie();
    await session.assert.currentSessionCookieIsHttpOnly(cookie);
  });
});

test.describe("cookie security attributes", () => {
  test(`${TestEnv.sessionCookieName} cookie has correct security attributes`, async ({ session }) => {
    await ensureExistingOAuthUser(session);
    const state = await startOAuthAndGetState(session);
    const response = await session.actions.requestOAuthCallback({
      code: "e2e-auth-code",
      state,
    });

    await session.assert.responseStatusIs(response, 302);
    await session.assert.responseHeaderContains(response, "set-cookie", `${TestEnv.sessionCookieName}=`);
    await session.assert.responseHeaderContains(response, "set-cookie", "HttpOnly");
    await session.assert.responseHeaderContains(response, "set-cookie", "SameSite=Lax");
    await assertSecureCookieAttribute(session, response);
  });
});

test.describe("authorization code replay", () => {
  test("replayed authorization code with new state", async ({ session }) => {
    await ensureExistingOAuthUser(session);
    const firstState = await startOAuthAndGetState(session);
    const firstUse = await session.actions.requestOAuthCallback({
      code: "e2e-auth-code",
      state: firstState,
    });

    await session.assert.responseStatusIs(firstUse, 302);
    await session.assert.responseHeaderContains(firstUse, "set-cookie", `${TestEnv.sessionCookieName}=`);

    const replayState = await startOAuthAndGetState(session);
    const replay = await session.actions.requestOAuthCallback({
      code: "e2e-auth-code",
      state: replayState,
    });

    await session.assert.responseStatusIs(replay, 302);
    await session.assert.responseHeaderContains(replay, "set-cookie", `${TestEnv.sessionCookieName}=`);
  });
});

test.describe("callback error page (browser)", () => {
  test("missing state lands on /auth/error with invalid_state reason", async ({ authError, session }) => {
    await session.actions.navigateToOAuthCallback({ code: "e2e-auth-code" });
    await authError.assert.isOnAuthErrorPage("invalid_state");
  });

  test("tampered state lands on /auth/error with invalid_state reason", async ({ authError, session }) => {
    const tampered = await startOAuthAndGetTamperedState(session);

    await session.actions.navigateToOAuthCallback({
      code: "e2e-auth-code",
      state: tampered,
    });
    await authError.assert.isOnAuthErrorPage("invalid_state");
  });

  test("provider error param lands on /auth/error with oauth_error reason", async ({ authError, session }) => {
    await session.actions.navigateToOAuthCallback({
      error: "access_denied",
      state: "irrelevant",
    });
    await authError.assert.isOnAuthErrorPage("oauth_error");
  });

  test("error page renders try-again link to /login", async ({ authError, session }) => {
    await session.actions.navigateToAppPath("/auth/error?reason=oauth_error");
    await authError.assert.tryAgainButtonIsVisible();
    await authError.assert.tryAgainButtonLinksTo("/login");
  });
});

test.describe("returnTo in OAuth state", () => {
  test("start with returnTo generates 3-part state", async ({ session }) => {
    const response = await session.actions.requestOAuthStart("/transactions");
    const state = await session.arrange.oauthState(response);
    await session.assert.stateHasSegmentCount(state, 3);
  });

  test("callback with 3-part state redirects to returnTo destination", async ({ session }) => {
    await ensureExistingOAuthUser(session);
    const state = await startOAuthAndGetState(session, "/transactions");
    const response = await session.actions.requestOAuthCallback({
      code: "e2e-auth-code",
      state,
    });

    await session.assert.responseStatusIs(response, 302);
    await session.assert.redirectLocationContains(response, "/transactions");
  });

  test("absolute URL returnTo is rejected and redirects to /dashboard", async ({ session }) => {
    await ensureExistingOAuthUser(session);
    const state = await session.arrange.oauthState(
      await session.actions.requestOAuthStart("https://evil.com"),
    );
    await session.assert.stateHasSegmentCount(state, 2);

    const response = await session.actions.requestOAuthCallback({
      code: "e2e-auth-code",
      state,
    });
    await session.assert.responseStatusIs(response, 302);
    await session.assert.redirectLocationContains(response, "/dashboard");
  });

  test("scheme-relative returnTo is rejected and redirects to /dashboard", async ({ session }) => {
    await ensureExistingOAuthUser(session);
    const state = await session.arrange.oauthState(
      await session.actions.requestOAuthStart("//evil.com"),
    );
    await session.assert.stateHasSegmentCount(state, 2);

    const response = await session.actions.requestOAuthCallback({
      code: "e2e-auth-code",
      state,
    });
    await session.assert.responseStatusIs(response, 302);
    await session.assert.redirectLocationContains(response, "/dashboard");
  });
});
