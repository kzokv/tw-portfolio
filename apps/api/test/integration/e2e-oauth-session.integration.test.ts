import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import type { GoogleOAuthConfig } from "../../src/auth/googleOAuth.js";
import { verifySessionCookie } from "../../src/auth/googleOAuth.js";
import { assertE2EOauthSessionEnabled } from "../../src/routes/registerRoutes.js";
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

describe("POST /__e2e/oauth-session", () => {
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

  it("returns signed session cookie with hardcoded sub when no id_token provided", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/__e2e/oauth-session",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("ok");
    expect(body.sub).toBe("e2e-ci-google-sub-001");

    const setCookie = res.headers["set-cookie"] as string;
    expect(setCookie).toContain(`${Env.SESSION_COOKIE_NAME}=`);
    expect(setCookie).toContain("HttpOnly");

    // Verify the cookie value is HMAC-signed and verifies correctly
    const cookieValue = setCookie.split(`${Env.SESSION_COOKIE_NAME}=`)[1].split(";")[0];
    const verifiedSub = verifySessionCookie(cookieValue, testOAuthConfig.sessionSecret);
    expect(verifiedSub).toBe("e2e-ci-google-sub-001");
  });

  it("returns signed session cookie from decoded id_token when provided", async () => {
    const idToken = makeMockIdToken({
      sub: "google-custom-sub-456",
      email: "test@example.com",
      email_verified: true,
      iss: "https://accounts.google.com",
      aud: "test-client-id",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    const res = await app.inject({
      method: "POST",
      url: "/__e2e/oauth-session",
      payload: { id_token: idToken },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("ok");
    expect(body.sub).toBe("google-custom-sub-456");

    const setCookie = res.headers["set-cookie"] as string;
    const cookieValue = setCookie.split(`${Env.SESSION_COOKIE_NAME}=`)[1].split(";")[0];
    const verifiedSub = verifySessionCookie(cookieValue, testOAuthConfig.sessionSecret);
    expect(verifiedSub).toBe("google-custom-sub-456");
  });

  it("uses buildCookieAttrs for cookie attributes (same as real callback)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/__e2e/oauth-session",
    });

    const setCookie = res.headers["set-cookie"] as string;
    expect(setCookie).toContain("Path=/");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
  });
});

describe("assertE2EOauthSessionEnabled guard", () => {
  it("does not throw when NODE_ENV is 'test'", () => {
    expect(() => assertE2EOauthSessionEnabled("test")).not.toThrow();
  });

  it("does not throw when NODE_ENV is 'development'", () => {
    expect(() => assertE2EOauthSessionEnabled("development")).not.toThrow();
  });

  it("throws 404 when NODE_ENV is 'production'", () => {
    expect(() => assertE2EOauthSessionEnabled("production")).toThrow(
      expect.objectContaining({ statusCode: 404 }),
    );
  });

  it("throws 404 for unexpected NODE_ENV values", () => {
    expect(() => assertE2EOauthSessionEnabled("staging")).toThrow(
      expect.objectContaining({ statusCode: 404 }),
    );
  });

  it("endpoint returns 200 in test mode (NODE_ENV=test)", async () => {
    const app = await buildApp({
      persistenceBackend: "memory",
      oauthConfig: testOAuthConfig,
    });

    try {
      const res = await app.inject({
        method: "POST",
        url: "/__e2e/oauth-session",
      });
      expect(res.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
});
