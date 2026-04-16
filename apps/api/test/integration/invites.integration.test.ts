import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../src/app.js";
import { _resetInviteStatusBuckets } from "../../src/routes/registerRoutes.js";
import type { GoogleOAuthConfig } from "../../src/auth/googleOAuth.js";

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

function makeTokenResponse(claims: Record<string, unknown>) {
  return {
    access_token: "mock-access-token",
    id_token: makeMockIdToken({
      sub: "google-sub-new",
      email_verified: true,
      name: "New User",
      iss: "https://accounts.google.com",
      aud: "test-client-id",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      ...claims,
    }),
    refresh_token: "mock-refresh",
    expires_in: 3600,
    token_type: "Bearer",
    scope: "openid email profile",
  };
}

async function buildInvitedState(
  app: Awaited<ReturnType<typeof buildApp>>,
  code: string,
): Promise<string> {
  const res = await app.inject({
    method: "GET",
    url: `/auth/google/start?invite_code=${encodeURIComponent(code)}`,
  });
  return new URL(res.headers.location as string).searchParams.get("state")!;
}

async function createInviteViaPersistence(
  app: Awaited<ReturnType<typeof buildApp>>,
  email: string,
  role: "admin" | "member" | "viewer" = "member",
  opts: { expiresInMs?: number } = {},
): Promise<string> {
  const invite = await app.persistence.createInvite({
    email,
    role,
    expiresAt: new Date(Date.now() + (opts.expiresInMs ?? 86_400_000)).toISOString(),
    issuedByUserId: null,
  });
  return invite.code;
}

describe("POST /invites — admin-only invite creation", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    app = await buildApp({ persistenceBackend: "memory", oauthConfig: testOAuthConfig });
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it("admin can create an invite and receives code + url", async () => {
    // Act
    const res = await app.inject({
      method: "POST",
      url: "/invites",
      headers: { "x-user-id": "user-1", "x-user-role": "admin" },
      payload: { email: "new-user@example.com", role: "member" },
    });

    // Assert
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
    expect(body.url).toContain(`/invite/${body.code}`);
  });

  it("member role is blocked with 403 admin_role_required", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/invites",
      headers: { "x-user-id": "user-1", "x-user-role": "member" },
      payload: { email: "foo@example.com", role: "member" },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("admin_role_required");
  });

  it("viewer role is blocked with 403", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/invites",
      headers: { "x-user-id": "user-1", "x-user-role": "viewer" },
      payload: { email: "foo@example.com", role: "viewer" },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("admin_role_required");
  });

  it("rejects invite creation when user for that email already exists (409)", async () => {
    // Arrange — seed an existing user via OAuth flow
    vi.stubGlobal("fetch", makeFetchMock(200, makeTokenResponse({
      sub: "existing-sub",
      email: "existing@example.com",
    })));
    const firstInvite = await createInviteViaPersistence(app, "existing@example.com");
    const state = await buildInvitedState(app, firstInvite);
    await app.inject({
      method: "GET",
      url: `/auth/google/callback?code=auth-code&state=${encodeURIComponent(state)}`,
    });
    vi.unstubAllGlobals();

    // Act — try to issue a new invite for the same email
    const res = await app.inject({
      method: "POST",
      url: "/invites",
      headers: { "x-user-id": "user-1", "x-user-role": "admin" },
      payload: { email: "existing@example.com", role: "member" },
    });

    // Assert
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("invite_email_registered");
  });
});

