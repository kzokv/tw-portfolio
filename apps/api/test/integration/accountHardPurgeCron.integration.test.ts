/**
 * ui-enhancement — Integration test for the daily hard-purge cron retention
 * predicate.
 *
 * Pattern per `integration-test-persistence-direct.md` "Testing retention /
 * purge crons" section: raw INSERT with SQL interval literals to produce
 * back-dated `deleted_at` rows (the persistence API stamps NOW() on
 * softDeleteAccount, so we cannot produce 40-day-old rows through it).
 *
 * Cases:
 *  - 1 row at deleted_at = NOW() - INTERVAL '40 days' → selected for purge
 *    when graceDays=30.
 *  - 1 regression-guard row at deleted_at = NOW() - INTERVAL '5 days' →
 *    MUST be PRESERVED.
 *  - 1 active row (deleted_at IS NULL) → MUST be PRESERVED (regression
 *    against any future predicate that uses `created_at` instead of
 *    `deleted_at`).
 *
 * Memory-side sibling describe block: `selectAccountsForHardPurge` returns
 * candidates for memory backend too — the cron's data source is identical.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const { PostgresPersistence } = await import("../../src/persistence/postgres.js");
const { MemoryPersistence } = await import("../../src/persistence/memory.js");
const { loadMigrationManifest } = await import("../../src/persistence/migrationManifest.js");

const databaseUrl = process.env.POSTGRES_TEST_DB_URL ?? process.env.DB_URL;
const redisUrl = process.env.POSTGRES_TEST_REDIS_URL ?? process.env.REDIS_URL;
const runPostgresIntegration = process.env.RUN_POSTGRES_INTEGRATION === "1";
const managedCiStack = process.env.TWP_MANAGED_CI_STACK === "1";
if (runPostgresIntegration && !managedCiStack) {
  throw new Error("RUN_POSTGRES_INTEGRATION=1 must be executed via npm run test:integration:full:host");
}
const shouldRunPostgresSuite = runPostgresIntegration && Boolean(databaseUrl) && Boolean(redisUrl);
const describePostgres = shouldRunPostgresSuite ? describe : describe.skip;

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(currentDir, "../../../../db/migrations");
const migrationManifestPromise = loadMigrationManifest(migrationsDir);

describePostgres("selectAccountsForHardPurge — retention predicate (Postgres)", () => {
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
        const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
        await client.query(sql);
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
    const seeded = await persistence.resolveOrCreateUser(
      "google",
      "ui-enhancement-cron-owner-sub",
      { email: "uie-cron@example.com", name: "Cron Owner" },
    );
    ownerUserId = seeded.userId;
  });

  afterEach(async () => {
    if (persistence) {
      await persistence.close();
      persistence = null;
    }
    await pool.end();
  });

  /**
   * Raw INSERT into accounts with a back-dated deleted_at.
   *
   * Per migration 042 (KZO-183) fee_profiles is account-scoped — there is no
   * `fee_profiles.user_id` column. The composite FK
   * `accounts.(fee_profile_id, id) REFERENCES fee_profiles(id, account_id)`
   * requires each account to own its OWN fee_profile, so this helper inserts
   * one fresh fee_profile per account (mirroring `createDefaultFeeProfile`).
   *
   * The accounts INSERT is wrapped in a DEFERRABLE transaction so the
   * composite FK check is deferred to COMMIT, allowing fee_profile and
   * account rows to land in either order (the composite FK in migration 042
   * is DEFERRABLE INITIALLY DEFERRED).
   */
  async function insertRawAccount(
    id: string,
    name: string,
    deletedAtSql: string | null,
  ): Promise<void> {
    const feeProfileId = `fp-${id}`;
    const deletedAtExpr = deletedAtSql ?? "NULL";

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Insert the account first; composite FK is DEFERRABLE so it does not
      // fire until COMMIT.
      await client.query(
        `INSERT INTO accounts (id, user_id, name, fee_profile_id, default_currency, account_type, deleted_at)
         VALUES ($1, $2, $3, $4, 'TWD', 'broker', ${deletedAtExpr})`,
        [id, ownerUserId, name, feeProfileId],
      );

      // Insert the matching fee_profile (account-scoped).
      await client.query(
        `INSERT INTO fee_profiles (
           id, account_id, name, commission_rate_bps, board_commission_rate,
           commission_discount_percent, commission_discount_bps,
           minimum_commission_amount, commission_currency,
           commission_rounding_mode, tax_rounding_mode,
           stock_sell_tax_rate_bps, stock_day_trade_tax_rate_bps,
           etf_sell_tax_rate_bps, bond_etf_sell_tax_rate_bps,
           commission_charge_mode
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
         )`,
        [
          feeProfileId,
          id,
          "Default Broker",
          0,
          1.425,
          0,
          0,
          20,
          "TWD",
          "FLOOR",
          "FLOOR",
          30,
          15,
          10,
          0,
          "CHARGED_UPFRONT",
        ],
      );

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  it("selects rows older than graceDays AND preserves recent + active rows (regression guards)", async () => {
    // Old soft-deleted row → candidate
    await insertRawAccount("acc-old", "Old Deleted", "NOW() - INTERVAL '40 days'");
    // Recent soft-deleted row → REGRESSION GUARD: must survive
    await insertRawAccount("acc-recent", "Recent Deleted", "NOW() - INTERVAL '5 days'");
    // Active row → REGRESSION GUARD: must NEVER be candidate
    await insertRawAccount("acc-active", "Active", null);

    const candidates = await persistence!.selectAccountsForHardPurge(30);

    const ids = candidates.map((c) => c.accountId);
    expect(ids).toContain("acc-old");
    expect(ids).not.toContain("acc-recent");
    expect(ids).not.toContain("acc-active");

    // Each candidate carries the userId for the cron's per-row purge.
    const oldRow = candidates.find((c) => c.accountId === "acc-old");
    expect(oldRow?.userId).toBe(ownerUserId);
  });

  it("admin override of graceDays takes effect on next call (sweep-parameter-live)", async () => {
    await insertRawAccount("acc-7d", "Seven Day Old", "NOW() - INTERVAL '7 days'");

    // graceDays=30 → not yet a candidate.
    const noneYet = await persistence!.selectAccountsForHardPurge(30);
    expect(noneYet.find((c) => c.accountId === "acc-7d")).toBeUndefined();

    // graceDays=5 (admin override) → now a candidate on the same row.
    const overridden = await persistence!.selectAccountsForHardPurge(5);
    expect(overridden.find((c) => c.accountId === "acc-7d")).toBeDefined();
  });
});

// ── Memory backend sibling — MUST always run ──────────────────────────────────
describe("selectAccountsForHardPurge — MemoryPersistence sibling", () => {
  it("returns [] when no accounts soft-deleted (default seed)", async () => {
    const p = new MemoryPersistence();
    await p.resolveOrCreateUser("google", "mem-cron-sub", {
      email: "mem-cron@example.com",
      name: "Mem",
    });
    const result = await p.selectAccountsForHardPurge(30);
    expect(result).toEqual([]);
    await p.close();
  });
});
