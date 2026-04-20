import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tw-portfolio/config", async (importOriginal) => {
  const original = await importOriginal<typeof import("@tw-portfolio/config")>();
  return {
    ...original,
    Env: { ...original.Env, AUTH_MODE: "oauth" as const },
  };
});

const { buildApp } = await import("../../src/app.js");
const { signImpersonationCookie, signSessionCookie } = await import("../../src/auth/googleOAuth.js");

type BuiltApp = Awaited<ReturnType<typeof buildApp>>;

const testOAuthConfig = {
  clientId: "test-client-id",
  clientSecret: "test-client-secret",
  redirectUri: "http://localhost:4000/auth/google/callback",
  sessionSecret: "test-session-secret-that-is-long-enough-32chars!!",
};

const SESSION_COOKIE_NAME = "g_auth_session";
const IMPERSONATION_COOKIE_NAME = "g_impersonation";

async function createUser(
  app: BuiltApp,
  email: string,
  name: string,
  role: "admin" | "member" | "viewer" = "member",
  provider: "google" | "demo" = "google",
): Promise<string> {
  const sub = `${provider}-sub-${email.replace("@", "-at-")}`;
  const { userId } = await app.persistence.resolveOrCreateUser(
    provider,
    sub,
    { email, name },
    { role },
  );
  return userId;
}

async function currentSessionVersion(app: BuiltApp, userId: string): Promise<number> {
  const authUser = await app.persistence.getAuthUserById(userId);
  if (!authUser) {
    throw new Error(`Auth user ${userId} not found`);
  }
  return authUser.sessionVersion;
}

function cookieHeader(sessionCookieValue: string, impersonationCookieValue?: string): string {
  const cookies = [`${SESSION_COOKIE_NAME}=${sessionCookieValue}`];
  if (impersonationCookieValue) {
    cookies.push(`${IMPERSONATION_COOKIE_NAME}=${impersonationCookieValue}`);
  }
  return cookies.join("; ");
}

function setCookieHeaderValue(response: { headers: Record<string, string | string[] | undefined> }): string {
  const header = response.headers["set-cookie"];
  return Array.isArray(header) ? header.join(", ") : (header ?? "");
}

