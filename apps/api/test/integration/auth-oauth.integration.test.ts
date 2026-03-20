import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../src/app.js";
import type { GoogleOAuthConfig } from "../../src/auth/googleOAuth.js";
import { verifySessionCookie } from "../../src/auth/googleOAuth.js";
import { Env } from "@tw-portfolio/config";

const testOAuthConfig: GoogleOAuthConfig = {
  clientId: "test-client-id",
  clientSecret: "test-client-secret",
  redirectUri: "http://localhost:4000/auth/google/callback",
  sessionSecret: "test-session-secret-that-is-long-enough-32chars!!",
};

function makeBase64UrlPayload(claims: object): string {
  return Buffer.from(JSON.stringify(claims)).toString("base64url");
}

function makeMockIdToken(claims: object): string {
  return `eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.${makeBase64UrlPayload(claims)}.mock-signature`;
}

function makeFetchMock(status: number, body: object) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

const defaultIdTokenClaims = {
  sub: "google-sub-123",
  email: "test@example.com",
  email_verified: true,
  name: "Test User",
  picture: "https://lh3.googleusercontent.com/photo.jpg",
  iss: "https://accounts.google.com",
  aud: "test-client-id",
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 3600,
};

function makeTokenExchangeResponse(overrides: Partial<{ id_token: string; refresh_token: string }> = {}) {
  return {
    access_token: "mock-access-token",
    id_token: makeMockIdToken(defaultIdTokenClaims),
    refresh_token: "mock-refresh-token",
    expires_in: 3600,
    token_type: "Bearer",
    scope: "openid email profile",
    ...overrides,
  };
}

async function getValidState(app: Awaited<ReturnType<typeof buildApp>>): Promise<string> {
  const res = await app.inject({ method: "GET", url: "/auth/google/start" });
  const location = res.headers.location as string;
  return new URL(location).searchParams.get("state")!;
}

describe("auth - no OAuth config", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    app = await buildApp({ persistenceBackend: "memory", oauthConfig: null });
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it("GET /auth/google/start returns 503 when OAuth not configured", async () => {
    const res = await app.inject({ method: "GET", url: "/auth/google/start" });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe("oauth_not_configured");
  });

  it("GET /auth/google/callback returns 503 when OAuth not configured", async () => {
    const res = await app.inject({ method: "GET", url: "/auth/google/callback?code=abc&state=xyz" });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe("oauth_not_configured");
  });

  it("POST /auth/token/refresh returns 503 when OAuth not configured", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/token/refresh",
      payload: { refreshToken: "some-token" },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe("oauth_not_configured");
  });
});

describe("GET /auth/google/start", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    app = await buildApp({ persistenceBackend: "memory", oauthConfig: testOAuthConfig });
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it("returns 302 redirect to Google authorization endpoint", async () => {
    const res = await app.inject({ method: "GET", url: "/auth/google/start" });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBeDefined();
    expect(res.headers.location).toMatch(/^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth/);
  });

  it("redirect URL includes required OAuth parameters", async () => {
    const res = await app.inject({ method: "GET", url: "/auth/google/start" });
    const location = new URL(res.headers.location as string);

    expect(location.searchParams.get("client_id")).toBe("test-client-id");
    expect(location.searchParams.get("redirect_uri")).toBe("http://localhost:4000/auth/google/callback");
    expect(location.searchParams.get("response_type")).toBe("code");
    expect(location.searchParams.get("access_type")).toBe("offline");
    expect(location.searchParams.get("prompt")).toBe("select_account");
    const scope = location.searchParams.get("scope") ?? "";
    expect(scope).toContain("openid");
    expect(scope).toContain("email");
    expect(scope).toContain("profile");
  });

  it("redirect URL includes a non-empty state parameter", async () => {
    const res = await app.inject({ method: "GET", url: "/auth/google/start" });
    const location = new URL(res.headers.location as string);
    const state = location.searchParams.get("state");
    expect(state).toBeTruthy();
    expect(state!.includes(".")).toBe(true);
  });

  it("each call generates a unique state to prevent replay", async () => {
    const res1 = await app.inject({ method: "GET", url: "/auth/google/start" });
    const res2 = await app.inject({ method: "GET", url: "/auth/google/start" });
    const state1 = new URL(res1.headers.location as string).searchParams.get("state");
    const state2 = new URL(res2.headers.location as string).searchParams.get("state");
    expect(state1).not.toBe(state2);
  });
});

