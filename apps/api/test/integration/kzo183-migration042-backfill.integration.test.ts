/**
 * KZO-183 — migration 042 backfill golden-fixture (Postgres integration).
 *
 * Applies migrations up to 041 (inclusive), seeds a pre-rescope state where
 * a single fee_profile is shared by multiple accounts, then applies migration
 * 042 and verifies the fan-out backfill rules (D6):
 *   - Primary account keeps original profile id + name.
 *   - Other accounts get new ids and suffixed names.
 *   - Tax rules cascade to all fan-out copies.
 *   - accounts.fee_profile_id is repointed to the per-account row.
 *   - account_fee_profile_overrides.fee_profile_id is repointed.
 *   - fee_profiles.user_id and account_fee_profile_overrides.market_code dropped.
 *
 * Pattern: `PostgresPersistence` directly per
 * `integration-test-persistence-direct.md` "Full pattern".
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";

const { loadMigrationManifest } = await import("../../src/persistence/migrationManifest.js");

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

/**
 * Apply numbered migrations up to (but NOT including) `stopBeforeFile`.
 * Used to reproduce a pre-042 state.
 */
async function applyMigrationsUpTo(pool: Pool, stopBeforeFile: string): Promise<void> {
  const manifest = await migrationManifestPromise;
  const client = await pool.connect();
  try {
    for (const file of manifest.numberedMigrations) {
      if (file === stopBeforeFile) break;
      const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
      await client.query(sql);
    }
  } finally {
    client.release();
  }
}

/** Apply a single named migration file. */
async function applyMigration(pool: Pool, file: string): Promise<void> {
  const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
  const client = await pool.connect();
  try {
    await client.query(sql);
  } finally {
    client.release();
  }
}

// ─── Suite ───────────────────────────────────────────────────────────────────

