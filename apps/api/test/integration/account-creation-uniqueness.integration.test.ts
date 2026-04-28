/**
 * KZO-179 — Postgres integration tests for account-creation uniqueness.
 *
 * Verifies the DB-layer guarantees that back the POST /accounts route's
 * 409 path:
 *   - Migration 041's `ux_accounts_user_id_name` unique index exists and
 *     rejects duplicate `(user_id, name)` rows with PG `unique_violation`
 *     (SQLSTATE 23505).
 *   - `isUniqueViolation()` predicate correctly identifies the resulting
 *     error so the route's `try/catch` safety net can trigger 409.
 *   - Per-user scope is preserved (different users CAN have same name).
 *   - `saveStore()` propagates the unique violation through to the route
 *     (TOCTOU safety-net path).
 *   - Concurrent paired INSERTs deterministically resolve to one survivor.
 *   - `created_at` (Migration 041) is NOT NULL and stamped at insert time.
 *
 * Pattern: `PostgresPersistence` directly per
 * `integration-test-persistence-direct.md` "Full pattern — scoped pool +
 * explicit applyNumberedMigrations". Mirrors the KZO-167 D7 precedent at
 * `apps/api/test/integration/account-currency-change-guard.integration.test.ts`.
 *
 * No `buildApp` — managed test stack pattern + same-domain precedent.
 *
 * What this does NOT cover (deferred to other suites):
 *   - HTTP route 200/400 paths → suite 8 (`account-creation-aaa.http.spec.ts`).
 *   - Form rendering → suite 3 (`AccountCreateForm.test.tsx`).
 *   - Golden-path UI flow → suite 6 (`account-creation-aaa.spec.ts`).
 */

import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";

const { PostgresPersistence } = await import("../../src/persistence/postgres.js");
const { isUniqueViolation } = await import("../../src/persistence/postgres.js");
const { loadMigrationManifest } = await import("../../src/persistence/migrationManifest.js");

type PostgresPersistenceInstance = InstanceType<typeof PostgresPersistence>;

// ─── Postgres integration guard ──────────────────────────────────────────────

const databaseUrl = process.env.POSTGRES_TEST_DB_URL ?? process.env.DB_URL;
const redisUrl = process.env.POSTGRES_TEST_REDIS_URL ?? process.env.REDIS_URL;
const runPostgresIntegration = process.env.RUN_POSTGRES_INTEGRATION === "1";
const managedCiStack = process.env.TWP_MANAGED_CI_STACK === "1";

if (runPostgresIntegration && !managedCiStack) {
  throw new Error(
    "RUN_POSTGRES_INTEGRATION=1 must be executed via npm run test:integration:full:host " +
      "or npm run test:integration:full:container so the DB/Redis stack is managed automatically.",
  );
}