describe("DELETE /invites/:code — idempotent revoke", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    app = await buildApp({ persistenceBackend: "memory", oauthConfig: testOAuthConfig });
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it("sets revoked_at and returns 204 on first call", async () => {
    // Arrange
    const code = await createInviteViaPersistence(app, "to-revoke@example.com");

    // Act
    const res = await app.inject({
      method: "DELETE",
      url: `/invites/${code}`,
      headers: { "x-user-id": "user-1", "x-user-role": "admin" },
    });

    // Assert
    expect(res.statusCode).toBe(204);
    expect(await app.persistence.getInviteStatus(code)).toBe("revoked");
  });

  it("second invocation is a no-op (still returns 204)", async () => {
    // Arrange
    const code = await createInviteViaPersistence(app, "to-revoke-again@example.com");
    await app.inject({
      method: "DELETE",
      url: `/invites/${code}`,
      headers: { "x-user-id": "user-1", "x-user-role": "admin" },
    });

    // Act
    const res = await app.inject({
      method: "DELETE",
      url: `/invites/${code}`,
      headers: { "x-user-id": "user-1", "x-user-role": "admin" },
    });

    // Assert
    expect(res.statusCode).toBe(204);
    expect(await app.persistence.getInviteStatus(code)).toBe("revoked");
  });

  it("non-admin cannot revoke (403)", async () => {
    const code = await createInviteViaPersistence(app, "x@example.com");
    const res = await app.inject({
      method: "DELETE",
      url: `/invites/${code}`,
      headers: { "x-user-id": "user-1", "x-user-role": "member" },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /invites/:code/status — public with rate limiting", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    _resetInviteStatusBuckets();
    app = await buildApp({ persistenceBackend: "memory", oauthConfig: testOAuthConfig });
  });

  afterEach(async () => {
    if (app) await app.close();
    _resetInviteStatusBuckets();
  });

  it("returns valid for a fresh unused invite", async () => {
    const code = await createInviteViaPersistence(app, "alive@example.com");
    const res = await app.inject({ method: "GET", url: `/invites/${code}/status` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "valid" });
  });

  it("returns invalid for a non-existent code", async () => {
    const res = await app.inject({ method: "GET", url: "/invites/NOTREAL1/status" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "invalid" });
  });

  it("returns expired when the invite is past expires_at", async () => {
    const code = await createInviteViaPersistence(app, "expired@example.com", "member", { expiresInMs: -1000 });
    const res = await app.inject({ method: "GET", url: `/invites/${code}/status` });
    expect(res.json()).toEqual({ status: "expired" });
  });

  it("returns revoked after DELETE /invites/:code", async () => {
    const code = await createInviteViaPersistence(app, "rev@example.com");
    await app.inject({
      method: "DELETE",
      url: `/invites/${code}`,
      headers: { "x-user-id": "user-1", "x-user-role": "admin" },
    });
    const res = await app.inject({ method: "GET", url: `/invites/${code}/status` });
    expect(res.json()).toEqual({ status: "revoked" });
  });

  it("upper-cases the path parameter so lowercase URLs still resolve", async () => {
    const code = await createInviteViaPersistence(app, "case@example.com");
    const res = await app.inject({ method: "GET", url: `/invites/${code.toLowerCase()}/status` });
    expect(res.json()).toEqual({ status: "valid" });
  });

  it("rate-limits after 20 requests per minute from the same IP", async () => {
    const code = await createInviteViaPersistence(app, "rl@example.com");
    const results: number[] = [];
    for (let i = 0; i < 21; i += 1) {
      const res = await app.inject({ method: "GET", url: `/invites/${code}/status` });
      results.push(res.statusCode);
    }
    expect(results.slice(0, 20).every((s) => s === 200)).toBe(true);
    expect(results[20]).toBe(429);
  });
});

describe("OAuth callback — invite-gated flow error reasons", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
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

  it("redirects to invite_required when unknown email has no invite in state", async () => {
    // Arrange
    vi.stubGlobal("fetch", makeFetchMock(200, makeTokenResponse({
      sub: "ghost", email: "ghost@example.com",
    })));
    const startRes = await app.inject({ method: "GET", url: "/auth/google/start" });
    const state = new URL(startRes.headers.location as string).searchParams.get("state")!;

    // Act
    const res = await app.inject({
      method: "GET",
      url: `/auth/google/callback?code=ac&state=${encodeURIComponent(state)}`,
    });

    // Assert
    expect(res.headers.location).toBe("http://localhost:3000/auth/error?reason=invite_required");
  });

  it("redirects to invalid_code when invite code in state doesn't exist", async () => {
    vi.stubGlobal("fetch", makeFetchMock(200, makeTokenResponse({
      sub: "ghost2", email: "ghost2@example.com",
    })));
    const state = await buildInvitedState(app, "NOTREAL1");

    const res = await app.inject({
      method: "GET",
      url: `/auth/google/callback?code=ac&state=${encodeURIComponent(state)}`,
    });

    expect(res.headers.location).toBe("http://localhost:3000/auth/error?reason=invalid_code");
  });

  it("redirects to expired_code when invite is past expires_at", async () => {
    const code = await createInviteViaPersistence(app, "exp@example.com", "member", { expiresInMs: -1000 });
    vi.stubGlobal("fetch", makeFetchMock(200, makeTokenResponse({
      sub: "exp-sub", email: "exp@example.com",
    })));
    const state = await buildInvitedState(app, code);

    const res = await app.inject({
      method: "GET",
      url: `/auth/google/callback?code=ac&state=${encodeURIComponent(state)}`,
    });

    expect(res.headers.location).toBe("http://localhost:3000/auth/error?reason=expired_code");
  });

  it("redirects to revoked when invite was revoked before consumption", async () => {
    const code = await createInviteViaPersistence(app, "rv@example.com");
    await app.persistence.revokeInvite(code);
    vi.stubGlobal("fetch", makeFetchMock(200, makeTokenResponse({
      sub: "rv-sub", email: "rv@example.com",
    })));
    const state = await buildInvitedState(app, code);

    const res = await app.inject({
      method: "GET",
      url: `/auth/google/callback?code=ac&state=${encodeURIComponent(state)}`,
    });

    expect(res.headers.location).toBe("http://localhost:3000/auth/error?reason=revoked");
  });

  it("redirects to already_used when invite was already consumed", async () => {
    const code = await createInviteViaPersistence(app, "used@example.com");
    await app.persistence.consumeInvite(code, "used@example.com");
    vi.stubGlobal("fetch", makeFetchMock(200, makeTokenResponse({
      sub: "used-sub", email: "used@example.com",
    })));
    const state = await buildInvitedState(app, code);

    const res = await app.inject({
      method: "GET",
      url: `/auth/google/callback?code=ac&state=${encodeURIComponent(state)}`,
    });

    expect(res.headers.location).toBe("http://localhost:3000/auth/error?reason=already_used");
  });

  it("redirects to email_mismatch when invite email differs from Google email", async () => {
    const code = await createInviteViaPersistence(app, "invited@example.com");
    vi.stubGlobal("fetch", makeFetchMock(200, makeTokenResponse({
      sub: "mismatch-sub", email: "different@example.com",
    })));
    const state = await buildInvitedState(app, code);

    const res = await app.inject({
      method: "GET",
      url: `/auth/google/callback?code=ac&state=${encodeURIComponent(state)}`,
    });

    expect(res.headers.location).toBe("http://localhost:3000/auth/error?reason=email_mismatch");
  });

  it("consumes invite and creates user with invite.role on happy path", async () => {
    // Arrange
    const code = await createInviteViaPersistence(app, "newbie@example.com", "viewer");
    vi.stubGlobal("fetch", makeFetchMock(200, makeTokenResponse({
      sub: "newbie-sub", email: "newbie@example.com",
    })));
    const state = await buildInvitedState(app, code);

    // Act
    const res = await app.inject({
      method: "GET",
      url: `/auth/google/callback?code=ac&state=${encodeURIComponent(state)}`,
    });

    // Assert
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("http://localhost:3000/dashboard");
    const user = await app.persistence.getAuthUserByEmail("newbie@example.com");
    expect(user?.role).toBe("viewer");
    expect(await app.persistence.getInviteStatus(code)).toBe("used");
  });
});

