import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../src/app.js";
import { MemoryPersistence } from "../../src/persistence/memory.js";
import type { OAuthClaims } from "../../src/persistence/types.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

const testOAuthConfig = {
  clientId: "test-client-id",
  clientSecret: "test-client-secret",
  redirectUri: "http://localhost:4000/auth/google/callback",
  sessionSecret: "test-session-secret-that-is-long-enough-32chars!!",
};

const adminHeaders = { "x-user-id": "user-1", "x-user-role": "admin" };

const aliceClaims: OAuthClaims = { email: "alice@example.com", name: "Alice Chen" };
const bobClaims: OAuthClaims = { email: "bob@example.com", name: "Bob Smith" };
const carolClaims: OAuthClaims = { email: "carol@example.com", name: "Carol Danvers" };

// Cast helper to inspect memory backend internals
function getAuditLog(persistence: MemoryPersistence) {
  return (persistence as unknown as { auditLog: Array<{ action: string; targetUserId: string | null; metadata: Record<string, unknown> }> }).auditLog;
}

// ── Persistence Method Tests ─────────────────────────────────────────────────

describe("changeUserRole", () => {
  let persistence: MemoryPersistence;
  let targetUserId: string;

  beforeEach(async () => {
    persistence = new MemoryPersistence();
    await persistence.init();
    const { userId } = await persistence.resolveOrCreateUser("google", "target-sub", aliceClaims);
    targetUserId = userId;
  });

  afterEach(async () => {
    await persistence.close();
  });

  it("changeUserRole: member → admin → role updated and returned", async () => {
    const result = await persistence.changeUserRole(targetUserId, "admin", { actorUserId: "actor-1" });
    expect(result.role).toBe("admin");
  });

  it("changeUserRole: returns updated AuthUserRecord with new role", async () => {
    const result = await persistence.changeUserRole(targetUserId, "viewer", { actorUserId: "actor-1" });
    expect(result.userId).toBe(targetUserId);
    expect(result.role).toBe("viewer");
    expect(result.email).toBe("alice@example.com");
  });

  it("changeUserRole: writes audit entry with {fromRole, toRole} metadata", async () => {
    await persistence.changeUserRole(targetUserId, "admin", { actorUserId: "actor-1" });

    const log = getAuditLog(persistence);
    const entry = log.find((e) => e.action === "admin_role_change" && e.targetUserId === targetUserId);
    expect(entry).toBeDefined();
    expect(entry!.metadata.fromRole).toBe("member");
    expect(entry!.metadata.toRole).toBe("admin");
    expect(entry!.metadata.targetEmail).toBe("alice@example.com");
  });
});

