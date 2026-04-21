import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Override Env so createPersistence() connects to the managed test Postgres instance.
// createPersistence() reads Env.PERSISTENCE_BACKEND (field) and calls Env.getDatabaseUrl() /
// Env.getRedisUrl() (methods) — both field overrides AND method replacements are required.
// adminBootstrapInvite.ts also reads Env.APP_BASE_URL directly; pin it for stable stdout assertions.
vi.mock("@tw-portfolio/config", async (importOriginal) => {
  const original = await importOriginal<typeof import("@tw-portfolio/config")>();
  return {
    ...original,
    Env: {
      ...original.Env,
      PERSISTENCE_BACKEND: "postgres" as const,
      DB_URL: process.env.POSTGRES_TEST_DB_URL ?? process.env.DB_URL,
      REDIS_URL: process.env.POSTGRES_TEST_REDIS_URL ?? process.env.REDIS_URL,
      APP_BASE_URL: "http://localhost:3000",
      getDatabaseUrl() {
        return process.env.POSTGRES_TEST_DB_URL ?? process.env.DB_URL ?? "";
      },
      getRedisUrl() {
        return process.env.POSTGRES_TEST_REDIS_URL ?? process.env.REDIS_URL ?? "";
      },
    },
  };
});

// Dynamic imports — resolve AFTER mock is installed (vi.mock is hoisted, so these see the mock).
const { PostgresPersistence } = await import("../../src/persistence/postgres.js");
const { loadMigrationManifest } = await import("../../src/persistence/migrationManifest.js");

// ── Postgres integration guard ────────────────────────────────────────────────
const databaseUrl = process.env.POSTGRES_TEST_DB_URL ?? process.env.DB_URL;
const redisUrl = process.env.POSTGRES_TEST_REDIS_URL ?? process.env.REDIS_URL;
const runPostgresIntegration = process.env.RUN_POSTGRES_INTEGRATION === "1";
const managedCiStack = process.env.TWP_MANAGED_CI_STACK === "1";

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

// ── Shared runMain helper ─────────────────────────────────────────────────────
// Captures console.log / console.error and process.exitCode so tests can assert
// the observable contract of CLI entry points without shell-spawning.

async function runMain(
  cliModule: { main: (argv: string[]) => Promise<void> },
  argv: string[],
): Promise<{ stdout: string[]; stderr: string[]; exitCode: number }> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args) => {
    stdout.push(args.map(String).join(" "));
  };
  console.error = (...args) => {
    stderr.push(args.map(String).join(" "));
  };
  process.exitCode = 0;
  try {
    await cliModule.main(argv);
    return { stdout, stderr, exitCode: process.exitCode ?? 0 };
  } finally {
    console.log = originalLog;
    console.error = originalError;
    process.exitCode = 0; // reset for next test
  }
}

// ── admin:promote — 6 cases ───────────────────────────────────────────────────