describePostgres("KZO-183: migration 042 backfill golden fixture (postgres integration)", () => {
  let pool: Pool;

  // Pre-042 test fixture ids — deterministic for assertion stability.
  const userId = "mbk-user-001";
  const profileId = "mbk-profile-original";
  const accountA1Id = "mbk-account-a1"; // primary (lowest id, alphabetically)
  const accountA2Id = "mbk-account-a2"; // fan-out copy → name suffix
  const accountA3Id = "mbk-account-a3"; // fan-out copy → name suffix

  beforeEach(async () => {
    pool = new Pool({ connectionString: databaseUrl });
    await resetDatabase(pool);
    // Apply all migrations UP TO (not including) 042.
    await applyMigrationsUpTo(pool, "042_kzo183_account_scoped_fee_profiles.sql");

    // ── Seed pre-042 state ──────────────────────────────────────────────────
    // One user, one shared fee_profile referenced by three accounts.

    await pool.query(
      `INSERT INTO users (id, email, display_name, locale, cost_basis_method, quote_poll_interval_seconds, role)
       VALUES ($1, $2, 'MBK Test', 'en', 'WEIGHTED_AVERAGE', 10, 'member')`,
      [userId, "mbk-test@example.com"],
    );

    // Insert the single shared fee profile (pre-042: user_id present).
    await pool.query(
      `INSERT INTO fee_profiles (
         id, user_id, name, commission_rate_bps, board_commission_rate, commission_discount_percent,
         commission_discount_bps, minimum_commission_amount, commission_currency,
         commission_rounding_mode, tax_rounding_mode, stock_sell_tax_rate_bps,
         stock_day_trade_tax_rate_bps, etf_sell_tax_rate_bps, bond_etf_sell_tax_rate_bps,
         commission_charge_mode
       ) VALUES ($1, $2, 'Original Broker', 14, 1.425, 0, 10000, 20, 'TWD', 'FLOOR', 'FLOOR',
                 30, 15, 10, 0, 'CHARGED_UPFRONT')`,
      [profileId, userId],
    );

    // Seed a tax rule row on the shared profile (MBK-3: tax rules cascade to all copies).
    await pool.query(
      `INSERT INTO fee_profile_tax_rules (
         id, user_id, fee_profile_id, market_code, trade_side, instrument_type,
         day_trade_scope, tax_component_code, calculation_method, rate_bps, sort_order
       ) VALUES ('mbk-tax-rule-001', $1, $2, 'TW', 'SELL', 'STOCK', 'ANY', 'securities_transaction_tax', 'RATE_BPS', 30, 1)`,
      [userId, profileId],
    );

    // Three accounts all referencing the same shared profile.
    for (const [accId, accName, currency] of [
      [accountA1Id, "Main", "TWD"],
      [accountA2Id, "Side Account B", "TWD"],
      [accountA3Id, "Side Account C", "TWD"],
    ] as [string, string, string][]) {
      await pool.query(
        `INSERT INTO accounts (id, user_id, name, fee_profile_id, default_currency, account_type)
         VALUES ($1, $2, $3, $4, $5, 'broker')`,
        [accId, userId, accName, profileId, currency],
      );
    }

    // Seed an override row for accountA2 pointing at the shared profile (MBK-6).
    await pool.query(
      `INSERT INTO account_fee_profile_overrides (account_id, ticker, fee_profile_id, market_code)
       VALUES ($1, '2330', $2, 'TW')`,
      [accountA2Id, profileId],
    );
  });

  afterEach(async () => {
    await pool.end();
  });

  it("migration 042 applies cleanly against the pre-seeded fixture", async () => {
    // Should not throw.
    await expect(
      applyMigration(pool, "042_kzo183_account_scoped_fee_profiles.sql"),
    ).resolves.not.toThrow();
  });

  it("fan-out: 1 shared profile → 3 per-account profiles (MBK-1)", async () => {
    await applyMigration(pool, "042_kzo183_account_scoped_fee_profiles.sql");

    const { rows } = await pool.query<{ id: string; account_id: string }>(
      `SELECT id, account_id FROM fee_profiles
       ORDER BY account_id`,
    );
    expect(rows).toHaveLength(3);
    const accountIds = rows.map((r) => r.account_id).sort();
    expect(accountIds).toEqual([accountA1Id, accountA2Id, accountA3Id].sort());
  });

  it("primary account keeps original profile id and original name (MBK-2)", async () => {
    await applyMigration(pool, "042_kzo183_account_scoped_fee_profiles.sql");

    // accountA1Id is lowest alphabetically → becomes primary → keeps profileId and 'Original Broker'.
    const { rows } = await pool.query<{ id: string; name: string; account_id: string }>(
      `SELECT id, name, account_id FROM fee_profiles WHERE account_id = $1`,
      [accountA1Id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(profileId);
    expect(rows[0].name).toBe("Original Broker");
  });

  it("non-primary accounts get suffixed names (MBK-2)", async () => {
    await applyMigration(pool, "042_kzo183_account_scoped_fee_profiles.sql");

    const { rows: a2 } = await pool.query<{ name: string }>(
      `SELECT name FROM fee_profiles WHERE account_id = $1`,
      [accountA2Id],
    );
    expect(a2).toHaveLength(1);
    expect(a2[0].name).toBe("Original Broker (Account Side Account B)");

    const { rows: a3 } = await pool.query<{ name: string }>(
      `SELECT name FROM fee_profiles WHERE account_id = $1`,
      [accountA3Id],
    );
    expect(a3).toHaveLength(1);
    expect(a3[0].name).toBe("Original Broker (Account Side Account C)");
  });

  it("tax rules cascade to all fan-out copies — one rule per profile (MBK-3)", async () => {
    await applyMigration(pool, "042_kzo183_account_scoped_fee_profiles.sql");

    // Each of the 3 profiles should have exactly 1 tax rule.
    const { rows } = await pool.query<{ fee_profile_id: string; count: string }>(
      `SELECT fee_profile_id, COUNT(*)::text AS count FROM fee_profile_tax_rules GROUP BY fee_profile_id`,
    );
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.count).toBe("1");
    }
  });

  it("accounts.fee_profile_id is repointed to the per-account profile (MBK-5)", async () => {
    await applyMigration(pool, "042_kzo183_account_scoped_fee_profiles.sql");

    const { rows } = await pool.query<{ id: string; fee_profile_id: string }>(
      `SELECT a.id, a.fee_profile_id
       FROM accounts a
       JOIN fee_profiles fp ON fp.id = a.fee_profile_id
       WHERE fp.account_id = a.id
       ORDER BY a.id`,
    );
    // All 3 accounts should have fee_profile_id pointing to their own profile.
    expect(rows).toHaveLength(3);
    const accountIds = rows.map((r) => r.id).sort();
    expect(accountIds).toEqual([accountA1Id, accountA2Id, accountA3Id].sort());
  });

  it("account_fee_profile_overrides.fee_profile_id repointed; market_code column dropped (MBK-6)", async () => {
    await applyMigration(pool, "042_kzo183_account_scoped_fee_profiles.sql");

    // The override for accountA2/'2330' should now point at accountA2's own profile.
    const { rows } = await pool.query<{ account_id: string; ticker: string; fee_profile_id: string }>(
      `SELECT account_id, ticker, fee_profile_id FROM account_fee_profile_overrides`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].account_id).toBe(accountA2Id);
    expect(rows[0].ticker).toBe("2330");

    // The profile referenced by the override must be owned by accountA2.
    const { rows: profileRows } = await pool.query<{ account_id: string }>(
      `SELECT account_id FROM fee_profiles WHERE id = $1`,
      [rows[0].fee_profile_id],
    );
    expect(profileRows).toHaveLength(1);
    expect(profileRows[0].account_id).toBe(accountA2Id);

    // market_code column no longer exists.
    const { rows: colRows } = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'account_fee_profile_overrides'
         AND column_name = 'market_code'`,
    );
    expect(colRows).toHaveLength(0);
  });

  it("fee_profiles.user_id and fee_profile_tax_rules.user_id columns are dropped (MBK-7)", async () => {
    await applyMigration(pool, "042_kzo183_account_scoped_fee_profiles.sql");

    for (const tableName of ["fee_profiles", "fee_profile_tax_rules"]) {
      const { rows } = await pool.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'user_id'`,
        [tableName],
      );
      expect(rows).toHaveLength(0);
    }
  });
});

