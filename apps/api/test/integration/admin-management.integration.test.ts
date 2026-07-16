import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Force oauth mode so preHandler enforces session_version.
vi.mock("@vakwen/config", async (importOriginal) => {
  const original = await importOriginal<typeof import("@vakwen/config")>();
  return {
    ...original,
    Env: { ...original.Env, AUTH_MODE: "oauth" as const },
  };
});

const { buildApp } = await import("../../src/app.js");
const { signSessionCookie } = await import("../../src/auth/googleOAuth.js");
const { PostgresPersistence } = await import("../../src/persistence/postgres.js");
const { loadMigrationManifest } = await import("../../src/persistence/migrationManifest.js");

type BuiltApp = Awaited<ReturnType<typeof buildApp>>;

// ── Postgres integration guard ────────────────────────────────────────────────
const databaseUrl = process.env.POSTGRES_TEST_DB_URL ?? process.env.DB_URL;
const redisUrl = process.env.POSTGRES_TEST_REDIS_URL ?? process.env.REDIS_URL;
const runPostgresIntegration = process.env.RUN_POSTGRES_INTEGRATION === "1";
const managedCiStack = process.env.VAKWEN_MANAGED_CI_STACK === "1";

if (runPostgresIntegration && !managedCiStack) {
  throw new Error(
    "RUN_POSTGRES_INTEGRATION=1 must be executed via npm run test:integration:ci:host or npm run test:integration:ci:container so the DB/Redis stack is managed automatically.",
  );
}
const shouldRunPostgresSuite = runPostgresIntegration && Boolean(databaseUrl) && Boolean(redisUrl);
const describePostgres = shouldRunPostgresSuite ? describe : describe.skip;

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(currentDir, "../../../../db/migrations");
const migrationManifestPromise = loadMigrationManifest(migrationsDir);

const testOAuthConfig = {
  clientId: "test-client-id",
  clientSecret: "test-client-secret",
  redirectUri: "http://localhost:4000/auth/google/callback",
  sessionSecret: "test-session-secret-that-is-long-enough-32chars!!",
};

const SESSION_COOKIE_NAME = "g_auth_session";

// ── Helpers ──────────────────────────────────────────────────────────────────

async function createUser(app: BuiltApp, email: string, name: string, role?: "admin" | "member" | "viewer") {
  const sub = `google-sub-${email.replace("@", "-at-")}`;
  const { userId } = await app.persistence.resolveOrCreateUser("google", sub, { email, name });
  if (role && role !== "member") {
    await app.persistence.changeUserRole(userId, role, { actorUserId: "system" });
  }
  return userId;
}

function mintCookie(userId: string, version: number) {
  return signSessionCookie(userId, testOAuthConfig.sessionSecret, version);
}

// ── disable user → session invalidation ──────────────────────────────────────

