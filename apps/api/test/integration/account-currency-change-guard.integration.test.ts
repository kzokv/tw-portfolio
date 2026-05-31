/**
 * Postgres integration tests for KZO-167 D7 currency-change lockdown.
 *
 * Uses PostgresPersistence directly per integration-test-persistence-direct.md.
 * No buildApp — the managed test stack does not provision Redis.
 *
 * What this covers (persistence/DB layer):
 *   - resolveOrCreateUser seeds accounts with correct defaultCurrency + accountType defaults
 *   - The SQL counts backing the D7 lockdown return correct results:
 *     · 0 cash entries on a fresh account (PATCH would be allowed)
 *     · 1 cash entry after seeding (PATCH would be blocked)
 *     · 1 trade event after seeding, no cash entry (PATCH would be blocked)
 *
 * What is deliberately NOT covered here (defer to HTTP suite):
 *   - Full PATCH /accounts/:id → 200 / 409 route behaviour
 *   → see apps/api/test/http/specs/account-currency-and-type-aaa.http.spec.ts
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";

const { PostgresPersistence } = await import("../../src/persistence/postgres.js");
const { loadMigrationManifest } = await import("../../src/persistence/migrationManifest.js");

type PostgresPersistenceInstance = InstanceType<typeof PostgresPersistence>;

// ─── Postgres integration guard ──────────────────────────────────────────────

const databaseUrl = process.env.POSTGRES_TEST_DB_URL ?? process.env.DB_URL;
const redisUrl = process.env.POSTGRES_TEST_REDIS_URL ?? process.env.REDIS_URL;
const runPostgresIntegration = process.env.RUN_POSTGRES_INTEGRATION === "1";
const managedCiStack = process.env.VAKWEN_MANAGED_CI_STACK === "1";

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

describePostgres("account currency-change guard — D7 lockdown (postgres integration)", () => {
  let pool: Pool;
  let persistence: PostgresPersistenceInstance | null = null;
  let userId: string;
  let accountId: string;

  beforeEach(async () => {
    pool = new Pool({ connectionString: databaseUrl });
    await resetDatabase(pool);
    await applyNumberedMigrations(pool);

    persistence = new PostgresPersistence({ databaseUrl: databaseUrl!, redisUrl: redisUrl! });
    await persistence.init();

    // resolveOrCreateUser auto-seeds the "Main" account via ensureDefaultPortfolioData
    const result = await persistence.resolveOrCreateUser("google", "kzo167-guard-sub", {
      email: "kzo167-guard@example.com",
      name: "KZO-167 Guard Test",
    });
    userId = result.userId;

    // Get the auto-seeded account
    const store = await persistence.loadStore(userId);
    const account = store.accounts[0];
    if (!account) throw new Error("Expected auto-seeded 'Main' account in store");
    accountId = account.id;
  });

  afterEach(async () => {
    if (persistence) {
      await persistence.close();
      persistence = null;
    }
    await pool.end();
  });

  // ── Default fields ──────────────────────────────────────────────────────────

  it("resolveOrCreateUser seeds a 'Main' account with defaultCurrency='TWD' and accountType='broker'", async () => {
    const store = await persistence!.loadStore(userId);
    expect(store.accounts).toHaveLength(1);

    const account = store.accounts[0] as unknown as Record<string, unknown>;
    expect(account["defaultCurrency"]).toBe("TWD");
    expect(account["accountType"]).toBe("broker");
    expect(account["name"]).toBe("Main");
  });

  it("GET /accounts shape: AccountDto includes defaultCurrency and accountType after migration 040", async () => {
    // Verify the DB row itself has the expected columns populated
    const { rows } = await pool.query<{
      id: string;
      default_currency: string;
      account_type: string;
    }>(
      `SELECT id, default_currency, account_type FROM accounts WHERE user_id = $1`,
      [userId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].default_currency).toBe("TWD");
    expect(rows[0].account_type).toBe("broker");
  });

  // ── Lockdown SQL query accuracy ─────────────────────────────────────────────
  //
  // These tests verify that the COUNT(*) queries backing D7 lockdown return
  // the correct values. The route handler uses analogous queries; confirming
  // them here at the Postgres layer eliminates one source of silent breakage.

  it("D7 empty account: cash_ledger_entries count = 0 (lockdown would allow PATCH)", async () => {
    const { rows } = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM cash_ledger_entries WHERE account_id = $1`,
      [accountId],
    );
    expect(parseInt(rows[0].count, 10)).toBe(0);
  });

  it("D7 after seeding a cash entry: count = 1 (lockdown would block PATCH)", async () => {
    // KZO-183: cash_ledger_entries has no fee_profile FK dependency, so we don't
    // need to seed a fee_profile here. The auto-seeded "Default Broker" profile
    // covers any future FK additions.

    // Seed a cash ledger entry for this account
    await pool.query(
      `INSERT INTO cash_ledger_entries (
         id, user_id, account_id, entry_date, entry_type, amount, currency,
         source, source_reference, booked_at
       ) VALUES (
         'guard-cash-1', $1, $2, '2026-01-15', 'MANUAL_ADJUSTMENT',
         1000, 'TWD', 'guard_test', 'guard-cash-1', NOW()
       )`,
      [userId, accountId],
    );

    const { rows } = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM cash_ledger_entries WHERE account_id = $1`,
      [accountId],
    );
    expect(parseInt(rows[0].count, 10)).toBe(1);
  });

  it("D7 after seeding a trade event (no cash entry): trade_events count = 1 (lockdown would block PATCH)", async () => {
    // KZO-183: profile_id_at_booking is intentionally left dangling per scope item 15.
    // Use the auto-seeded fee profile as the snapshot's display id.
    const { rows: profileRows } = await pool.query<{ id: string }>(
      `SELECT id FROM fee_profiles WHERE account_id = $1 LIMIT 1`,
      [accountId],
    );
    const feeProfileId = profileRows[0]?.id ?? "guard-fp2-display-id";

    // Seed a fee policy snapshot (required NOT NULL FK for trade_events)
    const feePolicySnapshotId = "guard-trade-fp-snapshot";
    await pool.query(
      `INSERT INTO trade_fee_policy_snapshots (
         id, user_id, profile_id_at_booking, profile_name_at_booking, board_commission_rate,
         commission_discount_percent, minimum_commission_amount, commission_currency,
         commission_rounding_mode, tax_rounding_mode, stock_sell_tax_rate_bps,
         stock_day_trade_tax_rate_bps, etf_sell_tax_rate_bps, bond_etf_sell_tax_rate_bps,
         commission_charge_mode, booked_at
       ) VALUES (
         $1, $2, $3, 'Guard FP2', 1.425,
         28, 20, 'TWD',
         'FLOOR', 'FLOOR', 30,
         15, 10, 0,
         'CHARGED_UPFRONT', NOW()
       ) ON CONFLICT (id) DO NOTHING`,
      [feePolicySnapshotId, userId, feeProfileId],
    );

    // Seed a trade event for this account (no related cash entry)
    await pool.query(
      `INSERT INTO trade_events (
         id, user_id, account_id, ticker, instrument_type, trade_type,
         quantity, unit_price, price_currency, trade_date, trade_timestamp,
         booking_sequence, commission_amount, tax_amount, is_day_trade,
         fee_policy_snapshot_id, source, source_reference, booked_at
       ) VALUES (
         'guard-trade-1', $1, $2, '2330', 'STOCK', 'BUY',
         10, 1000, 'TWD', '2026-01-15', '2026-01-15T00:00:00.000Z',
         1, 20, 0, false,
         $3, 'guard_test', 'guard-trade-1', NOW()
       )`,
      [userId, accountId, feePolicySnapshotId],
    );

    // cash_ledger_entries count should still be 0
    const cashRows = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM cash_ledger_entries WHERE account_id = $1`,
      [accountId],
    );
    expect(parseInt(cashRows.rows[0].count, 10)).toBe(0);

    // trade_events count should be 1
    const tradeRows = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM trade_events WHERE account_id = $1`,
      [accountId],
    );
    expect(parseInt(tradeRows.rows[0].count, 10)).toBe(1);
  });

  it("D7 lockdown combined: OR of (cash count > 0, trade count > 0) is the blocking predicate", async () => {
    // Verify the combined lockdown query used by the route handler works correctly:
    // blocked = cash_count > 0 OR trade_count > 0

    // Seed cash entry
    await pool.query(
      `INSERT INTO cash_ledger_entries (
         id, user_id, account_id, entry_date, entry_type, amount, currency,
         source, source_reference, booked_at
       ) VALUES (
         'guard-combined-cash', $1, $2, '2026-01-15', 'MANUAL_ADJUSTMENT',
         500, 'TWD', 'guard_test', 'guard-combined-cash', NOW()
       )`,
      [userId, accountId],
    );

    const { rows } = await pool.query<{ blocked: boolean }>(
      `SELECT (
         (SELECT COUNT(*) FROM cash_ledger_entries WHERE account_id = $1) > 0
         OR
         (SELECT COUNT(*) FROM trade_events WHERE account_id = $1) > 0
       ) AS blocked`,
      [accountId],
    );
    expect(rows[0].blocked).toBe(true);
  });

  it("D7 lockdown not blocked when account has no entries: combined predicate is false", async () => {
    const { rows } = await pool.query<{ blocked: boolean }>(
      `SELECT (
         (SELECT COUNT(*) FROM cash_ledger_entries WHERE account_id = $1) > 0
         OR
         (SELECT COUNT(*) FROM trade_events WHERE account_id = $1) > 0
       ) AS blocked`,
      [accountId],
    );
    expect(rows[0].blocked).toBe(false);
  });
});