describe("disableUser / enableUser", () => {
  let persistence: MemoryPersistence;
  let targetUserId: string;

  beforeEach(async () => {
    persistence = new MemoryPersistence();
    await persistence.init();
    const { userId } = await persistence.resolveOrCreateUser("google", "target-sub", aliceClaims);
    targetUserId = userId;
  });

  afterEach(async () => {
    await persistence.close();
  });

  it("disableUser: sets deactivated_at to non-null timestamp", async () => {
    await persistence.disableUser(targetUserId, { actorUserId: "actor-1" });
    const user = await persistence.getAuthUserById(targetUserId);
    expect(user!.deactivatedAt).not.toBeNull();
  });

  it("disableUser: bumps session_version", async () => {
    const before = (await persistence.getAuthUserById(targetUserId))!.sessionVersion;
    await persistence.disableUser(targetUserId, { actorUserId: "actor-1" });
    const after = (await persistence.getAuthUserById(targetUserId))!.sessionVersion;
    expect(after).toBe(before + 1);
  });

  it("disableUser: emits admin_disable_user + session_force_logout audit entries", async () => {
    await persistence.disableUser(targetUserId, { actorUserId: "actor-1" });

    const log = getAuditLog(persistence);
    const disableEntry = log.find((e) => e.action === "admin_disable_user" && e.targetUserId === targetUserId);
    const logoutEntry = log.find((e) => e.action === "session_force_logout" && e.targetUserId === targetUserId);

    expect(disableEntry).toBeDefined();
    expect(disableEntry!.metadata.targetEmail).toBe("alice@example.com");
    expect(logoutEntry).toBeDefined();
    expect(logoutEntry!.metadata.reason).toBe("admin_disable_user");
  });

  it("enableUser: clears deactivated_at to null", async () => {
    await persistence.disableUser(targetUserId, { actorUserId: "actor-1" });
    await persistence.enableUser(targetUserId, { actorUserId: "actor-1" });
    const user = await persistence.getAuthUserById(targetUserId);
    expect(user!.deactivatedAt).toBeNull();
  });

  it("enableUser: does NOT bump session_version", async () => {
    await persistence.disableUser(targetUserId, { actorUserId: "actor-1" });
    const afterDisable = (await persistence.getAuthUserById(targetUserId))!.sessionVersion;
    await persistence.enableUser(targetUserId, { actorUserId: "actor-1" });
    const afterEnable = (await persistence.getAuthUserById(targetUserId))!.sessionVersion;
    expect(afterEnable).toBe(afterDisable);
  });

  it("enableUser: emits admin_enable_user audit entry only (no session_force_logout)", async () => {
    await persistence.disableUser(targetUserId, { actorUserId: "actor-1" });
    // Clear audit log entries from disable to isolate enable
    const log = getAuditLog(persistence);
    const countBefore = log.length;

    await persistence.enableUser(targetUserId, { actorUserId: "actor-1" });

    const newEntries = log.slice(countBefore);
    expect(newEntries).toHaveLength(1);
    expect(newEntries[0].action).toBe("admin_enable_user");
    expect(newEntries.find((e) => e.action === "session_force_logout")).toBeUndefined();
  });
});

describe("softDeleteUser", () => {
  let persistence: MemoryPersistence;
  let targetUserId: string;

  beforeEach(async () => {
    persistence = new MemoryPersistence();
    await persistence.init();
    const { userId } = await persistence.resolveOrCreateUser("google", "target-sub", aliceClaims);
    targetUserId = userId;
  });

  afterEach(async () => {
    await persistence.close();
  });

  it("softDeleteUser: sets deleted_at to non-null timestamp", async () => {
    await persistence.softDeleteUser(targetUserId, { actorUserId: "actor-1" });
    const user = await persistence.getAuthUserById(targetUserId);
    expect(user!.deletedAt).not.toBeNull();
  });

  it("softDeleteUser: bumps session_version", async () => {
    const before = (await persistence.getAuthUserById(targetUserId))!.sessionVersion;
    await persistence.softDeleteUser(targetUserId, { actorUserId: "actor-1" });
    const after = (await persistence.getAuthUserById(targetUserId))!.sessionVersion;
    expect(after).toBe(before + 1);
  });

  it("softDeleteUser: emits admin_delete_user + session_force_logout audit entries", async () => {
    await persistence.softDeleteUser(targetUserId, { actorUserId: "actor-1" });

    const log = getAuditLog(persistence);
    const deleteEntry = log.find((e) => e.action === "admin_delete_user" && e.targetUserId === targetUserId);
    const logoutEntry = log.find(
      (e) => e.action === "session_force_logout" && e.targetUserId === targetUserId && e.metadata.reason === "admin_delete_user",
    );

    expect(deleteEntry).toBeDefined();
    expect(deleteEntry!.metadata.targetEmail).toBe("alice@example.com");
    expect(logoutEntry).toBeDefined();
  });
});

