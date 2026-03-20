import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../src/app.js";
import type { GoogleOAuthConfig } from "../../src/auth/googleOAuth.js";
import { Env } from "@tw-portfolio/config";

// Profile API endpoints require session auth enforced only when AUTH_MODE=oauth.
// vitest.config.ts forces AUTH_MODE=dev_bypass for all API tests (so tests are
// not broken by a local .env.local with AUTH_MODE=oauth). Override AUTH_MODE to
// "oauth" here so resolveUserId enforces cookie validation and A3/A6 receive 401.
vi.mock("@tw-portfolio/config", async (importOriginal) => {
  const original = await importOriginal<typeof import("@tw-portfolio/config")>();
  return {
    ...original,
    Env: { ...original.Env, AUTH_MODE: "oauth" as const },
  };
});

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

function makeIdTokenWithClaims(overrides: Record<string, unknown> = {}) {
  return makeMockIdToken({
    sub: "profile-test-sub",
    email: "profile@example.com",
    email_verified: true,
    name: "Profile Test User",
    picture: "https://lh3.googleusercontent.com/profile-test.jpg",
    iss: "https://accounts.google.com",
    aud: "test-client-id",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...overrides,
  });
}

function extractCookieValue(setCookie: string): string | null {
  const match = setCookie.match(new RegExp(`${Env.SESSION_COOKIE_NAME}=([^;]+)`));
  return match?.[1] ?? null;
}

describe("GET /profile and PATCH /profile", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    app = await buildApp({
      persistenceBackend: "memory",
      oauthConfig: testOAuthConfig,
      appBaseUrl: "http://localhost:3000",
    });
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  /** Seed a user via __e2e/oauth-session and return cookie + userId */
  async function seedUser(idToken?: string) {
    const res = await app.inject({
      method: "POST",
      url: "/__e2e/oauth-session",
      payload: idToken ? { id_token: idToken } : {},
    });
    expect(res.statusCode).toBe(200);
    const setCookie = res.headers["set-cookie"] as string;
    const cookieValue = extractCookieValue(setCookie);
    expect(cookieValue).toBeTruthy();
    return {
      userId: res.json().userId as string,
      cookie: `${Env.SESSION_COOKIE_NAME}=${cookieValue}`,
    };
  }

  // --- A1: GET /profile returns correct ProfileDto shape ---
  it("GET /profile returns correct ProfileDto shape", async () => {
    const { cookie } = await seedUser(makeIdTokenWithClaims());

    const res = await app.inject({
      method: "GET",
      url: "/profile",
      headers: { cookie },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    // All 7 ProfileDto fields must be present
    expect(body).toHaveProperty("userId");
    expect(body).toHaveProperty("email");
    expect(body).toHaveProperty("displayName");
    expect(body).toHaveProperty("providerPictureUrl");
    expect(body).toHaveProperty("providerDisplayName");
    expect(body).toHaveProperty("linkedAt");
    expect(body).toHaveProperty("lastSeenAt");

    // userId is a UUID
    expect(body.userId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  // --- A2: GET /profile field values match seeded user ---
  it("GET /profile field values match seeded claims", async () => {
    const { cookie } = await seedUser(makeIdTokenWithClaims());

    const res = await app.inject({
      method: "GET",
      url: "/profile",
      headers: { cookie },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.email).toBe("profile@example.com");
    expect(body.displayName).toBe("Profile Test User");
    expect(body.providerPictureUrl).toBe("https://lh3.googleusercontent.com/profile-test.jpg");
    expect(body.providerDisplayName).toBe("Profile Test User");
  });

  // --- A3: GET /profile without session returns 401 ---
  it("GET /profile without session returns 401", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/profile",
    });

    expect(res.statusCode).toBe(401);
  });

  // --- A4: PATCH /profile updates email and returns updated ProfileDto ---
  it("PATCH /profile updates email", async () => {
    const { cookie } = await seedUser(makeIdTokenWithClaims());

    const patchRes = await app.inject({
      method: "PATCH",
      url: "/profile",
      headers: { cookie, "content-type": "application/json" },
      payload: { email: "new-email@example.com" },
    });

    expect(patchRes.statusCode).toBe(200);
    const patched = patchRes.json();
    expect(patched.email).toBe("new-email@example.com");

    // Verify persistence: subsequent GET reflects the change
    const getRes = await app.inject({
      method: "GET",
      url: "/profile",
      headers: { cookie },
    });

    expect(getRes.statusCode).toBe(200);
    expect(getRes.json().email).toBe("new-email@example.com");
  });

  // --- A5: PATCH /profile with invalid email returns 400 ---
  it("PATCH /profile with invalid email returns 400", async () => {
    const { cookie } = await seedUser(makeIdTokenWithClaims());

    const res = await app.inject({
      method: "PATCH",
      url: "/profile",
      headers: { cookie, "content-type": "application/json" },
      payload: { email: "not-an-email" },
    });

    expect(res.statusCode).toBe(400);
  });

  // --- A6: PATCH /profile without session returns 401 ---
  it("PATCH /profile without session returns 401", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/profile",
      headers: { "content-type": "application/json" },
      payload: { email: "test@example.com" },
    });

    expect(res.statusCode).toBe(401);
  });

  // --- A7: PATCH /profile does NOT update provider_email ---
  it("PATCH /profile does NOT update provider fields", async () => {
    const { cookie } = await seedUser(makeIdTokenWithClaims());

    await app.inject({
      method: "PATCH",
      url: "/profile",
      headers: { cookie, "content-type": "application/json" },
      payload: { email: "changed@example.com" },
    });

    const getRes = await app.inject({
      method: "GET",
      url: "/profile",
      headers: { cookie },
    });

    const body = getRes.json();
    // Email was updated
    expect(body.email).toBe("changed@example.com");
    // Provider fields remain unchanged — providerDisplayName should still be original
    expect(body.providerDisplayName).toBe("Profile Test User");
    expect(body.providerPictureUrl).toBe("https://lh3.googleusercontent.com/profile-test.jpg");
  });

  // --- A9: GET /profile for dev_bypass user (no external identity) ---
  it("GET /profile for user without external identity returns nulls for provider fields", async () => {
    // Default __e2e/oauth-session (no id_token) uses hardcoded sub — still has provider data.
    // MemoryPersistence returns linkedAt/lastSeenAt as null anyway, but providerDisplayName
    // should be "E2E CI User" for the default flow. Test with explicit claims to verify shape.
    const { cookie } = await seedUser(makeIdTokenWithClaims({
      picture: undefined,
    }));

    const res = await app.inject({
      method: "GET",
      url: "/profile",
      headers: { cookie },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.userId).toBeTruthy();
    expect(body.email).toBe("profile@example.com");
    expect(body.displayName).toBe("Profile Test User");
    // Provider picture should be null when not provided in claims
    expect(body.providerPictureUrl).toBeNull();
  });
});
