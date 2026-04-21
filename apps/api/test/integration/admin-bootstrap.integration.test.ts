import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock Env to force AUTH_MODE=oauth + set INITIAL_ADMIN_EMAIL.
// Static spread per demo-session.integration.test.ts — Env has non-configurable
// properties so a Proxy would fail.
vi.mock("@tw-portfolio/config", async (importOriginal) => {
  const original = await importOriginal<typeof import("@tw-portfolio/config")>();
  return {
    ...original,
    Env: {
      ...original.Env,
      AUTH_MODE: "oauth" as const,
      INITIAL_ADMIN_EMAIL: "admin@example.com",
    },
  };
});

const { buildApp } = await import("../../src/app.js");
const { _resetInviteStatusBuckets } = await import("../../src/lib/inviteStatusRateLimit.js");
type BuiltApp = Awaited<ReturnType<typeof buildApp>>;

const testOAuthConfig = {
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

function makeTokenResponse(email: string, sub: string) {
  return {
    access_token: "mock-access-token",
    id_token: makeMockIdToken({
      sub,
      email,
      email_verified: true,
      iss: "https://accounts.google.com",
      aud: "test-client-id",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
    refresh_token: "rt",
    expires_in: 3600,
    token_type: "Bearer",
    scope: "openid email profile",
  };
}

async function getState(app: BuiltApp, inviteCode?: string): Promise<string> {
  const url = inviteCode
    ? `/auth/google/start?invite_code=${encodeURIComponent(inviteCode)}`
    : "/auth/google/start";
  const res = await app.inject({ method: "GET", url });
  return new URL(res.headers.location as string).searchParams.get("state")!;
}

describe("promoteUserToAdminByEmail — idempotency + error paths", () => {
  let app: BuiltApp;

  beforeEach(async () => {
    app = await buildApp({ persistenceBackend: "memory", oauthConfig: testOAuthConfig });
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it("promotes an existing member user to admin", async () => {
    // Arrange
    await app.persistence.resolveOrCreateUser("google", "seed-sub", {
      email: "admin@example.com",
      name: "Seed",
    });

    // Act
    const result = await app.persistence.promoteUserToAdminByEmail(
      "admin@example.com",
      "admin_promote_startup",
    );

    // Assert
    expect(result?.role).toBe("admin");
  });

  it("is idempotent across repeated calls (still returns admin)", async () => {
    // Arrange
    await app.persistence.resolveOrCreateUser("google", "seed-sub", {
      email: "admin@example.com",
      name: "Seed",
    });

    // Act
    const first = await app.persistence.promoteUserToAdminByEmail(
      "admin@example.com",
      "admin_promote_startup",
    );
    const second = await app.persistence.promoteUserToAdminByEmail(
      "admin@example.com",
      "admin_promote_startup",
    );

    // Assert
    expect(first?.role).toBe("admin");
    expect(second?.role).toBe("admin");
  });

  it("returns null when no user matches the target email", async () => {
    // Act
    const result = await app.persistence.promoteUserToAdminByEmail(
      "nobody@example.com",
      "admin_promote_startup",
    );

    // Assert
    expect(result).toBeNull();
  });

  it("skips promotion when the matched user is deactivated", async () => {
    // Arrange
    await app.persistence.resolveOrCreateUser("google", "deact-sub", {
      email: "admin@example.com",
      name: "D",
    });
    const usersByEmail = (app.persistence as unknown as {
      usersByEmail: Map<string, { deactivatedAt?: string | null }>;
    }).usersByEmail;
    usersByEmail.get("admin@example.com")!.deactivatedAt = new Date().toISOString();

    // Act
    const result = await app.persistence.promoteUserToAdminByEmail(
      "admin@example.com",
      "admin_promote_startup",
    );

    // Assert
    expect(result).toBeNull();
  });
});

describe("OAuth callback — INITIAL_ADMIN_EMAIL first-sign-in promotion", () => {
  let app: BuiltApp;

  beforeEach(async () => {
    _resetInviteStatusBuckets();
    app = await buildApp({
      persistenceBackend: "memory",
      oauthConfig: testOAuthConfig,
      appBaseUrl: "http://localhost:3000",
    });
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    if (app) await app.close();
  });

  it("bypasses invite-gate and promotes to admin when email matches INITIAL_ADMIN_EMAIL", async () => {
    // Arrange
    vi.stubGlobal("fetch", makeFetchMock(200, makeTokenResponse("admin@example.com", "admin-sub")));
    const state = await getState(app); // no invite in state

    // Act
    const res = await app.inject({
      method: "GET",
      url: `/auth/google/callback?code=ac&state=${encodeURIComponent(state)}`,
    });

    // Assert — callback redirects to dashboard; admin user created with role=admin
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("http://localhost:3000/dashboard");
    const user = await app.persistence.getAuthUserByEmail("admin@example.com");
    expect(user?.role).toBe("admin");
  });

  it("emits admin_promote_first_signin audit when new user is created via bypass", async () => {
    // Arrange
    vi.stubGlobal("fetch", makeFetchMock(200, makeTokenResponse("admin@example.com", "admin-sub")));
    const state = await getState(app);

    // Act
    await app.inject({
      method: "GET",
      url: `/auth/google/callback?code=ac&state=${encodeURIComponent(state)}`,
    });

    // Assert
    const logStore = (app.persistence as unknown as {
      auditLog: Array<{ action: string }>;
    }).auditLog;
    const firstSigninEntries = logStore.filter((e) => e.action === "admin_promote_first_signin");
    expect(firstSigninEntries).toHaveLength(1);
  });

  it("does not consume an invite for INITIAL_ADMIN_EMAIL — bypass fires first", async () => {
    // Arrange — create invite for admin's email
    const invite = await app.persistence.createInvite({
      email: "admin@example.com",
      role: "admin",
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      issuedByUserId: null,
    });
    vi.stubGlobal("fetch", makeFetchMock(200, makeTokenResponse("admin@example.com", "admin-sub")));
    const state = await getState(app, invite.code);

    // Act
    await app.inject({
      method: "GET",
      url: `/auth/google/callback?code=ac&state=${encodeURIComponent(state)}`,
    });

    // Assert — invite still valid, unused
    expect(await app.persistence.getInviteStatus(invite.code)).toBe("valid");
  });

  it("non-INITIAL_ADMIN_EMAIL users with invite still consume normally", async () => {
    // Arrange
    const invite = await app.persistence.createInvite({
      email: "newbie@example.com",
      role: "member",
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      issuedByUserId: null,
    });
    vi.stubGlobal("fetch", makeFetchMock(200, makeTokenResponse("newbie@example.com", "newbie-sub")));
    const state = await getState(app, invite.code);

    // Act
    await app.inject({
      method: "GET",
      url: `/auth/google/callback?code=ac&state=${encodeURIComponent(state)}`,
    });

    // Assert
    expect(await app.persistence.getInviteStatus(invite.code)).toBe("used");
    const user = await app.persistence.getAuthUserByEmail("newbie@example.com");
    expect(user?.role).toBe("member");
  });
});
