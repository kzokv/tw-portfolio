import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryPersistence } from "../../src/persistence/memory.js";
import {
  ANONYMOUS_SHARE_TOKEN_CAP,
  ANONYMOUS_SHARE_TOKEN_REGEX,
  generateAnonymousShareToken,
} from "../../src/lib/anonymousShareToken.js";
import type { OAuthClaims } from "../../src/persistence/types.js";

const baseAudit = { actorUserId: null, ipAddress: null } as const;

async function seedUser(persistence: MemoryPersistence, email: string) {
  const claims: OAuthClaims = {
    email,
    emailVerified: true,
    name: "Owner Name",
    picture: undefined,
  };
  const result = await persistence.resolveOrCreateUser("google", `sub-${email}`, claims);
  return result.userId;
}

function futureIso(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

describe("MemoryPersistence — anonymous share tokens", () => {
  let persistence: MemoryPersistence;
  let ownerId: string;

  beforeEach(async () => {
    persistence = new MemoryPersistence();
    ownerId = await seedUser(persistence, "owner@example.com");
  });

  afterEach(async () => {
    await persistence.close();
  });

  it("creates a token and exposes it in listAnonymousShareTokensForOwner", async () => {
    // Arrange
    const token = generateAnonymousShareToken();
    expect(token).toMatch(ANONYMOUS_SHARE_TOKEN_REGEX);

    // Act
    const result = await persistence.createAnonymousShareToken({
      ownerUserId: ownerId,
      token,
      expiresAt: futureIso(30 * 86_400_000),
      ttlDays: 30,
      auditInput: baseAudit,
    });

    // Assert
    expect(result.status).toBe("ok");
    const list = await persistence.listAnonymousShareTokensForOwner(ownerId);
    expect(list).toHaveLength(1);
    expect(list[0]!.token).toBe(token);
    expect(list[0]!.ownerUserId).toBe(ownerId);
    expect(list[0]!.revokedAt).toBeNull();
  });

  it("refuses to create a token when the owner already has 20 active tokens", async () => {
    // Arrange — fill the cap with active tokens
    for (let i = 0; i < ANONYMOUS_SHARE_TOKEN_CAP; i += 1) {
      const ok = await persistence.createAnonymousShareToken({
        ownerUserId: ownerId,
        token: generateAnonymousShareToken(),
        expiresAt: futureIso(30 * 86_400_000),
        ttlDays: 30,
        auditInput: baseAudit,
      });
      expect(ok.status).toBe("ok");
    }
    const activeCount = await persistence.countActiveAnonymousShareTokensForOwner(ownerId);
    expect(activeCount).toBe(ANONYMOUS_SHARE_TOKEN_CAP);

    // Act
    const overflow = await persistence.createAnonymousShareToken({
      ownerUserId: ownerId,
      token: generateAnonymousShareToken(),
      expiresAt: futureIso(30 * 86_400_000),
      ttlDays: 30,
      auditInput: baseAudit,
    });

    // Assert
    expect(overflow.status).toBe("cap_exceeded");
  });

  it("reports a collision status when the plaintext token is reused", async () => {
    // Arrange
    const token = generateAnonymousShareToken();
    const first = await persistence.createAnonymousShareToken({
      ownerUserId: ownerId,
      token,
      expiresAt: futureIso(30 * 86_400_000),
      ttlDays: 30,
      auditInput: baseAudit,
    });
    expect(first.status).toBe("ok");

    // Act
    const second = await persistence.createAnonymousShareToken({
      ownerUserId: ownerId,
      token,
      expiresAt: futureIso(30 * 86_400_000),
      ttlDays: 30,
      auditInput: baseAudit,
    });

    // Assert
    expect(second.status).toBe("collision");
  });

  it("findActiveAnonymousShareTokenByToken resolves active rows but hides revoked + expired", async () => {
    // Arrange — one active, one revoked, one expired
    const activeToken = generateAnonymousShareToken();
    const revokedToken = generateAnonymousShareToken();
    const expiredToken = generateAnonymousShareToken();

    await persistence.createAnonymousShareToken({
      ownerUserId: ownerId,
      token: activeToken,
      expiresAt: futureIso(30 * 86_400_000),
      ttlDays: 30,
      auditInput: baseAudit,
    });
    const revokedCreate = await persistence.createAnonymousShareToken({
      ownerUserId: ownerId,
      token: revokedToken,
      expiresAt: futureIso(30 * 86_400_000),
      ttlDays: 30,
      auditInput: baseAudit,
    });
    expect(revokedCreate.status).toBe("ok");
    if (revokedCreate.status !== "ok") throw new Error("unreachable");
    await persistence.revokeAnonymousShareToken({
      id: revokedCreate.record.id,
      ownerUserId: ownerId,
      auditInput: baseAudit,
    });

    await persistence.createAnonymousShareToken({
      ownerUserId: ownerId,
      token: expiredToken,
      expiresAt: futureIso(-1000),
      ttlDays: 1,
      auditInput: baseAudit,
    });

    // Act + Assert
    const active = await persistence.findActiveAnonymousShareTokenByToken(activeToken);
    expect(active).not.toBeNull();
    expect(active!.token).toBe(activeToken);

    expect(await persistence.findActiveAnonymousShareTokenByToken(revokedToken)).toBeNull();
    expect(await persistence.findActiveAnonymousShareTokenByToken(expiredToken)).toBeNull();
    expect(await persistence.findActiveAnonymousShareTokenByToken("does-not-exist-22-chars!!")).toBeNull();
  });

  it("revokeAnonymousShareToken is idempotent and reports noop / not_found correctly", async () => {
    // Arrange
    const granteeId = await seedUser(persistence, "other@example.com");
    const token = generateAnonymousShareToken();
    const created = await persistence.createAnonymousShareToken({
      ownerUserId: ownerId,
      token,
      expiresAt: futureIso(30 * 86_400_000),
      ttlDays: 30,
      auditInput: baseAudit,
    });
    if (created.status !== "ok") throw new Error("seed failed");

    // Act — first revoke flips the row
    const first = await persistence.revokeAnonymousShareToken({
      id: created.record.id,
      ownerUserId: ownerId,
      auditInput: baseAudit,
    });
    expect(first.status).toBe("revoked");

    // Act — second revoke is a no-op
    const second = await persistence.revokeAnonymousShareToken({
      id: created.record.id,
      ownerUserId: ownerId,
      auditInput: baseAudit,
    });
    expect(second.status).toBe("noop");

    // Act — wrong owner sees not_found (no existence leak)
    const wrongOwner = await persistence.revokeAnonymousShareToken({
      id: created.record.id,
      ownerUserId: granteeId,
      auditInput: baseAudit,
    });
    expect(wrongOwner.status).toBe("not_found");

    // Act — unknown id also sees not_found
    const unknown = await persistence.revokeAnonymousShareToken({
      id: "not-a-real-id",
      ownerUserId: ownerId,
      auditInput: baseAudit,
    });
    expect(unknown.status).toBe("not_found");
  });

  it("listAnonymousShareTokensForOwner applies 30-day retention for terminal rows", async () => {
    // Arrange
    const activeToken = generateAnonymousShareToken();
    const recentlyRevokedToken = generateAnonymousShareToken();
    const oldExpiredToken = generateAnonymousShareToken();
    const recentlyExpiredToken = generateAnonymousShareToken();

    // Active token
    await persistence.createAnonymousShareToken({
      ownerUserId: ownerId,
      token: activeToken,
      expiresAt: futureIso(30 * 86_400_000),
      ttlDays: 30,
      auditInput: baseAudit,
    });

    // Recently revoked — within retention window
    const recentlyRevoked = await persistence.createAnonymousShareToken({
      ownerUserId: ownerId,
      token: recentlyRevokedToken,
      expiresAt: futureIso(30 * 86_400_000),
      ttlDays: 30,
      auditInput: baseAudit,
    });
    if (recentlyRevoked.status !== "ok") throw new Error("seed failed");
    await persistence.revokeAnonymousShareToken({
      id: recentlyRevoked.record.id,
      ownerUserId: ownerId,
      auditInput: baseAudit,
    });

    // Old expired — outside retention window (expired 31 days ago)
    await persistence.createAnonymousShareToken({
      ownerUserId: ownerId,
      token: oldExpiredToken,
      expiresAt: futureIso(-31 * 86_400_000),
      ttlDays: 1,
      auditInput: baseAudit,
    });

    // Recently expired — within retention window (expired 1 day ago)
    await persistence.createAnonymousShareToken({
      ownerUserId: ownerId,
      token: recentlyExpiredToken,
      expiresAt: futureIso(-1 * 86_400_000),
      ttlDays: 1,
      auditInput: baseAudit,
    });

    // Act
    const list = await persistence.listAnonymousShareTokensForOwner(ownerId);
    const tokens = new Set(list.map((row) => row.token));

    // Assert
    expect(tokens.has(activeToken)).toBe(true);
    expect(tokens.has(recentlyRevokedToken)).toBe(true);
    expect(tokens.has(recentlyExpiredToken)).toBe(true);
    expect(tokens.has(oldExpiredToken)).toBe(false);
  });

  it("countActiveAnonymousShareTokensForOwner ignores revoked and expired rows", async () => {
    // Arrange — one active, one revoked, one expired
    const activeToken = generateAnonymousShareToken();
    const revokedToken = generateAnonymousShareToken();
    const expiredToken = generateAnonymousShareToken();
    await persistence.createAnonymousShareToken({
      ownerUserId: ownerId,
      token: activeToken,
      expiresAt: futureIso(30 * 86_400_000),
      ttlDays: 30,
      auditInput: baseAudit,
    });
    const revokedCreate = await persistence.createAnonymousShareToken({
      ownerUserId: ownerId,
      token: revokedToken,
      expiresAt: futureIso(30 * 86_400_000),
      ttlDays: 30,
      auditInput: baseAudit,
    });
    if (revokedCreate.status !== "ok") throw new Error("seed failed");
    await persistence.revokeAnonymousShareToken({
      id: revokedCreate.record.id,
      ownerUserId: ownerId,
      auditInput: baseAudit,
    });
    await persistence.createAnonymousShareToken({
      ownerUserId: ownerId,
      token: expiredToken,
      expiresAt: futureIso(-1000),
      ttlDays: 1,
      auditInput: baseAudit,
    });

    // Act
    const count = await persistence.countActiveAnonymousShareTokensForOwner(ownerId);

    // Assert
    expect(count).toBe(1);
  });
});