describePostgres("admin CLI — admin:promote", () => {
  let pool: Pool;
  let persistence: InstanceType<typeof PostgresPersistence> | null = null;

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
    // NOTE: beforeEach does NOT seed an admin actor — CLI audit rows use actor_user_id = NULL.
    persistence = new PostgresPersistence({ databaseUrl: databaseUrl!, redisUrl: redisUrl! });
    await persistence.init();
  });

  afterEach(async () => {
    if (persistence) {
      await persistence.close();
      persistence = null;
    }
    await pool.end();
  });

  it("happy path — promotes a member user to admin and writes an audit row", async () => {
    // Arrange
    const { userId } = await persistence!.resolveOrCreateUser("google", "seed-sub", {
      email: "admin@example.com",
      name: "Admin",
    });
    // Dynamic import inside it body — ensures the vi.mock is active before module loads.
    const promoteCli = await import("../../src/cli/adminPromote.js");

    // Act
    const { stdout, stderr, exitCode } = await runMain(promoteCli, [
      "node",
      "script",
      "admin@example.com",
    ]);

    // Assert — exit + stdout
    expect(exitCode).toBe(0);
    expect(stderr).toHaveLength(0);
    expect(stdout[0]).toMatch(/^Promoted admin@example\.com \([0-9a-f-]+\) to admin$/);

    // Assert — DB role updated
    const user = await persistence!.getAuthUserById(userId);
    expect(user?.role).toBe("admin");

    // Assert — one admin_promote_cli audit row with actor=NULL
    const auditResult = await persistence!.listAuditLog({
      page: 1,
      limit: 100,
      actions: ["admin_promote_cli"],
    });
    expect(auditResult.items).toHaveLength(1);
    const entry = auditResult.items[0];
    expect(entry.actorUserId).toBeNull();
    expect(entry.targetUserId).toBe(userId);
    expect(entry.metadata.targetEmail).toBe("admin@example.com");
  });

  it("no-matching-user — exits 1 with error message and no audit row", async () => {
    // Arrange — no user seeded
    const promoteCli = await import("../../src/cli/adminPromote.js");

    // Act
    const { stderr, exitCode } = await runMain(promoteCli, [
      "node",
      "script",
      "ghost@example.com",
    ]);

    // Assert
    expect(exitCode).toBe(1);
    expect(stderr.some((s) => s === "user must sign in first, or issue an invite")).toBe(true);
    const auditResult = await persistence!.listAuditLog({
      page: 1,
      limit: 100,
      actions: ["admin_promote_cli"],
    });
    expect(auditResult.items).toHaveLength(0);
  });

  it("usage / missing argv — exits 1 with Usage message", async () => {
    const promoteCli = await import("../../src/cli/adminPromote.js");

    const { stderr, exitCode } = await runMain(promoteCli, ["node", "script"]);

    expect(exitCode).toBe(1);
    expect(stderr.some((s) => s.includes("Usage:"))).toBe(true);
  });

  it("invalid email (ZodError) — exits 1 with invalid email message", async () => {
    const promoteCli = await import("../../src/cli/adminPromote.js");

    const { stderr, exitCode } = await runMain(promoteCli, [
      "node",
      "script",
      "not-an-email",
    ]);

    expect(exitCode).toBe(1);
    expect(stderr.some((s) => s.includes("invalid email"))).toBe(true);
  });

  it("already-admin re-run — exits 0 and emits a second admin_promote_cli audit row (observed-behavior pin)", async () => {
    // Arrange — seed user and pre-promote via the startup path (emits admin_promote_startup, not cli)
    const { userId } = await persistence!.resolveOrCreateUser(
      "google",
      "already-admin-sub",
      { email: "already-admin@example.com", name: "Already Admin" },
    );
    await persistence!.promoteUserToAdminByEmail(
      "already-admin@example.com",
      "admin_promote_startup",
    );
    const promoteCli = await import("../../src/cli/adminPromote.js");

    // Act — CLI promotes the same user again
    const { stdout, exitCode } = await runMain(promoteCli, [
      "node",
      "script",
      "already-admin@example.com",
    ]);

    // Assert — CLI succeeds
    expect(exitCode).toBe(0);
    expect(stdout[0]).toMatch(/^Promoted already-admin@example\.com \([0-9a-f-]+\) to admin$/);

    // Assert — role still admin
    const user = await persistence!.getAuthUserById(userId);
    expect(user?.role).toBe("admin");

    // Assert — exactly one admin_promote_cli row (the startup path emitted admin_promote_startup)
    const auditResult = await persistence!.listAuditLog({
      page: 1,
      limit: 100,
      actions: ["admin_promote_cli"],
    });
    expect(auditResult.items).toHaveLength(1);
    expect(auditResult.items[0].actorUserId).toBeNull();
    expect(auditResult.items[0].targetUserId).toBe(userId);
  });

  it("deactivated user — exits 1 without changing role or writing audit", async () => {
    // Arrange — seed user then deactivate via raw SQL
    // (avoids needing a valid actorUserId FK for persistence.disableUser())
    const { userId } = await persistence!.resolveOrCreateUser("google", "deact-sub", {
      email: "deact@example.com",
      name: "Deact",
    });
    await pool.query("UPDATE users SET deactivated_at = NOW() WHERE id = $1", [userId]);
    const promoteCli = await import("../../src/cli/adminPromote.js");

    // Act
    const { stderr, exitCode } = await runMain(promoteCli, [
      "node",
      "script",
      "deact@example.com",
    ]);

    // Assert — promoteUserToAdminByEmail returns null for deactivated users → no-match path
    expect(exitCode).toBe(1);
    expect(stderr.some((s) => s === "user must sign in first, or issue an invite")).toBe(true);

    // Assert — role unchanged
    const user = await persistence!.getAuthUserById(userId);
    expect(user?.role).toBe("member");

    // Assert — no CLI audit row written
    const auditResult = await persistence!.listAuditLog({
      page: 1,
      limit: 100,
      actions: ["admin_promote_cli"],
    });
    expect(auditResult.items).toHaveLength(0);
  });
});

