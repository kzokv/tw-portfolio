import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Force oauth mode so the preHandler enforces session_version.
vi.mock("@tw-portfolio/config", async (importOriginal) => {
  const original = await importOriginal<typeof import("@tw-portfolio/config")>();
  return {
    ...original,
    Env: { ...original.Env, AUTH_MODE: "oauth" as const },
  };
});

const { buildApp } = await import("../../src/app.js");
const { signSessionCookie } = await import("../../src/auth/googleOAuth.js");

const testOAuthConfig = {
  clientId: "test-client-id",
  clientSecret: "test-client-secret",
  redirectUri: "http://localhost:4000/auth/google/callback",
  sessionSecret: "test-session-secret-that-is-long-enough-32chars!!",
};

describe("session_version mismatch → 401", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let userId: string;
  const SESSION_COOKIE_NAME = "g_auth_session";

  beforeEach(async () => {
    app = await buildApp({ persistenceBackend: "memory", oauthConfig: testOAuthConfig });
    const user = await app.persistence.resolveOrCreateUser("google", "sv-sub", {
      email: "sv@example.com",
      name: "SV",
    });
    userId = user.userId;
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it("returns 401 when cookie session_version is stale (DB bumped)", async () => {
    // Arrange — mint cookie at version 1, then bump DB to version 2
    const staleCookie = signSessionCookie(userId, testOAuthConfig.sessionSecret, 1);
    await app.persistence.bumpSessionVersion(userId);

    // Act — hit an authenticated endpoint
    const res = await app.inject({
      method: "GET",
      url: "/settings",
      headers: { cookie: `${SESSION_COOKIE_NAME}=${staleCookie}` },
    });

    // Assert
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("auth_required");
  });

  it("accepts a cookie whose session_version matches DB", async () => {
    // Arrange
    const user = await app.persistence.getAuthUserById(userId);
    const fresh = signSessionCookie(userId, testOAuthConfig.sessionSecret, user!.sessionVersion);

    // Act
    const res = await app.inject({
      method: "GET",
      url: "/settings",
      headers: { cookie: `${SESSION_COOKIE_NAME}=${fresh}` },
    });

    // Assert
    expect(res.statusCode).toBe(200);
  });

  it("bumpSessionVersion increments atomically and returns the new version", async () => {
    // Arrange
    const before = (await app.persistence.getAuthUserById(userId))!.sessionVersion;

    // Act
    const v1 = await app.persistence.bumpSessionVersion(userId);
    const v2 = await app.persistence.bumpSessionVersion(userId);

    // Assert
    expect(v1).toBe(before + 1);
    expect(v2).toBe(before + 2);
  });

  it("rejects a cookie with a future version (DB hasn't been bumped that high)", async () => {
    // Arrange — mint a cookie with an arbitrary version in the future
    const futureCookie = signSessionCookie(userId, testOAuthConfig.sessionSecret, 999);

    // Act
    const res = await app.inject({
      method: "GET",
      url: "/settings",
      headers: { cookie: `${SESSION_COOKIE_NAME}=${futureCookie}` },
    });

    // Assert
    expect(res.statusCode).toBe(401);
  });
});