describe("hardPurgeUser — memory backend", () => {
  let persistence: MemoryPersistence;
  let targetUserId: string;

  beforeEach(async () => {
    persistence = new MemoryPersistence();
    await persistence.init();
    const { userId } = await persistence.resolveOrCreateUser("google", "target-sub", aliceClaims);
    targetUserId = userId;
  });

  afterEach(async () => {
    await persistence.close();
  });

  it("hardPurgeUser: removes user row entirely (getAuthUserById returns null)", async () => {
    await persistence.hardPurgeUser(targetUserId, { actorUserId: "actor-1" });
    const user = await persistence.getAuthUserById(targetUserId);
    expect(user).toBeNull();
  });

  it("hardPurgeUser: emits admin_hard_purge_user + session_force_logout with {targetEmail, targetDisplayName}", async () => {
    await persistence.hardPurgeUser(targetUserId, { actorUserId: "actor-1" });

    const log = getAuditLog(persistence);
    const purgeEntry = log.find((e) => e.action === "admin_hard_purge_user");
    const logoutEntry = log.find((e) => e.action === "session_force_logout" && e.metadata.reason === "admin_hard_purge_user");

    expect(purgeEntry).toBeDefined();
    expect(purgeEntry!.metadata.targetEmail).toBe("alice@example.com");
    expect(purgeEntry!.metadata.targetDisplayName).toBe("Alice Chen");
    expect(logoutEntry).toBeDefined();
  });

  it("hardPurgeUser: audit entries survive after user deletion (metadata self-contained)", async () => {
    await persistence.hardPurgeUser(targetUserId, { actorUserId: "actor-1" });

    // User is gone, but audit log entries still have the email in metadata
    const log = getAuditLog(persistence);
    const purgeEntry = log.find((e) => e.action === "admin_hard_purge_user");
    expect(purgeEntry).toBeDefined();
    expect(purgeEntry!.metadata.targetEmail).toBe("alice@example.com");
    // FKs are set to null after deletion
    expect(purgeEntry!.targetUserId).toBeNull();
  });

  it("hardPurgeUser: portfolioShares — owner purged → row deleted", async () => {
    // Arrange
    const { userId: granteeId } = await persistence.resolveOrCreateUser("google", "grantee-sub", bobClaims);
    await persistence.createShareGrant({ ownerUserId: targetUserId, granteeUserId: granteeId, auditInput: { actorUserId: "actor-1" } });
    // Act
    await persistence.hardPurgeUser(targetUserId, { actorUserId: "actor-1" });
    // Assert — from grantee's perspective (listSharesForOwner(purgedId) throws 404)
    const inbound = await persistence.listInboundSharesForGrantee(granteeId);
    expect(inbound.active).toEqual([]);
    expect(inbound.revoked).toEqual([]);
  });

  it("hardPurgeUser: portfolioShares — grantee purged → row deleted", async () => {
    // Arrange
    const { userId: granteeId } = await persistence.resolveOrCreateUser("google", "grantee-sub", bobClaims);
    await persistence.createShareGrant({ ownerUserId: targetUserId, granteeUserId: granteeId, auditInput: { actorUserId: "actor-1" } });
    // Act — purge the grantee
    await persistence.hardPurgeUser(granteeId, { actorUserId: "actor-1" });
    // Assert — from owner's perspective (listInboundSharesForGrantee(purgedId) throws 404)
    const outbound = await persistence.listSharesForOwner(targetUserId);
    expect(outbound.active).toEqual([]);
    expect(outbound.revoked).toEqual([]);
  });

  it("hardPurgeUser: anonymousShareTokens — owner purged → row deleted", async () => {
    // Arrange
    const tokenResult = await persistence.createAnonymousShareToken({
      ownerUserId: targetUserId,
      token: "testTokenXyzABC0123456",
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      ttlDays: 7,
      auditInput: { actorUserId: "actor-1" },
    });
    expect(tokenResult.status).toBe("ok");
    // Act
    await persistence.hardPurgeUser(targetUserId, { actorUserId: "actor-1" });
    // Assert
    const found = await persistence.findActiveAnonymousShareTokenByToken("testTokenXyzABC0123456");
    expect(found).toBeNull();
  });
});

describe("hasActiveJobs", () => {
  let persistence: MemoryPersistence;

  beforeEach(async () => {
    persistence = new MemoryPersistence();
    await persistence.init();
  });

  afterEach(async () => {
    await persistence.close();
  });

  it("hasActiveJobs: memory backend always returns false", async () => {
    const result = await persistence.hasActiveJobs("any-user-id");
    expect(result).toBe(false);
  });
});

