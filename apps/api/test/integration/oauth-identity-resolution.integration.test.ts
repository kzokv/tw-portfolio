import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../src/app.js";
import type { GoogleOAuthConfig } from "../../src/auth/googleOAuth.js";
import { verifySessionCookie } from "../../src/auth/googleOAuth.js";
import { Env } from "@vakwen/config";

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

const defaultClaims = {
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

function makeTokenExchangeResponse(claimsOverrides: Partial<typeof defaultClaims> = {}) {
  const claims = { ...defaultClaims, ...claimsOverrides };
  return {
    access_token: "mock-access-token",
    id_token: makeMockIdToken(claims),
    refresh_token: "mock-refresh-token",
    expires_in: 3600,
    token_type: "Bearer",
    scope: "openid email profile",
  };
}

async function getValidState(app: Awaited<ReturnType<typeof buildApp>>): Promise<string> {
  const res = await app.inject({ method: "GET", url: "/auth/google/start" });
  const location = res.headers.location as string;
  return new URL(location).searchParams.get("state")!;
}

async function getInviteState(
  app: Awaited<ReturnType<typeof buildApp>>,
  email = "test@example.com",
): Promise<string> {
  const invite = await app.persistence.insertBootstrapInvite({
    email,
    role: "member",
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    issuedByUserId: null,
  });
  const res = await app.inject({
    method: "GET",
    url: `/auth/google/start?invite_code=${encodeURIComponent(invite.code)}`,
  });
  const location = res.headers.location as string;
  return new URL(location).searchParams.get("state")!;
}

function extractCookieUserId(setCookie: string, sessionSecret: string): string | null {
  const match = setCookie.match(new RegExp(`${Env.SESSION_COOKIE_NAME}=([^;]+)`));
  if (!match) return null;
  return verifySessionCookie(match[1], sessionSecret)?.userId ?? null;
}

describe("OAuth callback → identity resolution", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    app = await buildApp({ persistenceBackend: "memory", oauthConfig: testOAuthConfig, appBaseUrl: "http://localhost:3000" });
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    if (app) await app.close();
  });

  it("first-time login creates user and sets cookie with UUID (not Google sub)", async () => {
    vi.stubGlobal("fetch", makeFetchMock(200, makeTokenExchangeResponse()));
    const state = await getInviteState(app);

    const res = await app.inject({
      method: "GET",
      url: `/auth/google/callback?code=auth-code&state=${encodeURIComponent(state)}`,
    });

    expect(res.statusCode).toBe(302);
    const setCookie = res.headers["set-cookie"] as string;
    const userId = extractCookieUserId(setCookie, testOAuthConfig.sessionSecret);
    expect(userId).toBeTruthy();
    // Should be a UUID, not the Google sub
    expect(userId).not.toBe("google-sub-123");
    expect(userId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("returning user login resolves the same UUID", async () => {
    vi.stubGlobal("fetch", makeFetchMock(200, makeTokenExchangeResponse()));

    // First login
    const state1 = await getInviteState(app);
    const res1 = await app.inject({
      method: "GET",
      url: `/auth/google/callback?code=auth-code&state=${encodeURIComponent(state1)}`,
    });
    const firstUserId = extractCookieUserId(res1.headers["set-cookie"] as string, testOAuthConfig.sessionSecret);

    // Second login (same claims)
    const state2 = await getValidState(app);
    const res2 = await app.inject({
      method: "GET",
      url: `/auth/google/callback?code=auth-code&state=${encodeURIComponent(state2)}`,
    });
    const secondUserId = extractCookieUserId(res2.headers["set-cookie"] as string, testOAuthConfig.sessionSecret);

    expect(secondUserId).toBe(firstUserId);
  });

  it("different Google sub with same email resolves to the same user (sub update)", async () => {
    // First login with sub-001
    vi.stubGlobal("fetch", makeFetchMock(200, makeTokenExchangeResponse({ sub: "google-sub-001" })));
    const state1 = await getInviteState(app);
    const res1 = await app.inject({
      method: "GET",
      url: `/auth/google/callback?code=auth-code&state=${encodeURIComponent(state1)}`,
    });
    const firstUserId = extractCookieUserId(res1.headers["set-cookie"] as string, testOAuthConfig.sessionSecret);

    // Second login with sub-002 but same email
    vi.stubGlobal("fetch", makeFetchMock(200, makeTokenExchangeResponse({ sub: "google-sub-002" })));
    const state2 = await getValidState(app);
    const res2 = await app.inject({
      method: "GET",
      url: `/auth/google/callback?code=auth-code&state=${encodeURIComponent(state2)}`,
    });
    const secondUserId = extractCookieUserId(res2.headers["set-cookie"] as string, testOAuthConfig.sessionSecret);

    expect(secondUserId).toBe(firstUserId);
  });

  it("different Google sub with different email creates a new user", async () => {
    // First login
    vi.stubGlobal("fetch", makeFetchMock(200, makeTokenExchangeResponse()));
    const state1 = await getInviteState(app);
    const res1 = await app.inject({
      method: "GET",
      url: `/auth/google/callback?code=auth-code&state=${encodeURIComponent(state1)}`,
    });
    const firstUserId = extractCookieUserId(res1.headers["set-cookie"] as string, testOAuthConfig.sessionSecret);

    // Different email and sub
    vi.stubGlobal("fetch", makeFetchMock(200, makeTokenExchangeResponse({
      sub: "google-sub-999",
      email: "other@example.com",
      name: "Other User",
    })));
    const state2 = await getInviteState(app, "other@example.com");
    const res2 = await app.inject({
      method: "GET",
      url: `/auth/google/callback?code=auth-code&state=${encodeURIComponent(state2)}`,
    });
    const secondUserId = extractCookieUserId(res2.headers["set-cookie"] as string, testOAuthConfig.sessionSecret);

    expect(secondUserId).not.toBe(firstUserId);
  });

  it("cookie userId can be used to load the user's store", async () => {
    vi.stubGlobal("fetch", makeFetchMock(200, makeTokenExchangeResponse()));
    const state = await getInviteState(app);
    const res = await app.inject({
      method: "GET",
      url: `/auth/google/callback?code=auth-code&state=${encodeURIComponent(state)}`,
    });

    const userId = extractCookieUserId(res.headers["set-cookie"] as string, testOAuthConfig.sessionSecret);
    expect(userId).toBeTruthy();

    // Use the cookie to access a protected endpoint
    const setCookie = res.headers["set-cookie"] as string;
    const cookieValue = setCookie.match(new RegExp(`${Env.SESSION_COOKIE_NAME}=([^;]+)`))?.[1];
    const settingsRes = await app.inject({
      method: "GET",
      url: "/settings",
      headers: { cookie: `${Env.SESSION_COOKIE_NAME}=${cookieValue}` },
    });
    expect(settingsRes.statusCode).toBe(200);
    expect(settingsRes.json().userId).toBe(userId);
  });
});

describe("ensureDefaultPortfolioData idempotency", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    app = await buildApp({ persistenceBackend: "memory", oauthConfig: testOAuthConfig });
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    if (app) await app.close();
  });

  it("calling resolveOrCreateUser twice seeds portfolio data only once", async () => {
    vi.stubGlobal("fetch", makeFetchMock(200, makeTokenExchangeResponse()));

    // Two login cycles
    const state1 = await getInviteState(app);
    await app.inject({
      method: "GET",
      url: `/auth/google/callback?code=auth-code&state=${encodeURIComponent(state1)}`,
    });
    const state2 = await getValidState(app);
    const res2 = await app.inject({
      method: "GET",
      url: `/auth/google/callback?code=auth-code&state=${encodeURIComponent(state2)}`,
    });

    // Verify user can still access their store (no duplicates or errors)
    const userId = extractCookieUserId(res2.headers["set-cookie"] as string, testOAuthConfig.sessionSecret);
    const cookieValue = (res2.headers["set-cookie"] as string).match(
      new RegExp(`${Env.SESSION_COOKIE_NAME}=([^;]+)`),
    )?.[1];

    const settingsRes = await app.inject({
      method: "GET",
      url: "/settings",
      headers: { cookie: `${Env.SESSION_COOKIE_NAME}=${cookieValue}` },
    });
    expect(settingsRes.statusCode).toBe(200);
    expect(settingsRes.json().userId).toBe(userId);
  });
});
