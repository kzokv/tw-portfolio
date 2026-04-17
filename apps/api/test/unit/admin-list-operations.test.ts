import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryPersistence } from "../../src/persistence/memory.js";
import type { OAuthClaims } from "../../src/persistence/types.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

const aliceClaims: OAuthClaims = { email: "alice@example.com", name: "Alice Chen" };
const bobClaims: OAuthClaims = { email: "bob@example.com", name: "Bob Smith" };
const carolClaims: OAuthClaims = { email: "carol@example.com", name: "Carol Danvers" };
const daveClaims: OAuthClaims = { email: "dave@example.com", name: "Dave Wilson" };
const eveClaims: OAuthClaims = { email: "eve@example.com", name: "Eve Torres" };

// ── listUsers ────────────────────────────────────────────────────────────────

describe("listUsers", () => {
  let persistence: MemoryPersistence;
  let aliceId: string;
  let carolId: string;
  let daveId: string;
  let eveId: string;

  beforeEach(async () => {
    persistence = new MemoryPersistence();
    await persistence.init();

    const alice = await persistence.resolveOrCreateUser("google", "alice-sub", aliceClaims);
    aliceId = alice.userId;
    await persistence.changeUserRole(aliceId, "admin", { actorUserId: "system" });

    await persistence.resolveOrCreateUser("google", "bob-sub", bobClaims);

    const carol = await persistence.resolveOrCreateUser("google", "carol-sub", carolClaims);
    carolId = carol.userId;
    await persistence.changeUserRole(carolId, "viewer", { actorUserId: "system" });

    const dave = await persistence.resolveOrCreateUser("google", "dave-sub", daveClaims);
    daveId = dave.userId;
    await persistence.disableUser(daveId, { actorUserId: "system" });

    const eve = await persistence.resolveOrCreateUser("google", "eve-sub", eveClaims);
    eveId = eve.userId;
    await persistence.softDeleteUser(eveId, { actorUserId: "system" });
  });

  afterEach(async () => {
    await persistence.close();
  });

  it("listUsers: returns paginated response with correct shape", async () => {
    const result = await persistence.listUsers({ page: 1, limit: 50 });
    expect(result).toHaveProperty("items");
    expect(result).toHaveProperty("total");
    expect(result).toHaveProperty("page");
    expect(result).toHaveProperty("limit");
    expect(Array.isArray(result.items)).toBe(true);
  });

  it("listUsers: page 1, limit 2 returns 2 items + correct total", async () => {
    // No status filter → returns all users including deleted: 5 (alice, bob, carol, dave, eve)
    const result = await persistence.listUsers({ page: 1, limit: 2 });
    expect(result.items).toHaveLength(2);
    expect(result.total).toBe(5);
    expect(result.page).toBe(1);
    expect(result.limit).toBe(2);
  });

  it("listUsers: page 2 returns remaining items", async () => {
    const result = await persistence.listUsers({ page: 2, limit: 2 });
    expect(result.items).toHaveLength(2);
    expect(result.total).toBe(5);
    expect(result.page).toBe(2);
  });

  it("listUsers: search by email substring (case-insensitive)", async () => {
    const result = await persistence.listUsers({ page: 1, limit: 50, search: "ALICE" });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].email).toBe("alice@example.com");
  });

  it("listUsers: search by display_name substring", async () => {
    const result = await persistence.listUsers({ page: 1, limit: 50, search: "Smith" });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].displayName).toBe("Bob Smith");
  });

  it("listUsers: filter by role=admin", async () => {
    const result = await persistence.listUsers({ page: 1, limit: 50, role: "admin" });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].role).toBe("admin");
  });

  it("listUsers: filter by status=active excludes disabled and deleted", async () => {
    const result = await persistence.listUsers({ page: 1, limit: 50, status: "active" });
    const statuses = result.items.map((i) => i.status);
    expect(statuses.every((s) => s === "active")).toBe(true);
    // Active users: alice, bob, carol (dave=disabled, eve=deleted)
    expect(result.items).toHaveLength(3);
  });

  it("listUsers: filter by status=disabled returns only deactivated users", async () => {
    const result = await persistence.listUsers({ page: 1, limit: 50, status: "disabled" });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].userId).toBe(daveId);
    expect(result.items[0].status).toBe("disabled");
  });

  it("listUsers: filter by status=deleted returns only soft-deleted users", async () => {
    const result = await persistence.listUsers({ page: 1, limit: 50, status: "deleted" });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].userId).toBe(eveId);
    expect(result.items[0].status).toBe("deleted");
  });

  it("listUsers: default sort is created_at DESC", async () => {
    const result = await persistence.listUsers({ page: 1, limit: 50 });
    const createdAts = result.items.map((i) => new Date(i.createdAt).getTime());
    for (let i = 0; i < createdAts.length - 1; i++) {
      expect(createdAts[i]).toBeGreaterThanOrEqual(createdAts[i + 1]);
    }
  });

  it("listUsers: items include correct status derivation from deactivated_at/deleted_at", async () => {
    // Fetch all users including deleted
    const result = await persistence.listUsers({ page: 1, limit: 50, status: "deleted" });
    const eveItem = result.items.find((i) => i.userId === eveId);
    expect(eveItem?.status).toBe("deleted");

    const disabledResult = await persistence.listUsers({ page: 1, limit: 50, status: "disabled" });
    const daveItem = disabledResult.items.find((i) => i.userId === daveId);
    expect(daveItem?.status).toBe("disabled");

    const activeResult = await persistence.listUsers({ page: 1, limit: 50, status: "active" });
    const aliceItem = activeResult.items.find((i) => i.userId === aliceId);
    expect(aliceItem?.status).toBe("active");
  });
});