describe("countActiveAdmins", () => {
  let persistence: MemoryPersistence;

  beforeEach(async () => {
    persistence = new MemoryPersistence();
    await persistence.init();
  });

  afterEach(async () => {
    await persistence.close();
  });

  it("countActiveAdmins: counts only active admin-role users", async () => {
    const { userId: u1 } = await persistence.resolveOrCreateUser("google", "admin-sub-1", aliceClaims);
    await persistence.changeUserRole(u1, "admin", { actorUserId: "system" });
    const { userId: u2 } = await persistence.resolveOrCreateUser("google", "admin-sub-2", bobClaims);
    await persistence.changeUserRole(u2, "admin", { actorUserId: "system" });
    // member user — should not count
    await persistence.resolveOrCreateUser("google", "member-sub", carolClaims);

    const count = await persistence.countActiveAdmins();
    expect(count).toBe(2);
  });

  it("countActiveAdmins: excludes deactivated admins", async () => {
    // Create two admins so disabling one doesn't hit the last-admin guard
    const { userId: u1 } = await persistence.resolveOrCreateUser("google", "admin-sub-1", aliceClaims);
    await persistence.changeUserRole(u1, "admin", { actorUserId: "system" });
    const { userId: u2 } = await persistence.resolveOrCreateUser("google", "admin-sub-2", bobClaims);
    await persistence.changeUserRole(u2, "admin", { actorUserId: "system" });

    await persistence.disableUser(u1, { actorUserId: "system" });

    const count = await persistence.countActiveAdmins();
    // u1 disabled, u2 still active → 1
    expect(count).toBe(1);
  });

  it("countActiveAdmins: excludes soft-deleted admins", async () => {
    // Create two admins so deleting one doesn't hit the last-admin guard
    const { userId: u1 } = await persistence.resolveOrCreateUser("google", "admin-sub-1", aliceClaims);
    await persistence.changeUserRole(u1, "admin", { actorUserId: "system" });
    const { userId: u2 } = await persistence.resolveOrCreateUser("google", "admin-sub-2", bobClaims);
    await persistence.changeUserRole(u2, "admin", { actorUserId: "system" });

    await persistence.softDeleteUser(u1, { actorUserId: "system" });

    const count = await persistence.countActiveAdmins();
    // u1 deleted, u2 still active → 1
    expect(count).toBe(1);
  });

  it("countActiveAdmins: returns 0 when no admins exist", async () => {
    await persistence.resolveOrCreateUser("google", "member-sub", aliceClaims);
    const count = await persistence.countActiveAdmins();
    expect(count).toBe(0);
  });
});

// ── Route Handler Tests (app.inject) ─────────────────────────────────────────

describe("PATCH /admin/users/:id/role — route handler", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let targetUserId: string;

  beforeEach(async () => {
    app = await buildApp({ persistenceBackend: "memory", oauthConfig: testOAuthConfig });
    // Create admin user (the actor)
    const admin = await app.persistence.resolveOrCreateUser("google", "admin-sub", {
      email: "admin@example.com",
      name: "Admin",
    });
    await app.persistence.changeUserRole(admin.userId, "admin", { actorUserId: "system" });
    // Override admin-1 to match the header user-id
    // In dev_bypass, x-user-id is used directly
    const target = await app.persistence.resolveOrCreateUser("google", "target-sub", aliceClaims);
    targetUserId = target.userId;
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it("role change: admin changes member to viewer → 200", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/admin/users/${targetUserId}/role`,
      headers: adminHeaders,
      payload: { role: "viewer" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().role).toBe("viewer");
  });

  it("role change: admin → member emits admin_role_change + session_force_logout", async () => {
    // Create a second admin to demote (need 2 admins to avoid last-admin block)
    const second = await app.persistence.resolveOrCreateUser("google", "second-admin-sub", bobClaims);
    await app.persistence.changeUserRole(second.userId, "admin", { actorUserId: "system" });

    const logBefore = getAuditLog(app.persistence as MemoryPersistence).length;

    const res = await app.inject({
      method: "PATCH",
      url: `/admin/users/${second.userId}/role`,
      headers: adminHeaders,
      payload: { role: "member" },
    });
    expect(res.statusCode).toBe(200);

    const newEntries = getAuditLog(app.persistence as MemoryPersistence).slice(logBefore);
    const roleEntry = newEntries.find((e) => e.action === "admin_role_change" && e.targetUserId === second.userId);
    const logoutEntry = newEntries.find((e) => e.action === "session_force_logout" && e.targetUserId === second.userId);

    expect(roleEntry).toBeDefined();
    expect(roleEntry!.metadata.fromRole).toBe("admin");
    expect(roleEntry!.metadata.toRole).toBe("member");
    // session_force_logout is expected per spec when removing admin role
    expect(logoutEntry).toBeDefined();
  });

  it("role change: member → admin does NOT emit session_force_logout", async () => {
    const logBefore = getAuditLog(app.persistence as MemoryPersistence).length;

    const res = await app.inject({
      method: "PATCH",
      url: `/admin/users/${targetUserId}/role`,
      headers: adminHeaders,
      payload: { role: "admin" },
    });
    expect(res.statusCode).toBe(200);

    const newEntries = getAuditLog(app.persistence as MemoryPersistence).slice(logBefore);
    expect(newEntries.find((e) => e.action === "session_force_logout")).toBeUndefined();
  });
});

describe("POST /admin/users/:id/disable", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let targetUserId: string;

  beforeEach(async () => {
    app = await buildApp({ persistenceBackend: "memory", oauthConfig: testOAuthConfig });
    const target = await app.persistence.resolveOrCreateUser("google", "target-sub", aliceClaims);
    targetUserId = target.userId;
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it("disable: admin disables active member → 200", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/admin/users/${targetUserId}/disable`,
      headers: adminHeaders,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("ok");
  });
});