// ── admin:bootstrap-invite — 7 cases ─────────────────────────────────────────

describePostgres("admin CLI — admin:bootstrap-invite", () => {
  let pool: Pool;
  let persistence: InstanceType<typeof PostgresPersistence> | null = null;

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
    persistence = new PostgresPersistence({ databaseUrl: databaseUrl!, redisUrl: redisUrl! });
    await persistence.init();
  });

  afterEach(async () => {
    if (persistence) {
      await persistence.close();
      persistence = null;
    }
    await pool.end();
  });

  it("happy path — creates invite with correct DB fields and prints code + URL", async () => {
    // Arrange — no user seeded
    const inviteCli = await import("../../src/cli/adminBootstrapInvite.js");

    // Act
    const { stdout, stderr, exitCode } = await runMain(inviteCli, [
      "node",
      "script",
      "newbie@example.com",
      "member",
    ]);

    // Assert — exit + stderr empty
    expect(exitCode).toBe(0);
    expect(stderr).toHaveLength(0);
    expect(stdout).toHaveLength(2);
    expect(stdout[0]).toMatch(/^Created invite \S+ for newbie@example\.com$/);
    expect(stdout[1]).toMatch(/^http:\/\/localhost:3000\/invite\/\S+$/);

    // Extract invite code from stdout[0]: "Created invite <code> for newbie@example.com"
    const codeMatch = stdout[0].match(/^Created invite (\S+) for newbie@example\.com$/);
    expect(codeMatch).not.toBeNull();
    const code = codeMatch![1];

    // Assert — invite status is valid
    const status = await persistence!.getInviteStatus(code);
    expect(status).toBe("valid");

    // Assert — DB invite row fields via raw query
    const row = await pool.query<{
      role: string;
      expires_at: Date;
      issued_by_user_id: string | null;
      used_at: Date | null;
      revoked_at: Date | null;
    }>(
      "SELECT role, expires_at, issued_by_user_id, used_at, revoked_at FROM invites WHERE code = $1",
      [code],
    );
    expect(row.rows).toHaveLength(1);
    const invite = row.rows[0];
    expect(invite.role).toBe("member");
    expect(invite.issued_by_user_id).toBeNull();
    expect(invite.used_at).toBeNull();
    expect(invite.revoked_at).toBeNull();

    // expires_at within ±5s of NOW() + 7 days
    const expectedExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const delta = Math.abs(invite.expires_at.getTime() - expectedExpiry.getTime());
    expect(delta).toBeLessThan(5000);
  });

  it("user already exists — exits 1 and writes no invite", async () => {
    // Arrange — seed existing user
    await persistence!.resolveOrCreateUser("google", "existing-sub", {
      email: "existing@example.com",
      name: "Existing",
    });
    const inviteCli = await import("../../src/cli/adminBootstrapInvite.js");

    // Act
    const { stderr, exitCode } = await runMain(inviteCli, [
      "node",
      "script",
      "existing@example.com",
      "member",
    ]);

    // Assert
    expect(exitCode).toBe(1);
    expect(stderr.some((s) => s === "A user with that email already exists")).toBe(true);
    const invites = await persistence!.listInvites({ page: 1, limit: 100, email: "existing@example.com" });
    expect(invites.items).toHaveLength(0);
  });

  it("usage / missing argv — both sub-cases exit 1 with Usage message", async () => {
    const inviteCli = await import("../../src/cli/adminBootstrapInvite.js");

    // Sub-case A: no email, no role
    const resultA = await runMain(inviteCli, ["node", "script"]);
    expect(resultA.exitCode).toBe(1);
    expect(resultA.stderr.some((s) => s.includes("Usage:"))).toBe(true);

    // Sub-case B: email provided but no role
    const resultB = await runMain(inviteCli, ["node", "script", "e@x.com"]);
    expect(resultB.exitCode).toBe(1);
    expect(resultB.stderr.some((s) => s.includes("Usage:"))).toBe(true);
  });

  it("invalid email (ZodError) — exits 1 with invalid email message", async () => {
    const inviteCli = await import("../../src/cli/adminBootstrapInvite.js");

    const { stderr, exitCode } = await runMain(inviteCli, [
      "node",
      "script",
      "not-an-email",
      "member",
    ]);

    expect(exitCode).toBe(1);
    expect(stderr.some((s) => s.includes("invalid email"))).toBe(true);
  });

  it("invalid role (ZodError) — exits 1 with invalid role message", async () => {
    const inviteCli = await import("../../src/cli/adminBootstrapInvite.js");

    const { stderr, exitCode } = await runMain(inviteCli, [
      "node",
      "script",
      "e@x.com",
      "super",
    ]);

    expect(exitCode).toBe(1);
    expect(stderr.some((s) => s.includes("invalid role"))).toBe(true);
  });

  it("double-run, no user yet — creates 2 distinct valid invites for the same email", async () => {
    const inviteCli = await import("../../src/cli/adminBootstrapInvite.js");

    // Act — run twice with identical args (no unique-on-email constraint on invites table)
    await runMain(inviteCli, ["node", "script", "dup@example.com", "member"]);
    await runMain(inviteCli, ["node", "script", "dup@example.com", "member"]);

    // Assert — 2 distinct rows for the same email
    const invites = await persistence!.listInvites({ page: 1, limit: 100, email: "dup@example.com" });
    expect(invites.items).toHaveLength(2);
    expect(invites.items[0].code).not.toBe(invites.items[1].code);

    // Assert — both are valid, unused, unrevoked
    for (const invite of invites.items) {
      const invStatus = await persistence!.getInviteStatus(invite.code);
      expect(invStatus).toBe("valid");
      expect(invite.usedAt).toBeNull();
      expect(invite.revokedAt).toBeNull();
    }
  });

  it("no audit entry written — insertBootstrapInvite skips audit unlike HTTP POST /invites", async () => {
    // Arrange
    const inviteCli = await import("../../src/cli/adminBootstrapInvite.js");

    // Act — run happy path
    const { stdout } = await runMain(inviteCli, [
      "node",
      "script",
      "audit-check@example.com",
      "member",
    ]);

    // Extract created invite code
    const codeMatch = stdout[0].match(/^Created invite (\S+) for audit-check@example\.com$/);
    expect(codeMatch).not.toBeNull();
    const code = codeMatch![1];

    // Assert — no audit rows at all (DB is fresh from beforeEach; insertBootstrapInvite never
    // calls appendAuditLog, in contrast to the HTTP POST /invites route which emits
    // admin_invite_issued).
    const auditResult = await persistence!.listAuditLog({ page: 1, limit: 100 });
    expect(auditResult.total).toBe(0);
    // Belt-and-suspenders: explicitly confirm no row references this invite code
    const matchingRows = auditResult.items.filter((row) => row.metadata.inviteCode === code);
    expect(matchingRows).toHaveLength(0);
  });
});