// ── listInvites ──────────────────────────────────────────────────────────────

describe("listInvites", () => {
  let persistence: MemoryPersistence;
  let issuerId: string;

  beforeEach(async () => {
    persistence = new MemoryPersistence();
    await persistence.init();

    const issuer = await persistence.resolveOrCreateUser("google", "issuer-sub", aliceClaims);
    issuerId = issuer.userId;

    // Create invites with different statuses
    await persistence.createInvite({
      email: "pending@example.com",
      role: "member",
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      issuedByUserId: issuerId,
    });

    const usedInvite = await persistence.createInvite({
      email: "used@example.com",
      role: "viewer",
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      issuedByUserId: issuerId,
    });
    await persistence.consumeInvite(usedInvite.code, "used@example.com");

    const revokedInvite = await persistence.createInvite({
      email: "revoked@example.com",
      role: "admin",
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      issuedByUserId: issuerId,
    });
    await persistence.revokeInvite(revokedInvite.code);

    // Expired invite (expiresAt in the past)
    await persistence.createInvite({
      email: "expired@example.com",
      role: "member",
      expiresAt: new Date(Date.now() - 1_000).toISOString(),
      issuedByUserId: null,
    });
  });

  afterEach(async () => {
    await persistence.close();
  });

  it("listInvites: returns paginated response with correct shape", async () => {
    const result = await persistence.listInvites({ page: 1, limit: 50 });
    expect(result).toHaveProperty("items");
    expect(result).toHaveProperty("total");
    expect(result).toHaveProperty("page");
    expect(result).toHaveProperty("limit");
    expect(Array.isArray(result.items)).toBe(true);
  });

  it("listInvites: pagination respects page/limit", async () => {
    const result = await persistence.listInvites({ page: 1, limit: 2 });
    expect(result.items).toHaveLength(2);
    expect(result.total).toBe(4);
  });

  it("listInvites: filter by status=pending (not used, not revoked, not expired)", async () => {
    const result = await persistence.listInvites({ page: 1, limit: 50, status: "pending" });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].email).toBe("pending@example.com");
    expect(result.items[0].status).toBe("pending");
  });

  it("listInvites: filter by status=expired (past expiresAt)", async () => {
    const result = await persistence.listInvites({ page: 1, limit: 50, status: "expired" });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].email).toBe("expired@example.com");
  });

  it("listInvites: filter by status=used", async () => {
    const result = await persistence.listInvites({ page: 1, limit: 50, status: "used" });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].email).toBe("used@example.com");
  });

  it("listInvites: filter by status=revoked", async () => {
    const result = await persistence.listInvites({ page: 1, limit: 50, status: "revoked" });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].email).toBe("revoked@example.com");
  });

  it("listInvites: filter by email substring", async () => {
    const result = await persistence.listInvites({ page: 1, limit: 50, email: "pending" });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].email).toBe("pending@example.com");
  });

  it("listInvites: includes issuer info (issuedByEmail, issuedByDisplayName)", async () => {
    const result = await persistence.listInvites({ page: 1, limit: 50, status: "pending" });
    expect(result.items[0].issuedByEmail).toBe("alice@example.com");
    expect(result.items[0].issuedByDisplayName).toBe("Alice Chen");
  });

  it("listInvites: issuer fields are null when issuedByUserId is null", async () => {
    const result = await persistence.listInvites({ page: 1, limit: 50, status: "expired" });
    expect(result.items[0].issuedByEmail).toBeNull();
    expect(result.items[0].issuedByDisplayName).toBeNull();
  });
});