// ─── Suffix tie-break suite ───────────────────────────────────────────────────
//
// MBK-4: two accounts share the same display name → suffix includes account id.

describePostgres("KZO-183: backfill suffix tie-break when two accounts share a name (MBK-4)", () => {
  let pool: Pool;

  const userId = "mbk4-user-001";
  const profileId = "mbk4-profile-original";
  const accountA1Id = "mbk4-acct-a1"; // primary (lowest id)
  const accountA2Id = "mbk4-acct-a2"; // same name → suffix + id
  const accountA3Id = "mbk4-acct-a3"; // same name → suffix + id

  beforeEach(async () => {
    pool = new Pool({ connectionString: databaseUrl });
    await resetDatabase(pool);
    await applyMigrationsUpTo(pool, "042_kzo183_account_scoped_fee_profiles.sql");

    await pool.query(
      `INSERT INTO users (id, email, display_name, locale, cost_basis_method, quote_poll_interval_seconds, role)
       VALUES ($1, $2, 'MBK4 Test', 'en', 'WEIGHTED_AVERAGE', 10, 'member')`,
      [userId, "mbk4-test@example.com"],
    );

    await pool.query(
      `INSERT INTO fee_profiles (
         id, user_id, name, commission_rate_bps, board_commission_rate, commission_discount_percent,
         commission_discount_bps, minimum_commission_amount, commission_currency,
         commission_rounding_mode, tax_rounding_mode, stock_sell_tax_rate_bps,
         stock_day_trade_tax_rate_bps, etf_sell_tax_rate_bps, bond_etf_sell_tax_rate_bps,
         commission_charge_mode
       ) VALUES ($1, $2, 'Shared', 14, 1.425, 0, 10000, 20, 'TWD', 'FLOOR', 'FLOOR',
                 30, 15, 10, 0, 'CHARGED_UPFRONT')`,
      [profileId, userId],
    );

    // Three accounts: A1 is primary, A2 + A3 share the name "Duplicate Name".
    // The ux_accounts_user_id_name unique index prevents two accounts with the same name
    // per user, so we use DISTINCT names here — but A2 + A3 mimic the "different users can
    // share a name" tie-break path by using an in-test collision simulation:
    // D6 says: if two NON-PRIMARY accounts have the same account_name, include the account id.
    // We seed two non-primary accounts with the same name "Dup" to trigger the id-suffix branch.
    await pool.query(
      `INSERT INTO accounts (id, user_id, name, fee_profile_id, default_currency, account_type)
       VALUES ($1, $2, 'Main', $3, 'TWD', 'broker')`,
      [accountA1Id, userId, profileId],
    );
    // Two non-primary accounts — normally same-user can't share name (41 unique index);
    // use the same-profile-different-user bypass: insert a second user for A2, A3.
    const userId2 = "mbk4-user-002";
    const userId3 = "mbk4-user-003";
    await pool.query(
      `INSERT INTO users (id, email, display_name, locale, cost_basis_method, quote_poll_interval_seconds, role)
       VALUES ($1, $2, 'MBK4 Test 2', 'en', 'WEIGHTED_AVERAGE', 10, 'member'),
              ($3, $4, 'MBK4 Test 3', 'en', 'WEIGHTED_AVERAGE', 10, 'member')`,
      [userId2, "mbk4-test2@example.com", userId3, "mbk4-test3@example.com"],
    );
    await pool.query(
      `INSERT INTO accounts (id, user_id, name, fee_profile_id, default_currency, account_type)
       VALUES ($1, $2, 'Dup', $3, 'TWD', 'broker'),
              ($4, $5, 'Dup', $3, 'TWD', 'broker')`,
      [accountA2Id, userId2, profileId, accountA3Id, userId3],
    );
  });

  afterEach(async () => {
    await pool.end();
  });

  it("two non-primary accounts with same name get id-suffixed names (MBK-4)", async () => {
    await applyMigration(pool, "042_kzo183_account_scoped_fee_profiles.sql");

    const { rows: a2 } = await pool.query<{ name: string }>(
      `SELECT name FROM fee_profiles WHERE account_id = $1`,
      [accountA2Id],
    );
    const { rows: a3 } = await pool.query<{ name: string }>(
      `SELECT name FROM fee_profiles WHERE account_id = $1`,
      [accountA3Id],
    );
    expect(a2).toHaveLength(1);
    expect(a3).toHaveLength(1);
    // Both names must include the account id suffix to disambiguate.
    expect(a2[0].name).toContain(accountA2Id);
    expect(a3[0].name).toContain(accountA3Id);
  });
});