describe("POST /admin/users/:id/enable", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let targetUserId: string;

  beforeEach(async () => {
    app = await buildApp({ persistenceBackend: "memory", oauthConfig: testOAuthConfig });
    const target = await app.persistence.resolveOrCreateUser("google", "target-sub", aliceClaims);
    targetUserId = target.userId;
    // Disable first so we can enable
    await app.persistence.disableUser(targetUserId, { actorUserId: "system" });
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it("enable: admin enables disabled member → 200", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/admin/users/${targetUserId}/enable`,
      headers: adminHeaders,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("ok");
  });
});

describe("DELETE /admin/users/:id — soft delete", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let targetUserId: string;

  beforeEach(async () => {
    app = await buildApp({ persistenceBackend: "memory", oauthConfig: testOAuthConfig });
    const target = await app.persistence.resolveOrCreateUser("google", "target-sub", aliceClaims);
    targetUserId = target.userId;
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it("soft delete: admin deletes member → 200", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/admin/users/${targetUserId}`,
      headers: adminHeaders,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("ok");
  });
});

describe("DELETE /admin/users/:id/purge — hard purge", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let targetUserId: string;

  beforeEach(async () => {
    app = await buildApp({ persistenceBackend: "memory", oauthConfig: testOAuthConfig });
    const target = await app.persistence.resolveOrCreateUser("google", "target-sub", aliceClaims);
    targetUserId = target.userId;
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it("hard purge: valid confirmation → 204", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/admin/users/${targetUserId}/purge`,
      headers: adminHeaders,
      payload: {
        confirmation: "PURGE alice@example.com",
        adminEmail: "user-1@placeholder.local",
      },
    });
    expect(res.statusCode).toBe(204);
  });

  it("hard purge: mismatched confirmation string → 400", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/admin/users/${targetUserId}/purge`,
      headers: adminHeaders,
      payload: {
        confirmation: "PURGE wrong@example.com",
        adminEmail: "user-1@placeholder.local",
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid_confirmation");
  });

  it("hard purge: mismatched admin email → 400", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/admin/users/${targetUserId}/purge`,
      headers: adminHeaders,
      payload: {
        confirmation: "PURGE alice@example.com",
        adminEmail: "wrong-admin@example.com",
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid_admin_email");
  });

  it("hard purge: missing confirmation body → 400", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/admin/users/${targetUserId}/purge`,
      headers: adminHeaders,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("self-operation block — 403 on all admin endpoints", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    app = await buildApp({ persistenceBackend: "memory", oauthConfig: testOAuthConfig });
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  // In dev_bypass mode, x-user-id IS the sessionUserId.
  // When target :id === x-user-id, self-operation block fires.
  const selfId = "user-1";
  const selfHeaders = { "x-user-id": selfId, "x-user-role": "admin" };

  const selfTargetedRoutes: Array<{ method: "PATCH" | "POST" | "DELETE"; path: string; payload?: Record<string, unknown> }> = [
    { method: "PATCH", path: `/admin/users/${selfId}/role`, payload: { role: "member" } },
    { method: "POST", path: `/admin/users/${selfId}/disable` },
    { method: "POST", path: `/admin/users/${selfId}/enable` },
    { method: "DELETE", path: `/admin/users/${selfId}` },
    { method: "DELETE", path: `/admin/users/${selfId}/purge`, payload: { confirmation: "PURGE x", adminEmail: "x@x.com" } },
  ];

  for (const route of selfTargetedRoutes) {
    it(`self-operation: ${route.method} ${route.path} → 403 self_operation_blocked`, async () => {
      const res = await app.inject({
        method: route.method,
        url: route.path,
        headers: selfHeaders,
        payload: route.payload,
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toBe("self_operation_blocked");
    });
  }
});

describe("last-admin block — 409 on role/disable/delete/purge", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let soleAdminUserId: string;

  beforeEach(async () => {
    app = await buildApp({ persistenceBackend: "memory", oauthConfig: testOAuthConfig });
    // Create sole admin first (2 admins total: user-1 + alice)
    const admin = await app.persistence.resolveOrCreateUser("google", "sole-admin-sub", aliceClaims);
    soleAdminUserId = admin.userId;
    await app.persistence.changeUserRole(soleAdminUserId, "admin", { actorUserId: "system" });
    // Now demote user-1 (2 admins → 1 admin: alice is the sole admin)
    // (x-user-role header override still grants admin access for the request)
    await app.persistence.changeUserRole("user-1", "member", { actorUserId: "system" });
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it("last-admin: demoting sole admin → 409 last_admin_blocked", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/admin/users/${soleAdminUserId}/role`,
      headers: adminHeaders,
      payload: { role: "member" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("last_admin_blocked");
  });

  it("last-admin: disabling sole admin → 409 last_admin_blocked", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/admin/users/${soleAdminUserId}/disable`,
      headers: adminHeaders,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("last_admin_blocked");
  });

  it("last-admin: soft-deleting sole admin → 409 last_admin_blocked", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/admin/users/${soleAdminUserId}`,
      headers: adminHeaders,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("last_admin_blocked");
  });

  it("last-admin: hard-purging sole admin → 409 last_admin_blocked", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/admin/users/${soleAdminUserId}/purge`,
      headers: adminHeaders,
      payload: {
        confirmation: "PURGE alice@example.com",
        adminEmail: "user-1@placeholder.local",
      },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("last_admin_blocked");
  });

  it("last-admin: demoting admin when 2 admins exist → 200 (not blocked)", async () => {
    // Create second admin
    const second = await app.persistence.resolveOrCreateUser("google", "second-sub", bobClaims);
    await app.persistence.changeUserRole(second.userId, "admin", { actorUserId: "system" });

    const res = await app.inject({
      method: "PATCH",
      url: `/admin/users/${soleAdminUserId}/role`,
      headers: adminHeaders,
      payload: { role: "member" },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe("GET /profile includes role field", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    app = await buildApp({ persistenceBackend: "memory", oauthConfig: testOAuthConfig });
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it("GET /profile → response includes role field", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/profile",
      headers: { "x-user-id": "user-1" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty("role");
  });
});

describe("audit metadata enrichment", () => {
  let persistence: MemoryPersistence;
  let targetUserId: string;

  beforeEach(async () => {
    persistence = new MemoryPersistence();
    await persistence.init();
    const { userId } = await persistence.resolveOrCreateUser("google", "target-sub", aliceClaims);
    targetUserId = userId;
  });

  afterEach(async () => {
    await persistence.close();
  });

  it("all admin actions include targetEmail in metadata", async () => {
    const auditInput = { actorUserId: "actor-1", ipAddress: "127.0.0.1" };

    // Perform several admin actions
    await persistence.changeUserRole(targetUserId, "viewer", auditInput);
    await persistence.disableUser(targetUserId, auditInput);
    await persistence.enableUser(targetUserId, auditInput);
    await persistence.softDeleteUser(targetUserId, auditInput);

    const log = getAuditLog(persistence);
    const adminActions = log.filter((e) =>
      ["admin_role_change", "admin_disable_user", "admin_enable_user", "admin_delete_user"].includes(e.action),
    );

    for (const entry of adminActions) {
      expect(entry.metadata.targetEmail, `${entry.action} should include targetEmail`).toBe("alice@example.com");
    }
  });

  it("hardPurgeUser includes targetEmail and targetDisplayName in metadata", async () => {
    await persistence.hardPurgeUser(targetUserId, { actorUserId: "actor-1" });

    const log = getAuditLog(persistence);
    const purgeEntry = log.find((e) => e.action === "admin_hard_purge_user");
    expect(purgeEntry!.metadata.targetEmail).toBe("alice@example.com");
    expect(purgeEntry!.metadata.targetDisplayName).toBe("Alice Chen");
  });
});

describe("hard-purge blocked when active jobs exist — 409", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let targetUserId: string;

  // dev_bypass seeds user-1 with email user-1@placeholder.local and admin role
  const devBypassAdminHeaders = { "x-user-id": "user-1", "x-user-role": "admin" };
  const devBypassAdminEmail = "user-1@placeholder.local";

  beforeEach(async () => {
    app = await buildApp({ persistenceBackend: "memory", oauthConfig: testOAuthConfig });
    const target = await app.persistence.resolveOrCreateUser("google", "target-sub", aliceClaims);
    targetUserId = target.userId;
  });

  afterEach(async () => {
    if (app) await app.close();
    vi.restoreAllMocks();
  });

  it("hard purge: active jobs → 409 active_jobs_blocked", async () => {
    // Stub hasActiveJobs to return true (memory backend always returns false)
    vi.spyOn(app.persistence, "hasActiveJobs").mockResolvedValue(true);

    const res = await app.inject({
      method: "DELETE",
      url: `/admin/users/${targetUserId}/purge`,
      headers: devBypassAdminHeaders,
      payload: {
        confirmation: "PURGE alice@example.com",
        adminEmail: devBypassAdminEmail,
      },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("active_jobs_blocked");
  });

  it("hard purge: no active jobs → 204 (proceeds normally)", async () => {
    // Verify that without the stub (memory returns false), purge succeeds
    const res = await app.inject({
      method: "DELETE",
      url: `/admin/users/${targetUserId}/purge`,
      headers: devBypassAdminHeaders,
      payload: {
        confirmation: "PURGE alice@example.com",
        adminEmail: devBypassAdminEmail,
      },
    });
    expect(res.statusCode).toBe(204);
  });
});

describe("admin GET endpoints — role enforcement", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    app = await buildApp({ persistenceBackend: "memory", oauthConfig: testOAuthConfig });
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  const memberHeaders = { "x-user-id": "user-1", "x-user-role": "member" };
  const viewerHeaders = { "x-user-id": "user-1", "x-user-role": "viewer" };

  const adminGetEndpoints = [
    "/admin/users",
    "/admin/invites",
    "/admin/audit-log",
  ];

  for (const endpoint of adminGetEndpoints) {
    it(`GET ${endpoint}: member → 403 admin_role_required`, async () => {
      const res = await app.inject({
        method: "GET",
        url: endpoint,
        headers: memberHeaders,
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toBe("admin_role_required");
    });

    it(`GET ${endpoint}: viewer → 403 admin_role_required`, async () => {
      const res = await app.inject({
        method: "GET",
        url: endpoint,
        headers: viewerHeaders,
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toBe("admin_role_required");
    });

    it(`GET ${endpoint}: admin → 200 (allowed)`, async () => {
      const res = await app.inject({
        method: "GET",
        url: endpoint,
        headers: adminHeaders,
      });
      expect(res.statusCode).toBe(200);
    });
  }
});