// ── listAuditLog ─────────────────────────────────────────────────────────────

describe("listAuditLog", () => {
  let persistence: MemoryPersistence;
  let actorId: string;
  let targetId: string;

  beforeEach(async () => {
    persistence = new MemoryPersistence();
    await persistence.init();

    const actor = await persistence.resolveOrCreateUser("google", "actor-sub", aliceClaims);
    actorId = actor.userId;
    const target = await persistence.resolveOrCreateUser("google", "target-sub", bobClaims);
    targetId = target.userId;

    // Create diverse audit entries
    await persistence.appendAuditLog({
      actorUserId: actorId,
      action: "admin_role_change",
      targetUserId: targetId,
      metadata: { fromRole: "member", toRole: "admin", targetEmail: "bob@example.com" },
    });
    await persistence.appendAuditLog({
      actorUserId: actorId,
      action: "admin_disable_user",
      targetUserId: targetId,
      metadata: { targetEmail: "bob@example.com" },
    });
    await persistence.appendAuditLog({
      actorUserId: actorId,
      action: "admin_enable_user",
      targetUserId: targetId,
      metadata: { targetEmail: "bob@example.com" },
    });
    await persistence.appendAuditLog({
      actorUserId: actorId,
      action: "admin_invite_issued",
      metadata: { targetEmail: "new@example.com", inviteCode: "ABCD1234", role: "member" },
    });
  });

  afterEach(async () => {
    await persistence.close();
  });

  it("listAuditLog: returns paginated response with correct shape", async () => {
    const result = await persistence.listAuditLog({ page: 1, limit: 50 });
    expect(result).toHaveProperty("items");
    expect(result).toHaveProperty("total");
    expect(result).toHaveProperty("page");
    expect(result).toHaveProperty("limit");
    expect(Array.isArray(result.items)).toBe(true);
  });

  it("listAuditLog: pagination respects page/limit", async () => {
    const result = await persistence.listAuditLog({ page: 1, limit: 2 });
    expect(result.items).toHaveLength(2);
    expect(result.total).toBe(4);
  });

  it("listAuditLog: filter by actorUserId", async () => {
    const result = await persistence.listAuditLog({ page: 1, limit: 50, actorUserId: actorId });
    expect(result.items.every((i) => i.actorUserId === actorId)).toBe(true);
    expect(result.total).toBe(4);
  });

  it("listAuditLog: filter by targetUserId", async () => {
    const result = await persistence.listAuditLog({ page: 1, limit: 50, targetUserId: targetId });
    // 3 entries target bob (role_change, disable, enable); invite targets null
    expect(result.items.every((i) => i.targetUserId === targetId)).toBe(true);
    expect(result.total).toBe(3);
  });

  it("listAuditLog: filter by single action type", async () => {
    const result = await persistence.listAuditLog({ page: 1, limit: 50, actions: ["admin_role_change"] });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].action).toBe("admin_role_change");
  });

  it("listAuditLog: filter by multiple actions", async () => {
    const result = await persistence.listAuditLog({
      page: 1,
      limit: 50,
      actions: ["admin_disable_user", "admin_enable_user"],
    });
    expect(result.items).toHaveLength(2);
    expect(result.items.every((i) => ["admin_disable_user", "admin_enable_user"].includes(i.action))).toBe(true);
  });

  it("listAuditLog: filter by fromDate / toDate range", async () => {
    const now = new Date();
    const pastDate = new Date(now.getTime() - 60_000).toISOString();
    const futureDate = new Date(now.getTime() + 60_000).toISOString();

    const result = await persistence.listAuditLog({ page: 1, limit: 50, fromDate: pastDate, toDate: futureDate });
    expect(result.total).toBe(4);

    // Far future range should return nothing
    const emptyResult = await persistence.listAuditLog({
      page: 1,
      limit: 50,
      fromDate: new Date(now.getTime() + 86_400_000).toISOString(),
    });
    expect(emptyResult.total).toBe(0);
  });

  it("listAuditLog: default sort is created_at DESC", async () => {
    const result = await persistence.listAuditLog({ page: 1, limit: 50 });
    const createdAts = result.items.map((i) => new Date(i.createdAt).getTime());
    for (let i = 0; i < createdAts.length - 1; i++) {
      expect(createdAts[i]).toBeGreaterThanOrEqual(createdAts[i + 1]);
    }
  });
});