describe("admin impersonation — integration", () => {
  let app: BuiltApp;
  let adminUserId: string;
  let targetUserId: string;

  beforeEach(async () => {
    app = await buildApp({ persistenceBackend: "memory", oauthConfig: testOAuthConfig });
    adminUserId = await createUser(app, "imp-admin@example.com", "Impersonation Admin", "admin");
    targetUserId = await createUser(app, "imp-target@example.com", "Impersonation Target", "member");
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it("expired impersonation cookie auto-exits, clears cookie, and falls back to admin context", async () => {
    const sessionCookieValue = signSessionCookie(
      adminUserId,
      testOAuthConfig.sessionSecret,
      await currentSessionVersion(app, adminUserId),
    );
    const impersonationCookieValue = signImpersonationCookie(
      adminUserId,
      targetUserId,
      Date.now() - 1_000,
      testOAuthConfig.sessionSecret,
    );

    const response = await app.inject({
      method: "GET",
      url: "/settings",
      headers: {
        cookie: cookieHeader(sessionCookieValue, impersonationCookieValue),
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().userId).toBe(adminUserId);
    expect(setCookieHeaderValue({ headers: response.headers as Record<string, string | string[] | undefined> })).toContain(`${IMPERSONATION_COOKIE_NAME}=;`);

    const auditLog = await app.persistence.listAuditLog({
      page: 1,
      limit: 20,
      actions: ["impersonation_end"],
    });
    const auditEntry = auditLog.items.find((entry) => entry.metadata.reason === "expired");
    expect(auditEntry).toBeDefined();
    expect(auditEntry?.actorUserId).toBe(adminUserId);
    expect(auditEntry?.targetUserId).toBe(targetUserId);
  });

  it("stale session while impersonating returns 401 and clears both cookies", async () => {
    const sessionCookieValue = signSessionCookie(
      adminUserId,
      testOAuthConfig.sessionSecret,
      await currentSessionVersion(app, adminUserId),
    );
    const impersonationCookieValue = signImpersonationCookie(
      adminUserId,
      targetUserId,
      Date.now() + 60_000,
      testOAuthConfig.sessionSecret,
    );

    await createUser(app, "backup-admin@example.com", "Backup Admin", "admin");
    await app.persistence.disableUser(adminUserId, { actorUserId: "system" });

    const response = await app.inject({
      method: "GET",
      url: "/settings",
      headers: {
        cookie: cookieHeader(sessionCookieValue, impersonationCookieValue),
      },
    });

    expect(response.statusCode).toBe(401);
    const setCookie = setCookieHeaderValue({ headers: response.headers as Record<string, string | string[] | undefined> });
    expect(setCookie).toContain(`${SESSION_COOKIE_NAME}=;`);
    expect(setCookie).toContain(`${IMPERSONATION_COOKIE_NAME}=;`);
  });

  it("write attempts while impersonating are blocked and audited", async () => {
    const sessionCookieValue = signSessionCookie(
      adminUserId,
      testOAuthConfig.sessionSecret,
      await currentSessionVersion(app, adminUserId),
    );
    const impersonationCookieValue = signImpersonationCookie(
      adminUserId,
      targetUserId,
      Date.now() + 60_000,
      testOAuthConfig.sessionSecret,
    );

    const response = await app.inject({
      method: "PATCH",
      url: "/profile",
      headers: {
        cookie: cookieHeader(sessionCookieValue, impersonationCookieValue),
      },
      payload: { email: "blocked@example.com" },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error).toBe("impersonation_write_blocked");

    const auditLog = await app.persistence.listAuditLog({
      page: 1,
      limit: 20,
      actions: ["impersonation_blocked_write"],
    });
    const auditEntry = auditLog.items.find((entry) => entry.targetUserId === targetUserId);
    expect(auditEntry).toBeDefined();
    expect(auditEntry?.metadata.method).toBe("PATCH");
    expect(auditEntry?.metadata.path).toBe("/profile");
  });

  it("write-block taxonomy covers POST, PATCH, DELETE across different route families", async () => {
    // Verifies the blanket preHandler rejects writes regardless of route family.
    // Sample one route per method from different taxonomies:
    //   POST /shares (narrow taxonomy — sharing write)
    //   DELETE /admin/users/:id (admin-plane write)
    //   PATCH /profile (narrow taxonomy — identity write, already covered but re-asserted here for parity)
    const sessionCookieValue = signSessionCookie(
      adminUserId,
      testOAuthConfig.sessionSecret,
      await currentSessionVersion(app, adminUserId),
    );
    const impersonationCookieValue = signImpersonationCookie(
      adminUserId,
      targetUserId,
      Date.now() + 60_000,
      testOAuthConfig.sessionSecret,
    );
    const cookie = cookieHeader(sessionCookieValue, impersonationCookieValue);

    // POST /shares — sharing grant write
    const postShares = await app.inject({
      method: "POST",
      url: "/shares",
      headers: { cookie },
      payload: { email: "somebody@example.com" },
    });
    expect(postShares.statusCode).toBe(403);
    expect(postShares.json().error).toBe("impersonation_write_blocked");

    // DELETE /admin/users/:id — admin-plane write (target user would be a different innocent user;
    // we expect the request to be blocked BEFORE it reaches the admin handler)
    const deleteAdminUser = await app.inject({
      method: "DELETE",
      url: `/admin/users/${targetUserId}`,
      headers: { cookie },
    });
    expect(deleteAdminUser.statusCode).toBe(403);
    expect(deleteAdminUser.json().error).toBe("impersonation_write_blocked");

    // PATCH /profile — narrow taxonomy identity write
    const patchProfile = await app.inject({
      method: "PATCH",
      url: "/profile",
      headers: { cookie },
      payload: { email: "blocked-taxonomy@example.com" },
    });
    expect(patchProfile.statusCode).toBe(403);
    expect(patchProfile.json().error).toBe("impersonation_write_blocked");

    // Sanity: the allowlisted DELETE /admin/impersonation IS permitted while impersonating.
    const allowlistedExit = await app.inject({
      method: "DELETE",
      url: "/admin/impersonation",
      headers: { cookie },
    });
    expect(allowlistedExit.statusCode).toBe(204);

    // Every blocked attempt emitted an audit row.
    const auditLog = await app.persistence.listAuditLog({
      page: 1,
      limit: 50,
      actions: ["impersonation_blocked_write"],
    });
    const methods = auditLog.items
      .filter((entry) => entry.targetUserId === targetUserId)
      .map((entry) => entry.metadata.method);
    expect(methods).toContain("POST");
    expect(methods).toContain("DELETE");
    expect(methods).toContain("PATCH");
  });

  it("cannot impersonate yourself", async () => {
    const sessionCookieValue = signSessionCookie(
      adminUserId,
      testOAuthConfig.sessionSecret,
      await currentSessionVersion(app, adminUserId),
    );

    const response = await app.inject({
      method: "POST",
      url: `/admin/users/${adminUserId}/impersonate`,
      headers: {
        cookie: cookieHeader(sessionCookieValue),
      },
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("cannot_impersonate_self");
  });

  it("demo sessions are blocked from impersonating even if the demo user is admin", async () => {
    const demoAdminUserId = await createUser(
      app,
      "demo-admin@example.com",
      "Demo Admin",
      "admin",
      "demo",
    );
    const demoCookieValue = signSessionCookie(
      demoAdminUserId,
      testOAuthConfig.sessionSecret,
      true,
    );

    const response = await app.inject({
      method: "POST",
      url: `/admin/users/${targetUserId}/impersonate`,
      headers: {
        cookie: cookieHeader(demoCookieValue),
      },
      payload: {},
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error).toBe("demo_cannot_impersonate");
  });

  it("cookie with mismatched adminId auto-exits with session_mismatch and clears cookie", async () => {
    // Scenario: a cookie minted for admin A is paired with admin B's session (e.g. stolen/leaked cookie
    // or stale browser state after a session swap). adminId !== sessionUserId → reject, clear, audit.
    const secondAdminUserId = await createUser(app, "imp-admin-2@example.com", "Second Admin", "admin");
    const secondAdminSessionCookie = signSessionCookie(
      secondAdminUserId,
      testOAuthConfig.sessionSecret,
      await currentSessionVersion(app, secondAdminUserId),
    );
    // Cookie was minted for adminUserId (first admin), but the request carries the second admin's session.
    const mismatchedImpersonationCookie = signImpersonationCookie(
      adminUserId,
      targetUserId,
      Date.now() + 60_000,
      testOAuthConfig.sessionSecret,
    );

    const response = await app.inject({
      method: "GET",
      url: "/settings",
      headers: {
        cookie: cookieHeader(secondAdminSessionCookie, mismatchedImpersonationCookie),
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().userId).toBe(secondAdminUserId);
    expect(setCookieHeaderValue({ headers: response.headers as Record<string, string | string[] | undefined> })).toContain(`${IMPERSONATION_COOKIE_NAME}=;`);

    const auditLog = await app.persistence.listAuditLog({
      page: 1,
      limit: 20,
      actions: ["impersonation_end"],
    });
    const auditEntry = auditLog.items.find((entry) => entry.metadata.reason === "session_mismatch");
    expect(auditEntry).toBeDefined();
    expect(auditEntry?.actorUserId).toBe(secondAdminUserId);
    expect(auditEntry?.targetUserId).toBe(targetUserId);
  });

  it("cookie with tampered HMAC auto-exits with invalid_hmac and clears cookie", async () => {
    const sessionCookieValue = signSessionCookie(
      adminUserId,
      testOAuthConfig.sessionSecret,
      await currentSessionVersion(app, adminUserId),
    );
    const validCookie = signImpersonationCookie(
      adminUserId,
      targetUserId,
      Date.now() + 60_000,
      testOAuthConfig.sessionSecret,
    );
    // Flip the final HMAC character — still 4 parts, valid length, but HMAC no longer verifies.
    const tamperedCookie = validCookie.slice(0, -1) + (validCookie.endsWith("0") ? "1" : "0");

    const response = await app.inject({
      method: "GET",
      url: "/settings",
      headers: {
        cookie: cookieHeader(sessionCookieValue, tamperedCookie),
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().userId).toBe(adminUserId);
    expect(setCookieHeaderValue({ headers: response.headers as Record<string, string | string[] | undefined> })).toContain(`${IMPERSONATION_COOKIE_NAME}=;`);

    const auditLog = await app.persistence.listAuditLog({
      page: 1,
      limit: 20,
      actions: ["impersonation_end"],
    });
    const auditEntry = auditLog.items.find((entry) => entry.metadata.reason === "invalid_hmac");
    expect(auditEntry).toBeDefined();
    expect(auditEntry?.actorUserId).toBe(adminUserId);
  });

  it("cookie whose target has been deactivated auto-exits with target_invalid and clears cookie", async () => {
    const sessionCookieValue = signSessionCookie(
      adminUserId,
      testOAuthConfig.sessionSecret,
      await currentSessionVersion(app, adminUserId),
    );
    const impersonationCookieValue = signImpersonationCookie(
      adminUserId,
      targetUserId,
      Date.now() + 60_000,
      testOAuthConfig.sessionSecret,
    );
    // Deactivate the target after cookie was minted.
    await app.persistence.disableUser(targetUserId, { actorUserId: adminUserId });

    const response = await app.inject({
      method: "GET",
      url: "/settings",
      headers: {
        cookie: cookieHeader(sessionCookieValue, impersonationCookieValue),
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().userId).toBe(adminUserId);
    expect(setCookieHeaderValue({ headers: response.headers as Record<string, string | string[] | undefined> })).toContain(`${IMPERSONATION_COOKIE_NAME}=;`);

    const auditLog = await app.persistence.listAuditLog({
      page: 1,
      limit: 20,
      actions: ["impersonation_end"],
    });
    const auditEntry = auditLog.items.find((entry) => entry.metadata.reason === "target_invalid");
    expect(auditEntry).toBeDefined();
    expect(auditEntry?.actorUserId).toBe(adminUserId);
    expect(auditEntry?.targetUserId).toBe(targetUserId);
  });

  it("re-impersonating while active emits impersonation_end{replaced} + fresh impersonation_start", async () => {
    const secondTargetUserId = await createUser(app, "imp-target-2@example.com", "Impersonation Target 2", "member");
    const sessionCookieValue = signSessionCookie(
      adminUserId,
      testOAuthConfig.sessionSecret,
      await currentSessionVersion(app, adminUserId),
    );
    const activeImpersonationCookieValue = signImpersonationCookie(
      adminUserId,
      targetUserId,
      Date.now() + 60_000,
      testOAuthConfig.sessionSecret,
    );

    const response = await app.inject({
      method: "POST",
      url: `/admin/users/${secondTargetUserId}/impersonate`,
      headers: {
        cookie: cookieHeader(sessionCookieValue, activeImpersonationCookieValue),
      },
      payload: {},
    });

    expect(response.statusCode).toBe(200);

    const auditLog = await app.persistence.listAuditLog({
      page: 1,
      limit: 20,
      actions: ["impersonation_end", "impersonation_start"],
    });
    const replacedEnd = auditLog.items.find(
      (entry) =>
        entry.action === "impersonation_end"
        && entry.metadata.reason === "replaced"
        && entry.targetUserId === targetUserId,
    );
    const freshStart = auditLog.items.find(
      (entry) =>
        entry.action === "impersonation_start"
        && entry.targetUserId === secondTargetUserId,
    );
    expect(replacedEnd).toBeDefined();
    expect(freshStart).toBeDefined();
  });
});