const shouldRunPostgresSuite = runPostgresIntegration && Boolean(databaseUrl) && Boolean(redisUrl);
const describePostgres = shouldRunPostgresSuite ? describe : describe.skip;

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(currentDir, "../../../../db/migrations");
const migrationManifestPromise = loadMigrationManifest(migrationsDir);

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function resetDatabase(pool: Pool): Promise<void> {
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

async function applyNumberedMigrations(pool: Pool): Promise<void> {
  const manifest = await migrationManifestPromise;
  const client = await pool.connect();
  try {
    for (const file of manifest.numberedMigrations) {
      const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
      await client.query(sql);
    }
  } finally {
    client.release();
  }
}

// ─── Suite ───────────────────────────────────────────────────────────────────

describePostgres("account-creation uniqueness — KZO-179 (postgres integration)", () => {
  let pool: Pool;
  let persistence: PostgresPersistenceInstance | null = null;
  let userId: string;
  let mainAccountId: string;
  let feeProfileId: string;

  beforeEach(async () => {
    pool = new Pool({ connectionString: databaseUrl });
    await resetDatabase(pool);
    await applyNumberedMigrations(pool);

    persistence = new PostgresPersistence({ databaseUrl: databaseUrl!, redisUrl: redisUrl! });
    await persistence.init();

    // resolveOrCreateUser auto-seeds the default "Main" account + "Default Broker"
    // fee profile via ensureDefaultPortfolioData. We capture both ids for the tests.
    const result = await persistence.resolveOrCreateUser("google", "kzo179-uniqueness-sub", {
      email: "kzo179-uniqueness@example.com",
      name: "KZO-179 Uniqueness Test",
    });
    userId = result.userId;

    const store = await persistence.loadStore(userId);
    const account = store.accounts[0];
    if (!account) throw new Error("Expected auto-seeded 'Main' account in store");
    mainAccountId = account.id;
    expect(account.name).toBe("Main");

    const profile = store.feeProfiles[0];
    if (!profile) throw new Error("Expected auto-seeded fee profile in store");
    feeProfileId = profile.id;
  });

  afterEach(async () => {
    if (persistence) {
      await persistence.close();
      persistence = null;
    }
    await pool.end();
  });

  // ── Migration 041: index + created_at ───────────────────────────────────────

  it("ux_accounts_user_id_name unique index exists with the expected columns", async () => {
    const { rows } = await pool.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
       WHERE schemaname = 'public' AND indexname = 'ux_accounts_user_id_name'`,
    );
    expect(rows).toHaveLength(1);
    // Index definition includes the (user_id, name) columns in that order.
    expect(rows[0].indexdef).toMatch(/UNIQUE INDEX/);
    expect(rows[0].indexdef).toMatch(/\(user_id,\s*name\)/);
  });

  it("accounts.created_at is NOT NULL with default now() (migration 041)", async () => {
    const { rows } = await pool.query<{ created_at: string | null }>(
      `SELECT created_at FROM accounts WHERE id = $1`,
      [mainAccountId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].created_at).not.toBeNull();
    // created_at should be very recent (within the last 30s of test boot).
    const stampedAt = new Date(rows[0].created_at as string).getTime();
    expect(Number.isFinite(stampedAt)).toBe(true);
    expect(Date.now() - stampedAt).toBeLessThan(30_000);
  });

  // ── Index enforcement (the canonical constraint) ───────────────────────────

  it("direct INSERT with duplicate (user_id, name) rejects with unique_violation (23505)", async () => {
    let captured: unknown = null;
    try {
      await pool.query(
        `INSERT INTO accounts (id, user_id, name, fee_profile_id, default_currency, account_type)
         VALUES ($1, $2, 'Main', $3, 'TWD', 'broker')`,
        [randomUUID(), userId, feeProfileId],
      );
    } catch (err) {
      captured = err;
    }

    expect(captured).not.toBeNull();
    const error = captured as { code?: string };
    expect(error.code).toBe("23505");
    expect(isUniqueViolation(captured)).toBe(true);
  });

  it("isUniqueViolation() returns false for unrelated errors", () => {
    expect(isUniqueViolation(new Error("not a pg error"))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
    expect(isUniqueViolation({ code: "23502" })).toBe(false); // not_null_violation
  });

  // ── Per-user scope ─────────────────────────────────────────────────────────

  it("different users CAN have accounts with the same name (uniqueness is per-user)", async () => {
    const second = await persistence!.resolveOrCreateUser("google", "kzo179-uniqueness-sub-2", {
      email: "kzo179-uniqueness-2@example.com",
      name: "KZO-179 Uniqueness Test 2",
    });
    const userId2 = second.userId;
    expect(userId2).not.toBe(userId);

    const { rows } = await pool.query<{ user_id: string; name: string }>(
      `SELECT user_id, name FROM accounts WHERE name = 'Main' ORDER BY user_id`,
    );
    expect(rows).toHaveLength(2);
    const userIds = rows.map((row) => row.user_id);
    expect(userIds).toContain(userId);
    expect(userIds).toContain(userId2);
  });

  // ── saveStore TOCTOU safety net (the route's catch path) ───────────────────

  it("saveStore propagates the unique violation when a duplicate-name account is pushed", async () => {
    const store = await persistence!.loadStore(userId);
    // Push a second account with the same name as the auto-seeded "Main".
    store.accounts.push({
      id: randomUUID(),
      userId,
      name: "Main",
      feeProfileId,
      defaultCurrency: "USD",
      accountType: "bank",
    });

    let captured: unknown = null;
    try {
      await persistence!.saveStore(store);
    } catch (err) {
      captured = err;
    }

    expect(captured).not.toBeNull();
    expect(isUniqueViolation(captured)).toBe(true);

    // Sanity: only the original "Main" survives.
    const { rows } = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM accounts WHERE user_id = $1 AND name = 'Main'`,
      [userId],
    );
    expect(rows[0].count).toBe("1");
  });

  // ── Concurrent race ────────────────────────────────────────────────────────

  it("two concurrent INSERTs of (userId, 'USD Brokerage') resolve to exactly one survivor", async () => {
    const idA = randomUUID();
    const idB = randomUUID();

    const results = await Promise.allSettled([
      pool.query(
        `INSERT INTO accounts (id, user_id, name, fee_profile_id, default_currency, account_type)
         VALUES ($1, $2, 'USD Brokerage', $3, 'USD', 'bank')`,
        [idA, userId, feeProfileId],
      ),
      pool.query(
        `INSERT INTO accounts (id, user_id, name, fee_profile_id, default_currency, account_type)
         VALUES ($1, $2, 'USD Brokerage', $3, 'USD', 'bank')`,
        [idB, userId, feeProfileId],
      ),
    ]);

    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(isUniqueViolation(rejected[0].reason)).toBe(true);

    const { rows } = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM accounts
       WHERE user_id = $1 AND name = 'USD Brokerage'`,
      [userId],
    );
    expect(rows[0].count).toBe("1");
  });

  // ── Happy path (positive control) ──────────────────────────────────────────

  it("a fresh distinct-name account inserts cleanly with created_at stamped", async () => {
    const newAccountId = randomUUID();
    await pool.query(
      `INSERT INTO accounts (id, user_id, name, fee_profile_id, default_currency, account_type)
       VALUES ($1, $2, 'AUD Wallet', $3, 'AUD', 'wallet')`,
      [newAccountId, userId, feeProfileId],
    );

    const { rows } = await pool.query<{
      name: string;
      default_currency: string;
      account_type: string;
      created_at: string;
    }>(
      `SELECT name, default_currency, account_type, created_at
       FROM accounts WHERE id = $1`,
      [newAccountId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("AUD Wallet");
    expect(rows[0].default_currency).toBe("AUD");
    expect(rows[0].account_type).toBe("wallet");
    expect(rows[0].created_at).not.toBeNull();
  });
});