describe("OAuth callback — account_disabled", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
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

  it("redirects to account_disabled when the existing user is deactivated", async () => {
    // Arrange — create user, then flip deactivatedAt on the memory store (public
    // deactivateUser endpoint lands with KZO-144; for 143 we reach into the
    // memory persistence to exercise the callback's deactivation guard.)
    const code = await createInviteViaPersistence(app, "disabled@example.com");
    vi.stubGlobal("fetch", makeFetchMock(200, makeTokenResponse({
      sub: "dis-sub", email: "disabled@example.com",
    })));
    const firstState = await buildInvitedState(app, code);
    await app.inject({
      method: "GET",
      url: `/auth/google/callback?code=ac&state=${encodeURIComponent(firstState)}`,
    });
    const usersByEmail = (app.persistence as unknown as {
      usersByEmail: Map<string, { deactivatedAt?: string | null }>;
    }).usersByEmail;
    const memUser = usersByEmail.get("disabled@example.com");
    expect(memUser).toBeTruthy();
    memUser!.deactivatedAt = new Date().toISOString();

    const secondStartRes = await app.inject({ method: "GET", url: "/auth/google/start" });
    const secondState = new URL(secondStartRes.headers.location as string).searchParams.get("state")!;

    // Act
    const res = await app.inject({
      method: "GET",
      url: `/auth/google/callback?code=ac&state=${encodeURIComponent(secondState)}`,
    });

    // Assert
    expect(res.headers.location).toBe("http://localhost:3000/auth/error?reason=account_disabled");
  });
});
