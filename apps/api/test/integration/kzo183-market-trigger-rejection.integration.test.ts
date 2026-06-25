/**
 * KZO-183 — market guard: pre-flight CHECKs + post-migration triggers (Postgres integration).
 *
 * Two test surfaces:
 *
 * 1. Pre-flight abort (MTR-1, MTR-2): apply migrations up to 041, seed a row
 *    that violates the market guard, then attempt to apply 042 → migration must
 *    RAISE EXCEPTION and roll back.
 *
 * 2. Post-042 triggers (MTR-3–6): apply all migrations (including 042), then
 *    assert that BEFORE INSERT/UPDATE on trade_events and dividend_ledger_entries
 *    rejects market mismatches with SQLSTATE 23514.
 *
 * Pattern: `PostgresPersistence` directly per
 * `integration-test-persistence-direct.md` "Full pattern".
 */

import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
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

async function applyAllMigrations(pool: Pool): Promise<void> {
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

async function applyMigration(pool: Pool, file: string): Promise<void> {
  const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
  const client = await pool.connect();
  try {
    await client.query(sql);
  } finally {
    client.release();
  }
}

/** Seed a minimal pre-042 user + fee_profile + account row. Returns the ids. */
async function seedMinimalAccount(
  pool: Pool,
  opts: { userId: string; accountId: string; profileId: string; currency: string },
): Promise<void> {
  const { userId, accountId, profileId, currency } = opts;

  await pool.query(
    `INSERT INTO users (id, email, locale, cost_basis_method, quote_poll_interval_seconds, role)
     VALUES ($1, $2, 'en', 'WEIGHTED_AVERAGE', 10, 'member')
     ON CONFLICT (id) DO NOTHING`,
    [userId, `${userId}@example.com`],
  );

  await pool.query(
    `INSERT INTO fee_profiles (
       id, user_id, name, commission_rate_bps, board_commission_rate, commission_discount_percent,
       commission_discount_bps, minimum_commission_amount, commission_currency,
       commission_rounding_mode, tax_rounding_mode, stock_sell_tax_rate_bps,
       stock_day_trade_tax_rate_bps, etf_sell_tax_rate_bps, bond_etf_sell_tax_rate_bps,
       commission_charge_mode
     ) VALUES ($1, $2, 'Test', 14, 1.425, 0, 10000, 20, 'TWD', 'FLOOR', 'FLOOR',
               30, 15, 10, 0, 'CHARGED_UPFRONT')
     ON CONFLICT (id) DO NOTHING`,
    [profileId, userId],
  );

  await pool.query(
    `INSERT INTO accounts (id, user_id, name, fee_profile_id, default_currency, account_type)
     VALUES ($1, $2, 'Test Account', $3, $4, 'broker')
     ON CONFLICT (id) DO NOTHING`,
    [accountId, userId, profileId, currency],
  );
}

/** Seed a minimal trade_fee_policy_snapshot (required FK for trade_events). */
async function seedSnapshot(pool: Pool, userId: string, snapshotId: string): Promise<void> {
  await pool.query(
    `INSERT INTO trade_fee_policy_snapshots (
       id, user_id, profile_id_at_booking, profile_name_at_booking,
       board_commission_rate, commission_discount_percent, minimum_commission_amount,
       commission_currency, commission_rounding_mode, tax_rounding_mode,
       stock_sell_tax_rate_bps, stock_day_trade_tax_rate_bps,
       etf_sell_tax_rate_bps, bond_etf_sell_tax_rate_bps, commission_charge_mode
     ) VALUES ($1, $2, 'fp-test', 'Test Profile', 1.425, 0, 20, 'TWD', 'FLOOR', 'FLOOR',
               30, 15, 10, 0, 'CHARGED_UPFRONT')
     ON CONFLICT (id) DO NOTHING`,
    [snapshotId, userId],
  );
}

// ─── Pre-flight abort suite (MTR-1, MTR-2) ───────────────────────────────────

describePostgres("KZO-183: migration 042 pre-flight aborts on market mismatch (MTR-1, MTR-2)", () => {
  let pool: Pool;

  const userId = "mtr-user-001";
  const accountId = "mtr-acct-001";
  const profileId = "mtr-profile-001";
  const snapshotId = "mtr-snapshot-001";

  beforeEach(async () => {
    pool = new Pool({ connectionString: databaseUrl });
    await resetDatabase(pool);
    await applyMigrationsUpTo(pool, "042_kzo183_account_scoped_fee_profiles.sql");

    // Seed a TWD account.
    await seedMinimalAccount(pool, { userId, accountId, profileId, currency: "TWD" });
  });

  afterEach(async () => {
    await pool.end();
  });

  it("pre-flight: trade_events mismatch (TWD account but US market_code) aborts migration (MTR-1)", async () => {
    await seedSnapshot(pool, userId, snapshotId);

    // Insert a trade_events row with market_code='US' against a TWD (TW-market) account.
    // This row would fail the trigger post-042, so the pre-flight DO block aborts.
    await pool.query(
      `INSERT INTO trade_events (
         id, user_id, account_id, ticker, instrument_type, trade_type,
         quantity, unit_price, trade_date, source, trade_timestamp, booking_sequence,
         price_currency, fee_policy_snapshot_id, market_code
       ) VALUES ($1, $2, $3, '2330', 'STOCK', 'BUY',
                 100, 100.0, '2026-01-01', 'test', '2026-01-01T00:00:00Z', 1,
                 'TWD', $4, 'US')`,
      [randomUUID(), userId, accountId, snapshotId],
    );

    let captured: unknown = null;
    try {
      await applyMigration(pool, "042_kzo183_account_scoped_fee_profiles.sql");
    } catch (err) {
      captured = err;
    }

    expect(captured).not.toBeNull();
    const error = captured as { message?: string };
    expect(error.message).toMatch(/pre-flight.*trade_events/i);
  });

  it("pre-flight: dividend_ledger_entries mismatch (TWD account, USD dividend) aborts migration (MTR-2)", async () => {
    // Seed a USD dividend event in market_data schema.
    const divEventId = randomUUID();
    await pool.query(
      `INSERT INTO market_data.dividend_events (
         id, ticker, event_type, ex_dividend_date, payment_date,
         cash_dividend_per_share, stock_dividend_per_share, cash_dividend_currency
       ) VALUES ($1, 'MSFT', 'CASH', '2026-01-10', '2026-01-20', 1.0, 0.0, 'USD')`,
      [divEventId],
    );

    // Insert a dividend_ledger_entries row: TWD account → USD dividend event → currency mismatch.
    await pool.query(
      `INSERT INTO dividend_ledger_entries (
         id, account_id, dividend_event_id, eligible_quantity,
         posting_status, reconciliation_status
       ) VALUES ($1, $2, $3, 100, 'expected', 'open')`,
      [randomUUID(), accountId, divEventId],
    );

    let captured: unknown = null;
    try {
      await applyMigration(pool, "042_kzo183_account_scoped_fee_profiles.sql");
    } catch (err) {
      captured = err;
    }

    expect(captured).not.toBeNull();
    const error = captured as { message?: string };
    expect(error.message).toMatch(/pre-flight.*dividend/i);
  });

  it("pre-flight passes (no violations) and migration completes successfully", async () => {
    // No violating rows — migration should apply cleanly.
    await expect(
      applyMigration(pool, "042_kzo183_account_scoped_fee_profiles.sql"),
    ).resolves.not.toThrow();
  });
});

// ─── Post-042 trigger suite (MTR-3 to MTR-6) ─────────────────────────────────

describePostgres("KZO-183: post-migration triggers reject market mismatch (MTR-3–6)", () => {
  let pool: Pool;
  let persistence: PostgresPersistenceInstance | null = null;
  let userId: string;
  let twdAccountId: string;
  let usdAccountId: string;
  let snapshotId: string;
  beforeEach(async () => {
    pool = new Pool({ connectionString: databaseUrl });
    await resetDatabase(pool);
    await applyAllMigrations(pool);

    persistence = new PostgresPersistence({ databaseUrl: databaseUrl!, redisUrl: redisUrl! });
    await persistence.init();

    // resolveOrCreateUser seeds the "Main" TWD account + its fee profile.
    const result = await persistence.resolveOrCreateUser("google", "mtr-trigger-sub", {
      email: "mtr-trigger@example.com",
      name: "MTR Trigger Test",
    });
    userId = result.userId;

    const store = await persistence.loadStore(userId);
    const twdAccount = store.accounts[0];
    if (!twdAccount) throw new Error("Expected TWD main account");
    twdAccountId = twdAccount.id;
    // Create a USD account + fee profile via raw SQL.
    // KZO-183: fee_profiles.account_id has a regular FK (not deferred) so the account
    // must exist first. accounts.fee_profile_id has the deferred composite FK, so
    // wrap both INSERTs in a transaction to defer that check until COMMIT.
    usdAccountId = randomUUID();
    const usdProfileId = randomUUID();
    {
      const txClient = await pool.connect();
      try {
        await txClient.query("BEGIN");
        await txClient.query(
          `INSERT INTO accounts (id, user_id, name, fee_profile_id, default_currency, account_type)
           VALUES ($1, $2, 'USD Brokerage', $3, 'USD', 'broker')`,
          [usdAccountId, userId, usdProfileId],
        );
        await txClient.query(
          `INSERT INTO fee_profiles (
             id, account_id, name, commission_rate_bps, board_commission_rate, commission_discount_percent,
             commission_discount_bps, minimum_commission_amount, commission_currency,
             commission_rounding_mode, tax_rounding_mode, stock_sell_tax_rate_bps,
             stock_day_trade_tax_rate_bps, etf_sell_tax_rate_bps, bond_etf_sell_tax_rate_bps,
             commission_charge_mode
           ) VALUES ($1, $2, 'USD Default', 14, 1.425, 0, 10000, 20, 'USD', 'FLOOR', 'FLOOR',
                     0, 0, 0, 0, 'CHARGED_UPFRONT')`,
          [usdProfileId, usdAccountId],
        );
        await txClient.query("COMMIT");
      } catch (err) {
        await txClient.query("ROLLBACK").catch(() => undefined);
        throw err;
      } finally {
        txClient.release();
      }
    }

    snapshotId = randomUUID();
    await seedSnapshot(pool, userId, snapshotId);
  });

  afterEach(async () => {
    if (persistence) {
      await persistence.close();
      persistence = null;
    }
    await pool.end();
  });

  it("currency_to_market maps every account currency to its market 1:1 (MTR-6)", async () => {
    const { rows } = await pool.query<{ twd: string; usd: string; aud: string; krw: string; jpy: string }>(
      `SELECT
         currency_to_market('TWD') AS twd,
         currency_to_market('USD') AS usd,
         currency_to_market('AUD') AS aud,
         currency_to_market('KRW') AS krw,
         currency_to_market('JPY') AS jpy`,
    );
    expect(rows[0].twd).toBe("TW");
    expect(rows[0].usd).toBe("US");
    expect(rows[0].aud).toBe("AU");
    expect(rows[0].krw).toBe("KR");
    expect(rows[0].jpy).toBe("JP");
  });

  it("currency_to_market raises invalid_currency_for_market for unknown currency (MTR-6)", async () => {
    let captured: unknown = null;
    try {
      await pool.query(`SELECT currency_to_market('GBP')`);
    } catch (err) {
      captured = err;
    }
    expect(captured).not.toBeNull();
    const error = captured as { code?: string; message?: string };
    expect(error.code).toBe("23514");
    expect(error.message).toMatch(/invalid_currency_for_market/);
  });

  it("BEFORE INSERT on trade_events rejects market mismatch: TWD account + US market_code (MTR-3)", async () => {
    // TWD account → expected market 'TW'. Inserting with market_code='US' → trigger rejects.
    let captured: unknown = null;
    try {
      await pool.query(
        `INSERT INTO trade_events (
           id, user_id, account_id, ticker, instrument_type, trade_type,
           quantity, unit_price, trade_date, source, trade_timestamp, booking_sequence,
           price_currency, fee_policy_snapshot_id, market_code
         ) VALUES ($1, $2, $3, '2330', 'STOCK', 'BUY',
                   100, 100.0, '2026-01-01', 'test', '2026-01-01T00:00:00Z', 1,
                   'TWD', $4, 'US')`,
        [randomUUID(), userId, twdAccountId, snapshotId],
      );
    } catch (err) {
      captured = err;
    }
    expect(captured).not.toBeNull();
    const error = captured as { code?: string; message?: string };
    expect(error.code).toBe("23514");
    expect(error.message).toMatch(/trade_market_mismatch/);
  });

  it("BEFORE INSERT on trade_events accepts matching market: TWD account + TW market_code", async () => {
    await expect(
      pool.query(
        `INSERT INTO trade_events (
           id, user_id, account_id, ticker, instrument_type, trade_type,
           quantity, unit_price, trade_date, source, trade_timestamp, booking_sequence,
           price_currency, fee_policy_snapshot_id, market_code
         ) VALUES ($1, $2, $3, '2330', 'STOCK', 'BUY',
                   100, 100.0, '2026-01-01', 'test', '2026-01-01T00:00:00Z', 1,
                   'TWD', $4, 'TW')`,
        [randomUUID(), userId, twdAccountId, snapshotId],
      ),
    ).resolves.not.toThrow();
  });

  it("BEFORE UPDATE on trade_events rejects changing market_code to mismatch (MTR-4)", async () => {
    // Insert a valid row first.
    const tradeId = randomUUID();
    await pool.query(
      `INSERT INTO trade_events (
         id, user_id, account_id, ticker, instrument_type, trade_type,
         quantity, unit_price, trade_date, source, trade_timestamp, booking_sequence,
         price_currency, fee_policy_snapshot_id, market_code
       ) VALUES ($1, $2, $3, '2330', 'STOCK', 'BUY',
                 100, 100.0, '2026-01-01', 'test', '2026-01-01T00:00:00Z', 1,
                 'TWD', $4, 'TW')`,
      [tradeId, userId, twdAccountId, snapshotId],
    );

    // Now update market_code to a mismatched value.
    let captured: unknown = null;
    try {
      await pool.query(
        `UPDATE trade_events SET market_code = 'US' WHERE id = $1`,
        [tradeId],
      );
    } catch (err) {
      captured = err;
    }
    expect(captured).not.toBeNull();
    const error = captured as { code?: string };
    expect(error.code).toBe("23514");
  });

  it("BEFORE INSERT on dividend_ledger_entries rejects currency mismatch: TWD account + USD dividend (MTR-5)", async () => {
    // Seed a USD dividend event.
    const divEventId = randomUUID();
    await pool.query(
      `INSERT INTO market_data.dividend_events (
         id, ticker, event_type, ex_dividend_date, payment_date,
         cash_dividend_per_share, stock_dividend_per_share, cash_dividend_currency
       ) VALUES ($1, 'MSFT', 'CASH', '2026-01-10', '2026-01-20', 1.0, 0.0, 'USD')`,
      [divEventId],
    );

    // Try to INSERT a dividend_ledger_entries row: TWD account → USD dividend → trigger rejects.
    let captured: unknown = null;
    try {
      await pool.query(
        `INSERT INTO dividend_ledger_entries (
           id, account_id, dividend_event_id, eligible_quantity,
           posting_status, reconciliation_status
         ) VALUES ($1, $2, $3, 100, 'expected', 'open')`,
        [randomUUID(), twdAccountId, divEventId],
      );
    } catch (err) {
      captured = err;
    }
    expect(captured).not.toBeNull();
    const error = captured as { code?: string; message?: string };
    expect(error.code).toBe("23514");
    expect(error.message).toMatch(/dividend_market_mismatch/);
  });

  it("BEFORE INSERT on dividend_ledger_entries accepts matching currency: TWD account + TWD dividend", async () => {
    const divEventId = randomUUID();
    await pool.query(
      `INSERT INTO market_data.dividend_events (
         id, ticker, event_type, ex_dividend_date, payment_date,
         cash_dividend_per_share, stock_dividend_per_share, cash_dividend_currency
       ) VALUES ($1, '2330', 'CASH', '2026-01-10', '2026-01-20', 2.0, 0.0, 'TWD')`,
      [divEventId],
    );

    await expect(
      pool.query(
        `INSERT INTO dividend_ledger_entries (
           id, account_id, dividend_event_id, eligible_quantity,
           posting_status, reconciliation_status
         ) VALUES ($1, $2, $3, 100, 'expected', 'open')`,
        [randomUUID(), twdAccountId, divEventId],
      ),
    ).resolves.not.toThrow();
  });
});