describe("GET /auth/google/callback", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    app = await buildApp({ persistenceBackend: "memory", oauthConfig: testOAuthConfig, appBaseUrl: "http://localhost:3000" });
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    if (app) await app.close();
  });

  it("redirects to /auth/error?reason=invalid_state when code is missing", async () => {
    const state = await getValidState(app);
    const res = await app.inject({ method: "GET", url: `/auth/google/callback?state=${state}` });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("http://localhost:3000/auth/error?reason=invalid_state");
  });

  it("redirects to /auth/error?reason=invalid_state when state is missing", async () => {
    const res = await app.inject({ method: "GET", url: "/auth/google/callback?code=auth-code" });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("http://localhost:3000/auth/error?reason=invalid_state");
  });

  it("redirects to /auth/error?reason=invalid_state when state is tampered with", async () => {
    const state = await getValidState(app);
    const tamperedState = `${state.split(".")[0]}.badhmacsignature`;
    const res = await app.inject({
      method: "GET",
      url: `/auth/google/callback?code=auth-code&state=${encodeURIComponent(tamperedState)}`,
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("http://localhost:3000/auth/error?reason=invalid_state");
  });

  it("redirects to /auth/error?reason=oauth_error when provider sends error query param", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/auth/google/callback?error=access_denied&state=irrelevant",
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("http://localhost:3000/auth/error?reason=oauth_error");
  });

  it(`sets ${Env.SESSION_COOKIE_NAME} cookie and redirects to app on successful code exchange (first-time signup flow)`, async () => {
    vi.stubGlobal("fetch", makeFetchMock(200, makeTokenExchangeResponse()));
    const state = await getValidState(app);

    const res = await app.inject({
      method: "GET",
      url: `/auth/google/callback?code=auth-code&state=${encodeURIComponent(state)}`,
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("http://localhost:3000/");
    const setCookie = res.headers["set-cookie"] as string;
    // Cookie now contains the internal UUID (not the Google sub)
    expect(setCookie).toContain(`${Env.SESSION_COOKIE_NAME}=`);
    expect(setCookie).not.toContain("google-sub-123");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Secure");

    // Extract cookie value and verify it contains a valid HMAC-signed UUID
    const cookieMatch = setCookie.match(new RegExp(`${Env.SESSION_COOKIE_NAME}=([^;]+)`));
    expect(cookieMatch).toBeTruthy();
    const cookieValue = cookieMatch![1];
    const verifiedUserId = verifySessionCookie(cookieValue, testOAuthConfig.sessionSecret);
    expect(verifiedUserId).toBeTruthy();
    expect(verifiedUserId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it(`sets ${Env.SESSION_COOKIE_NAME} cookie and redirects on returning user login flow`, async () => {
    vi.stubGlobal("fetch", makeFetchMock(200, makeTokenExchangeResponse()));
    const state = await getValidState(app);

    const res = await app.inject({
      method: "GET",
      url: `/auth/google/callback?code=auth-code&state=${encodeURIComponent(state)}`,
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers["set-cookie"] as string).toContain(`${Env.SESSION_COOKIE_NAME}=`);
  });

  it("calls Google token endpoint with correct form body", async () => {
    const mockFetch = makeFetchMock(200, makeTokenExchangeResponse());
    vi.stubGlobal("fetch", mockFetch);
    const state = await getValidState(app);

    await app.inject({
      method: "GET",
      url: `/auth/google/callback?code=test-auth-code&state=${encodeURIComponent(state)}`,
    });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://oauth2.googleapis.com/token");
    expect(options.method).toBe("POST");
    const sentBody = options.body as string;
    expect(sentBody).toContain("code=test-auth-code");
    expect(sentBody).toContain("client_id=test-client-id");
    expect(sentBody).toContain("grant_type=authorization_code");
  });

  it("redirects to /auth/error?reason=oauth_error when Google returns 400 on token exchange (invalid grant)", async () => {
    vi.stubGlobal("fetch", makeFetchMock(400, { error: "invalid_grant", error_description: "Code was already redeemed" }));
    const state = await getValidState(app);

    const res = await app.inject({
      method: "GET",
      url: `/auth/google/callback?code=expired-code&state=${encodeURIComponent(state)}`,
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("http://localhost:3000/auth/error?reason=oauth_error");
  });

  it("redirects to /auth/error?reason=server_error when Google returns 500 on token exchange", async () => {
    vi.stubGlobal("fetch", makeFetchMock(500, { error: "internal_error" }));
    const state = await getValidState(app);

    const res = await app.inject({
      method: "GET",
      url: `/auth/google/callback?code=some-code&state=${encodeURIComponent(state)}`,
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("http://localhost:3000/auth/error?reason=server_error");
  });

  it("redirects successfully even when refresh_token is absent (offline access not always granted)", async () => {
    const responseWithoutRefresh = makeTokenExchangeResponse();
    delete (responseWithoutRefresh as Record<string, unknown>).refresh_token;
    vi.stubGlobal("fetch", makeFetchMock(200, responseWithoutRefresh));
    const state = await getValidState(app);

    const res = await app.inject({
      method: "GET",
      url: `/auth/google/callback?code=auth-code&state=${encodeURIComponent(state)}`,
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers["set-cookie"] as string).toContain(`${Env.SESSION_COOKIE_NAME}=`);
  });

  it("redirects to /auth/error?reason=oauth_error when email_verified is false", async () => {
    const unverifiedClaims = { ...defaultIdTokenClaims, email_verified: false };
    vi.stubGlobal("fetch", makeFetchMock(200, makeTokenExchangeResponse({
      id_token: makeMockIdToken(unverifiedClaims),
    })));
    const state = await getValidState(app);

    const res = await app.inject({
      method: "GET",
      url: `/auth/google/callback?code=auth-code&state=${encodeURIComponent(state)}`,
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("http://localhost:3000/auth/error?reason=oauth_error");
  });

  it("redirects to /auth/error?reason=oauth_error when resolveOrCreateUser throws", async () => {
    vi.stubGlobal("fetch", makeFetchMock(200, makeTokenExchangeResponse()));
    const state = await getValidState(app);

    // Sabotage resolveOrCreateUser to throw
    const originalResolve = app.persistence.resolveOrCreateUser.bind(app.persistence);
    app.persistence.resolveOrCreateUser = async () => { throw new Error("simulated DB error"); };

    const res = await app.inject({
      method: "GET",
      url: `/auth/google/callback?code=auth-code&state=${encodeURIComponent(state)}`,
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("http://localhost:3000/auth/error?reason=oauth_error");

    // Restore
    app.persistence.resolveOrCreateUser = originalResolve;
  });
});

describe("POST /auth/token/refresh", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    app = await buildApp({ persistenceBackend: "memory", oauthConfig: testOAuthConfig });
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    if (app) await app.close();
  });

  it("exchanges refresh token and returns new access token", async () => {
    vi.stubGlobal("fetch", makeFetchMock(200, { access_token: "new-access-token", expires_in: 3600 }));

    const res = await app.inject({
      method: "POST",
      url: "/auth/token/refresh",
      payload: { refreshToken: "valid-refresh-token" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.accessToken).toBe("new-access-token");
    expect(body.expiresIn).toBe(3600);
  });

  it("calls Google token endpoint with refresh_token grant type", async () => {
    const mockFetch = makeFetchMock(200, { access_token: "new-token", expires_in: 3600 });
    vi.stubGlobal("fetch", mockFetch);

    await app.inject({
      method: "POST",
      url: "/auth/token/refresh",
      payload: { refreshToken: "my-refresh-token" },
    });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://oauth2.googleapis.com/token");
    const sentBody = options.body as string;
    expect(sentBody).toContain("grant_type=refresh_token");
    expect(sentBody).toContain("refresh_token=my-refresh-token");
    expect(sentBody).toContain("client_id=test-client-id");
  });

  it("returns 400 when refreshToken field is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/token/refresh",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when Google rejects the refresh token (expired/revoked)", async () => {
    vi.stubGlobal("fetch", makeFetchMock(400, { error: "invalid_grant", error_description: "Token has been expired or revoked" }));

    const res = await app.inject({
      method: "POST",
      url: "/auth/token/refresh",
      payload: { refreshToken: "revoked-token" },
    });

    expect(res.statusCode).toBe(400);
  });

  it("returns 502 when Google token endpoint is unavailable", async () => {
    vi.stubGlobal("fetch", makeFetchMock(503, { error: "service_unavailable" }));

    const res = await app.inject({
      method: "POST",
      url: "/auth/token/refresh",
      payload: { refreshToken: "some-token" },
    });

    expect(res.statusCode).toBe(502);
  });
});