describe("disable user → session invalidation", () => {
  let app: BuiltApp;
  let targetUserId: string;

  beforeEach(async () => {
    app = await buildApp({ persistenceBackend: "memory", oauthConfig: testOAuthConfig });
    targetUserId = await createUser(app, "target@example.com", "Target");
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it("disable user: next authenticated request returns 401 (session_version mismatch)", async () => {
    // Arrange — mint cookie at current version
    const userBefore = await app.persistence.getAuthUserById(targetUserId);
    const staleCookie = mintCookie(targetUserId, userBefore!.sessionVersion);

    // Act — disable the user (bumps session_version)
    await app.persistence.disableUser(targetUserId, { actorUserId: "admin-actor" });

    // Assert — request with stale cookie → 401
    const res = await app.inject({
      method: "GET",
      url: "/settings",
      headers: { cookie: `${SESSION_COOKIE_NAME}=${staleCookie}` },
    });
    expect(res.statusCode).toBe(401);
  });
});

// ── soft-delete user → session + visibility ──────────────────────────────────

describe("soft-delete user → session + visibility", () => {
  let app: BuiltApp;
  let targetUserId: string;

  beforeEach(async () => {
    app = await buildApp({ persistenceBackend: "memory", oauthConfig: testOAuthConfig });
    targetUserId = await createUser(app, "target@example.com", "Target");
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it("soft-delete: next request returns 401 (session_version bumped)", async () => {
    const userBefore = await app.persistence.getAuthUserById(targetUserId);
    const staleCookie = mintCookie(targetUserId, userBefore!.sessionVersion);

    await app.persistence.softDeleteUser(targetUserId, { actorUserId: "admin-actor" });

    const res = await app.inject({
      method: "GET",
      url: "/settings",
      headers: { cookie: `${SESSION_COOKIE_NAME}=${staleCookie}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it("soft-delete: user hidden from default listUsers (status=active)", async () => {
    await app.persistence.softDeleteUser(targetUserId, { actorUserId: "admin-actor" });

    const activeList = await app.persistence.listUsers({ page: 1, limit: 50, status: "active" });
    const found = activeList.items.find((i) => i.userId === targetUserId);
    expect(found).toBeUndefined();
  });

  it("soft-delete: user visible with listUsers(status=deleted)", async () => {
    await app.persistence.softDeleteUser(targetUserId, { actorUserId: "admin-actor" });

    const deletedList = await app.persistence.listUsers({ page: 1, limit: 50, status: "deleted" });
    const found = deletedList.items.find((i) => i.userId === targetUserId);
    expect(found).toBeDefined();
    expect(found!.status).toBe("deleted");
  });
});

// ── hard-purge cascade (memory backend) ──────────────────────────────────────

describe("hard-purge cascade", () => {
  let app: BuiltApp;
  let targetUserId: string;

  beforeEach(async () => {
    app = await buildApp({ persistenceBackend: "memory", oauthConfig: testOAuthConfig });
    targetUserId = await createUser(app, "purge-target@example.com", "Purge Target");

    // Create some data referencing the user
    await app.persistence.createInvite({
      email: "invited@example.com",
      role: "member",
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      issuedByUserId: targetUserId,
    });

    // Append audit log entries referencing this user
    await app.persistence.appendAuditLog({
      actorUserId: targetUserId,
      action: "admin_promote_cli",
      targetUserId: targetUserId,
      metadata: { targetEmail: "purge-target@example.com" },
    });
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it("hard-purge sets audit_log actor/target FKs to NULL (ON DELETE SET NULL)", async () => {
    await app.persistence.hardPurgeUser(targetUserId, { actorUserId: "admin-actor" });

    const auditResult = await app.persistence.listAuditLog({ page: 1, limit: 100 });
    // The promote entry should now have null actor/target
    const promoteEntry = auditResult.items.find((e) => e.action === "admin_promote_cli");
    expect(promoteEntry).toBeDefined();
    expect(promoteEntry!.actorUserId).toBeNull();
    expect(promoteEntry!.targetUserId).toBeNull();
  });

  it("hard-purge preserves audit entries with identifying metadata intact", async () => {
    await app.persistence.hardPurgeUser(targetUserId, { actorUserId: "admin-actor" });

    const auditResult = await app.persistence.listAuditLog({ page: 1, limit: 100 });
    const purgeEntry = auditResult.items.find((e) => e.action === "admin_hard_purge_user");
    expect(purgeEntry).toBeDefined();
    expect(purgeEntry!.metadata.targetEmail).toBe("purge-target@example.com");
    expect(purgeEntry!.metadata.targetDisplayName).toBe("Purge Target");
  });

  it("hard-purge sets invites.issued_by_user_id to NULL (not DELETE)", async () => {
    await app.persistence.hardPurgeUser(targetUserId, { actorUserId: "admin-actor" });

    const inviteResult = await app.persistence.listInvites({ page: 1, limit: 100 });
    const invite = inviteResult.items.find((i) => i.email === "invited@example.com");
    expect(invite).toBeDefined();
    expect(invite!.issuedByEmail).toBeNull();
  });

  it("hard-purge anonymizes delegated mutation attribution without deleting owner history", async () => {
    const ownerUserId = await createUser(app, "mutation-owner@example.com", "Mutation Owner");
    const ownerStore = await app.persistence.loadStore(ownerUserId);
    const createdAt = new Date().toISOString();
    await app.persistence.saveAiTransactionDraftBatch({
      id: "memory-purge-batch",
      ownerUserId,
      createdByUserId: targetUserId,
      sourceChannel: "mcp",
      status: "open",
      version: 1,
      rowCount: 1,
      unsupportedCount: 0,
    });
    await app.persistence.saveAiTransactionDraftRow({
      id: "memory-purge-row",
      batchId: "memory-purge-batch",
      ownerUserId,
      rowNumber: 1,
      state: "confirmed",
      version: 1,
    });
    await app.persistence.savePostedTransactionMutationPreview({
      id: "memory-purge-preview",
      ownerUserId,
      actorUserId: targetUserId,
      operation: "delete",
      status: "confirmed",
      version: 2,
      reason: "Memory purge regression",
      confirmationSummary: "Confirm memory purge regression",
      confirmationDigest: "a".repeat(64),
      fingerprint: "b".repeat(64),
      batchLimit: 50,
      summary: {
        quantityDelta: 0,
        costBasisDelta: 0,
        realizedPnlDelta: 0,
        cashDelta: 0,
        reopenedDividendCount: 0,
        deletedDividendCount: 0,
      },
      warnings: [],
      blockers: [],
      errors: [],
      affectedAccountIds: [],
      affectedTickers: [],
      scopes: [],
      accountRevisions: {},
      items: [],
      finalAccounting: ownerStore.accounting,
      replayScopes: [],
      createdAt,
      expiresAt: createdAt,
      confirmedAt: createdAt,
      confirmedRunId: "memory-purge-run",
    });
    await app.persistence.savePostedTransactionMutationRun({
      id: "memory-purge-run",
      previewId: "memory-purge-preview",
      ownerUserId,
      actorUserId: targetUserId,
      operation: "delete",
      status: "completed",
      rebuildStatus: "completed",
      reason: "Memory purge regression",
      warnings: [],
      blockers: [],
      errors: [],
      summary: {
        quantityDelta: 0,
        costBasisDelta: 0,
        realizedPnlDelta: 0,
        cashDelta: 0,
        reopenedDividendCount: 0,
        deletedDividendCount: 0,
      },
      affectedAccountIds: [],
      affectedTickers: [],
      scopes: [],
      fingerprint: "b".repeat(64),
      confirmationDigest: "a".repeat(64),
      replayRunId: null,
      createdAt,
      startedAt: createdAt,
      completedAt: createdAt,
    });
    await app.persistence.savePostedTransactionMutationDeletedDraftLineage({
      tradeEventId: "memory-purge-trade",
      ownerUserId,
      batchId: "memory-purge-batch",
      rowId: "memory-purge-row",
      deletedAt: createdAt,
      deletedByUserId: targetUserId,
      mutationRunId: "memory-purge-run",
    });

    await app.persistence.hardPurgeUser(targetUserId, { actorUserId: "admin-actor" });

    await expect(app.persistence.getPostedTransactionMutationPreview("memory-purge-preview")).resolves.toMatchObject({
      ownerUserId,
      actorUserId: null,
    });
    await expect(app.persistence.getPostedTransactionMutationRun("memory-purge-run")).resolves.toMatchObject({
      ownerUserId,
      actorUserId: null,
    });
    await expect(app.persistence.listPostedTransactionMutationDeletedDraftLineage(
      ownerUserId,
      ["memory-purge-trade"],
    )).resolves.toMatchObject([{
      deletedByUserId: null,
      mutationRunId: "memory-purge-run",
    }]);
    await expect(app.persistence.getAiTransactionDraftBatch("memory-purge-batch")).resolves.toMatchObject({
      batch: {
        ownerUserId,
        createdByUserId: null,
      },
    });
  });
});

// ── role change audit metadata ───────────────────────────────────────────────

describe("role change audit metadata — integration", () => {
  let app: BuiltApp;
  let targetUserId: string;
  let adminUserId: string;

  beforeEach(async () => {
    app = await buildApp({ persistenceBackend: "memory", oauthConfig: testOAuthConfig });
    adminUserId = await createUser(app, "admin@example.com", "Admin", "admin");
    targetUserId = await createUser(app, "target@example.com", "Target");
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it("role change audit entry metadata contains {fromRole, toRole, targetEmail}", async () => {
    const adminCookie = mintCookie(adminUserId, 1);

    const res = await app.inject({
      method: "PATCH",
      url: `/admin/users/${targetUserId}/role`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${adminCookie}` },
      payload: { role: "viewer" },
    });
    expect(res.statusCode).toBe(200);

    const auditResult = await app.persistence.listAuditLog({
      page: 1,
      limit: 50,
      actions: ["admin_role_change"],
    });

    const entry = auditResult.items.find((e) => e.targetUserId === targetUserId);
    expect(entry).toBeDefined();
    expect(entry!.metadata.fromRole).toBe("member");
    expect(entry!.metadata.toRole).toBe("viewer");
    expect(entry!.metadata.targetEmail).toBe("target@example.com");
  });
});

// ── invite audit entries — existing endpoints ────────────────────────────────

describe("invite audit entries — existing endpoints", () => {
  let app: BuiltApp;
  let adminUserId: string;

  beforeEach(async () => {
    app = await buildApp({
      persistenceBackend: "memory",
      oauthConfig: testOAuthConfig,
      appBaseUrl: "http://localhost:3000",
    });
    adminUserId = await createUser(app, "admin@example.com", "Admin", "admin");
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it("POST /invites emits admin_invite_issued audit entry with {targetEmail, inviteCode, role}", async () => {
    const adminCookie = mintCookie(adminUserId, 1);

    const res = await app.inject({
      method: "POST",
      url: "/invites",
      headers: { cookie: `${SESSION_COOKIE_NAME}=${adminCookie}` },
      payload: { email: "newbie@example.com", role: "member" },
    });
    expect(res.statusCode).toBe(201);
    const { code } = res.json();

    const auditResult = await app.persistence.listAuditLog({
      page: 1,
      limit: 50,
      actions: ["admin_invite_issued"],
    });

    expect(auditResult.items).toHaveLength(1);
    const entry = auditResult.items[0];
    expect(entry.metadata.targetEmail).toBe("newbie@example.com");
    expect(entry.metadata.inviteCode).toBe(code);
    expect(entry.metadata.role).toBe("member");
  });

  it("DELETE /invites/:code emits admin_invite_revoked audit entry with {inviteCode, targetEmail}", async () => {
    const adminCookie = mintCookie(adminUserId, 1);

    // Create invite first
    const createRes = await app.inject({
      method: "POST",
      url: "/invites",
      headers: { cookie: `${SESSION_COOKIE_NAME}=${adminCookie}` },
      payload: { email: "revokee@example.com", role: "viewer" },
    });
    const { code } = createRes.json();

    // Revoke
    const revokeRes = await app.inject({
      method: "DELETE",
      url: `/invites/${code}`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${adminCookie}` },
    });
    expect(revokeRes.statusCode).toBe(204);

    const auditResult = await app.persistence.listAuditLog({
      page: 1,
      limit: 50,
      actions: ["admin_invite_revoked"],
    });

    expect(auditResult.items).toHaveLength(1);
    const entry = auditResult.items[0];
    expect(entry.metadata.inviteCode).toBe(code);
    expect(entry.metadata.targetEmail).toBe("revokee@example.com");
  });
});

// FIXME: KZO-144 — concurrent last-admin FOR UPDATE lock test requires Postgres.
// Memory backend does not support row-level locking. The test scenario:
//   1. Create exactly 2 admins
//   2. Race two concurrent PATCH /admin/users/:id/role (demote both to member) in parallel
//   3. One should succeed (200), the other should get 409 last_admin_blocked
//   4. Verify exactly 1 admin remains after the race
// Place in this file with `persistenceBackend: "postgres"` when Postgres integration
// infrastructure is available (see test-placement-persistence-backend.md).

// ── hard-purge cascade (Postgres backend) ────────────────────────────────────

describePostgres("hard-purge cascade — Postgres ON DELETE CASCADE", () => {
  let pool: Pool;
  let persistence: Awaited<ReturnType<typeof newPersistence>> | null = null;
  let adminActorId: string;

  async function newPersistence() {
    const p = new PostgresPersistence({ databaseUrl: databaseUrl!, redisUrl: redisUrl! });
    await p.init();
    return p;
  }

  async function resetDatabase(): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query("DROP SCHEMA IF EXISTS market_data CASCADE");
      await client.query("DROP SCHEMA IF EXISTS public CASCADE");
      await client.query("CREATE SCHEMA public");
      await client.query("GRANT ALL ON SCHEMA public TO public");
    } finally {
      client.release();
    }
  }

  async function applyNumberedMigrations(): Promise<void> {
    const manifest = await migrationManifestPromise;
    const client = await pool.connect();
    try {
      for (const file of manifest.numberedMigrations) {
        const migrationSql = await fs.readFile(path.join(migrationsDir, file), "utf8");
        await client.query(migrationSql);
      }
    } finally {
      client.release();
    }
  }

  beforeEach(async () => {
    pool = new Pool({ connectionString: databaseUrl });
    await resetDatabase();
    await applyNumberedMigrations();
    persistence = await newPersistence();
    const { userId } = await persistence!.resolveOrCreateUser(
      "google", "admin-actor-sub", { email: "admin@example.com", name: "Admin" }
    );
    adminActorId = userId;
  });

  afterEach(async () => {
    if (persistence) { await persistence.close(); persistence = null; }
    await pool.end();
  });

  it("portfolio_shares — owner purged → ON DELETE CASCADE removes share", async () => {
    const { userId: ownerId } = await persistence!.resolveOrCreateUser("google", "owner-sub", { email: "owner@example.com", name: "Owner" });
    const { userId: granteeId } = await persistence!.resolveOrCreateUser("google", "grantee-sub", { email: "grantee@example.com", name: "Grantee" });
    await persistence!.createShareGrant({ ownerUserId: ownerId, granteeUserId: granteeId, auditInput: { actorUserId: ownerId } });

    await persistence!.hardPurgeUser(ownerId, { actorUserId: adminActorId});

    const inbound = await persistence!.listInboundSharesForGrantee(granteeId);
    expect(inbound.active).toEqual([]);
    expect(inbound.revoked).toEqual([]);
  });

  it("portfolio_shares — grantee purged → ON DELETE CASCADE removes share", async () => {
    const { userId: ownerId } = await persistence!.resolveOrCreateUser("google", "owner-sub", { email: "owner@example.com", name: "Owner" });
    const { userId: granteeId } = await persistence!.resolveOrCreateUser("google", "grantee-sub", { email: "grantee@example.com", name: "Grantee" });
    await persistence!.createShareGrant({ ownerUserId: ownerId, granteeUserId: granteeId, auditInput: { actorUserId: ownerId } });

    await persistence!.hardPurgeUser(granteeId, { actorUserId: adminActorId});

    const outbound = await persistence!.listSharesForOwner(ownerId);
    expect(outbound.active).toEqual([]);
    expect(outbound.revoked).toEqual([]);
  });

  it("posted transaction mutations — delegated actor purged → anonymizes actor and preserves owner history", async () => {
    const { userId: ownerId } = await persistence!.resolveOrCreateUser(
      "google", "mutation-owner-sub", { email: "mutation-owner@example.com", name: "Mutation Owner" },
    );
    const { userId: delegateId } = await persistence!.resolveOrCreateUser(
      "google", "mutation-delegate-sub", { email: "mutation-delegate@example.com", name: "Mutation Delegate" },
    );
    await persistence!.saveAiTransactionDraftBatch({
      id: "purge-draft-batch",
      ownerUserId: ownerId,
      createdByUserId: delegateId,
      sourceChannel: "mcp",
      status: "open",
      version: 1,
      rowCount: 1,
      unsupportedCount: 0,
    });
    await persistence!.saveAiTransactionDraftRow({
      id: "purge-draft-row",
      batchId: "purge-draft-batch",
      ownerUserId: ownerId,
      rowNumber: 1,
      state: "confirmed",
      version: 1,
    });
    await pool.query(
      `INSERT INTO posted_transaction_mutation_previews (
         id, owner_user_id, actor_user_id, operation, status, version, reason,
         confirmation_summary, confirmation_digest, fingerprint, batch_limit,
         summary_json, warnings_json, blockers_json, errors_json,
         affected_account_ids_json, affected_tickers_json, scopes_json,
         account_revisions_json, final_accounting_json, replay_scopes_json,
         created_at, expires_at
       ) VALUES (
         'purge-preview', $1, $2, 'update', 'ready', 1, 'Purge regression',
         'Confirm purge regression', repeat('a', 64), repeat('b', 64), 50,
         '{}'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
         '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
         '{}'::jsonb, '{}'::jsonb, '[]'::jsonb,
         NOW(), NOW() + INTERVAL '30 minutes'
       )`,
      [ownerId, delegateId],
    );
    await pool.query(
      `INSERT INTO posted_transaction_mutation_runs (
         id, preview_id, owner_user_id, actor_user_id, operation, status, rebuild_status,
         reason, warnings_json, blockers_json, errors_json, summary_json,
         affected_account_ids_json, affected_tickers_json, scopes_json,
         fingerprint, confirmation_digest, created_at
       ) VALUES (
         'purge-run', 'purge-preview', $1, $2, 'update', 'completed', 'completed',
         'Purge regression', '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb,
         '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
         repeat('b', 64), repeat('a', 64), NOW()
       )`,
      [ownerId, delegateId],
    );
    await pool.query(
      `INSERT INTO posted_transaction_mutation_deleted_draft_lineage (
         trade_event_id, owner_user_id, batch_id, row_id, deleted_at, deleted_by_user_id, mutation_run_id
       ) VALUES (
         'purge-trade', $1, 'purge-draft-batch', 'purge-draft-row', NOW(), $2, 'purge-run'
       )`,
      [ownerId, delegateId],
    );

    await expect(persistence!.hardPurgeUser(delegateId, { actorUserId: adminActorId })).resolves.toBeUndefined();

    const remaining = await pool.query<{
      owner_count: string;
      delegate_count: string;
      preview_count: string;
      run_count: string;
      lineage_count: string;
      preview_actor_user_id: string | null;
      run_actor_user_id: string | null;
      deleted_by_user_id: string | null;
      batch_created_by_user_id: string | null;
    }>(
      `SELECT
         (SELECT COUNT(*)::text FROM users WHERE id = $1) AS owner_count,
         (SELECT COUNT(*)::text FROM users WHERE id = $2) AS delegate_count,
         (SELECT COUNT(*)::text FROM posted_transaction_mutation_previews WHERE id = 'purge-preview') AS preview_count,
         (SELECT COUNT(*)::text FROM posted_transaction_mutation_runs WHERE id = 'purge-run') AS run_count,
         (SELECT COUNT(*)::text FROM posted_transaction_mutation_deleted_draft_lineage WHERE trade_event_id = 'purge-trade') AS lineage_count,
         (SELECT actor_user_id FROM posted_transaction_mutation_previews WHERE id = 'purge-preview') AS preview_actor_user_id,
         (SELECT actor_user_id FROM posted_transaction_mutation_runs WHERE id = 'purge-run') AS run_actor_user_id,
         (SELECT deleted_by_user_id FROM posted_transaction_mutation_deleted_draft_lineage WHERE trade_event_id = 'purge-trade') AS deleted_by_user_id,
         (SELECT created_by_user_id FROM ai_transaction_draft_batches WHERE id = 'purge-draft-batch') AS batch_created_by_user_id`,
      [ownerId, delegateId],
    );
    expect(remaining.rows[0]).toEqual({
      owner_count: "1",
      delegate_count: "0",
      preview_count: "1",
      run_count: "1",
      lineage_count: "1",
      preview_actor_user_id: null,
      run_actor_user_id: null,
      deleted_by_user_id: null,
      batch_created_by_user_id: null,
    });

    const constraints = await pool.query<{ conname: string; confdeltype: string }>(
      `SELECT conname, confdeltype
         FROM pg_constraint
        WHERE conname = ANY($1::text[])
        ORDER BY conname`,
      [[
        "fk_ptm_lineage_deleted_by",
        "fk_ai_draft_batches_created_by",
        "fk_ptm_previews_actor",
        "fk_ptm_runs_actor",
        "fk_ptm_runs_preview",
      ]],
    );
    expect(constraints.rows).toEqual([
      { conname: "fk_ai_draft_batches_created_by", confdeltype: "n" },
      { conname: "fk_ptm_lineage_deleted_by", confdeltype: "n" },
      { conname: "fk_ptm_previews_actor", confdeltype: "n" },
      { conname: "fk_ptm_runs_actor", confdeltype: "n" },
      { conname: "fk_ptm_runs_preview", confdeltype: "c" },
    ]);
  });

  it("anonymous_share_tokens — owner purged → ON DELETE CASCADE removes token", async () => {
    const { userId: ownerId } = await persistence!.resolveOrCreateUser("google", "owner-sub", { email: "owner@example.com", name: "Owner" });
    const result = await persistence!.createAnonymousShareToken({
      ownerUserId: ownerId,
      token: "postgrescascadeTokenAB",
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      ttlDays: 7,
      auditInput: { actorUserId: ownerId },
    });
    expect(result.status).toBe("ok");

    await persistence!.hardPurgeUser(ownerId, { actorUserId: adminActorId});

    const found = await persistence!.findActiveAnonymousShareTokenByToken("postgrescascadeTokenAB");
    expect(found).toBeNull();
  });
});
