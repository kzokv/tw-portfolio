import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const { PostgresPersistence } = await import("../../src/persistence/postgres.js");
const { MemoryPersistence } = await import("../../src/persistence/memory.js");
const { loadMigrationManifest } = await import("../../src/persistence/migrationManifest.js");
const { generateAnonymousShareToken } = await import("../../src/lib/anonymousShareToken.js");

// ── Postgres integration guard ────────────────────────────────────────────────

const databaseUrl = process.env.POSTGRES_TEST_DB_URL ?? process.env.DB_URL;
const redisUrl = process.env.POSTGRES_TEST_REDIS_URL ?? process.env.REDIS_URL;
const runPostgresIntegration = process.env.RUN_POSTGRES_INTEGRATION === "1";
const managedCiStack = process.env.TWP_MANAGED_CI_STACK === "1";

if (runPostgresIntegration && !managedCiStack) {
  throw new Error(
    "RUN_POSTGRES_INTEGRATION=1 must be executed via npm run test:integration:full:host or " +
      "npm run test:integration:full:container so the DB/Redis stack is managed automatically.",
  );
}

const shouldRunPostgresSuite = runPostgresIntegration && Boolean(databaseUrl) && Boolean(redisUrl);
const describePostgres = shouldRunPostgresSuite ? describe : describe.skip;

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(currentDir, "../../../../db/migrations");
const migrationManifestPromise = loadMigrationManifest(migrationsDir);

// ── Postgres integration suite ────────────────────────────────────────────────

describePostgres("anonymous_share_tokens purge (Postgres)", () => {
  let pool: Pool;
  let persistence: InstanceType<typeof PostgresPersistence> | null = null;
  let ownerUserId: string;

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

    // Seed the owner user row required by the anonymous_share_tokens FK.
    const seeded = await persistence.resolveOrCreateUser("google", "kzo-152-purge-owner-sub", {
      email: "kzo152-purge-owner@example.com",
      name: "KZO-152 Purge Owner",
    });
    ownerUserId = seeded.userId;
  });

  afterEach(async () => {
    if (persistence) {
      await persistence.close();
      persistence = null;
    }
    await pool.end();
  });

  it("purges terminal rows older than the cutoff and preserves recent/active rows", async () => {
    // Tokens must be 22 alphanumeric chars to satisfy the persistence layer.
    // We build them deterministically so ids are predictable for ORDER BY assertions.
    const rows = [
      {
        id: "id-old-revoked",
        token: "hasholdrevokedAAAAAAAA",
        // revoked_at older than 90-day cutoff → DELETE
        created_at: "NOW() - INTERVAL '120 days'",
        expires_at: "NOW() + INTERVAL '30 days'",
        revoked_at: "NOW() - INTERVAL '100 days'",
      },
      {
        id: "id-old-expired",
        token: "hasholdexpiredAAAAAAAA",
        // expires_at older than 90-day cutoff, revoked_at NULL → DELETE
        created_at: "NOW() - INTERVAL '120 days'",
        expires_at: "NOW() - INTERVAL '100 days'",
        revoked_at: null,
      },
      {
        id: "id-recent-revoked",
        token: "hashrecentrevokedAAAAA",
        // revoked_at within 90-day cutoff → PRESERVE
        created_at: "NOW() - INTERVAL '10 days'",
        expires_at: "NOW() + INTERVAL '30 days'",
        revoked_at: "NOW() - INTERVAL '10 days'",
      },
      {
        id: "id-active-old",
        token: "hashactiveoldAAAAAAAAA",
        // expires_at in the future, revoked_at NULL — created 120d ago but not yet terminal
        // → PRESERVE (regression guard for the terminality-not-created_at fix)
        created_at: "NOW() - INTERVAL '120 days'",
        expires_at: "NOW() + INTERVAL '30 days'",
        revoked_at: null,
      },
    ] as const;

    for (const row of rows) {
      if (row.revoked_at !== null) {
        await pool.query(
          `INSERT INTO anonymous_share_tokens
             (id, token, owner_user_id, created_at, expires_at, revoked_at)
           VALUES ($1, $2, $3, ${row.created_at}, ${row.expires_at}, ${row.revoked_at})`,
          [row.id, row.token, ownerUserId],
        );
      } else {
        await pool.query(
          `INSERT INTO anonymous_share_tokens
             (id, token, owner_user_id, created_at, expires_at)
           VALUES ($1, $2, $3, ${row.created_at}, ${row.expires_at})`,
          [row.id, row.token, ownerUserId],
        );
      }
    }

    // Exercise the persistence method directly (not pg-boss wiring).
    const deleted = await persistence!.purgeTerminalAnonymousShareTokens(90 * 24 * 60 * 60 * 1000);

    expect(deleted).toBe(2);

    // Verify surviving rows — sorted alphabetically by id.
    const { rows: surviving } = await pool.query<{ id: string }>(
      "SELECT id FROM anonymous_share_tokens ORDER BY id",
    );
    expect(surviving.map((r) => r.id)).toEqual(["id-active-old", "id-recent-revoked"]);
  });
});

// ── Memory no-op suite — always runs (not gated by describePostgres) ──────────

describe("anonymous_share_tokens purge (Memory no-op)", () => {
  it("returns 0 and does not mutate token store", async () => {
    const mem = new MemoryPersistence();
    await mem.init();

    // Seed a user and one token using the public API.
    const { userId } = await mem.resolveOrCreateUser("google", "purge-mem-owner-sub", {
      email: "purge-mem-owner@example.com",
      name: "Purge Mem Owner",
    });

    const token = generateAnonymousShareToken();
    const createResult = await mem.createAnonymousShareToken({
      ownerUserId: userId,
      token,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      ttlDays: 30,
      auditInput: { actorUserId: null, ipAddress: null },
    });
    expect(createResult.status).toBe("ok");

    const before = await mem.listAnonymousShareTokensForOwner(userId);
    expect(before).toHaveLength(1);

    // cutoffMs=0 means everything qualifies for deletion, but memory is always a no-op.
    const result = await mem.purgeTerminalAnonymousShareTokens(0);

    expect(result).toBe(0);

    const after = await mem.listAnonymousShareTokensForOwner(userId);
    expect(after).toHaveLength(before.length);

    await mem.close();
  });
});
