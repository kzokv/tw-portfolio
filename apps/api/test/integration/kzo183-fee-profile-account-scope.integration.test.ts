/**
 * KZO-183 — composite-FK ownership invariant (Postgres integration).
 *
 * Verifies that migration 042 creates the UNIQUE(id, account_id) index on
 * fee_profiles, the composite FK on accounts, and the composite FK on
 * account_fee_profile_overrides so that cross-account fee_profile_id
 * assignments are rejected at the DB layer.
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

describePostgres("KZO-183: fee-profile composite-FK ownership (postgres integration)", () => {
  let pool: Pool;
  let persistence: PostgresPersistenceInstance | null = null;
  let userId: string;
  let accountAId: string;
  let accountBId: string;
  let profileAId: string;
  let profileBId: string;

  beforeEach(async () => {
    pool = new Pool({ connectionString: databaseUrl });
    await resetDatabase(pool);
    await applyNumberedMigrations(pool);

    persistence = new PostgresPersistence({ databaseUrl: databaseUrl!, redisUrl: redisUrl! });
    await persistence.init();

    // resolveOrCreateUser auto-seeds the "Main" account + "Default Broker" profile via
    // ensureDefaultPortfolioData. Both rows are owned correctly (profile.account_id = account.id).
    const result = await persistence.resolveOrCreateUser("google", "kzo183-scope-sub", {
      email: "kzo183-scope@example.com",
      name: "KZO-183 Scope Test",
    });
    userId = result.userId;

    const store = await persistence.loadStore(userId);
    const accountA = store.accounts[0];
    if (!accountA) throw new Error("Expected auto-seeded 'Main' account");
    accountAId = accountA.id;
    profileAId = store.feeProfiles[0]?.id ?? "";
    if (!profileAId) throw new Error("Expected auto-seeded fee profile for account A");

    // Create a second account + its own fee profile via raw SQL so we control ownership.
    // The deferred composite FK (accounts_fee_profile_owner_fk) fires at COMMIT, so wrap
    // both INSERTs in a single transaction. pool.query auto-commits after each statement,
    // which would fire the deferred FK before the fee_profile row exists.
    accountBId = randomUUID();
    profileBId = randomUUID();
    {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `INSERT INTO accounts (id, user_id, name, fee_profile_id, default_currency, account_type)
           VALUES ($1, $2, 'USD Brokerage', $3, 'USD', 'broker')`,
          [accountBId, userId, profileBId],
        );
        await client.query(
          `INSERT INTO fee_profiles (
             id, account_id, name, commission_rate_bps, board_commission_rate, commission_discount_percent, commission_discount_bps,
             minimum_commission_amount, commission_currency, commission_rounding_mode, tax_rounding_mode,
             stock_sell_tax_rate_bps, stock_day_trade_tax_rate_bps, etf_sell_tax_rate_bps,
             bond_etf_sell_tax_rate_bps, commission_charge_mode
           ) VALUES ($1, $2, 'USD Default', 14, 1.425, 0, 10000, 20, 'USD', 'FLOOR', 'FLOOR', 30, 15, 10, 0, 'CHARGED_UPFRONT')`,
          [profileBId, accountBId],
        );
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    }
  });

  afterEach(async () => {
    if (persistence) {
      await persistence.close();
      persistence = null;
    }
    await pool.end();
  });

  // ── Schema: index and FK presence ─────────────────────────────────────────

  it("ux_fee_profiles_id_account_id UNIQUE index exists on fee_profiles(id, account_id)", async () => {
    const { rows } = await pool.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
       WHERE schemaname = 'public' AND indexname = 'ux_fee_profiles_id_account_id'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].indexdef).toMatch(/UNIQUE INDEX/);
  });

  it("accounts_fee_profile_owner_fk composite FK exists on accounts", async () => {
    const { rows } = await pool.query<{ conname: string }>(
      `SELECT conname FROM pg_constraint
       WHERE conname = 'accounts_fee_profile_owner_fk'
         AND conrelid = 'accounts'::regclass`,
    );
    expect(rows).toHaveLength(1);
  });

  it("account_fee_profile_overrides_owner_fk composite FK exists on overrides", async () => {
    const { rows } = await pool.query<{ conname: string }>(
      `SELECT conname FROM pg_constraint
       WHERE conname = 'account_fee_profile_overrides_owner_fk'
         AND conrelid = 'account_fee_profile_overrides'::regclass`,
    );
    expect(rows).toHaveLength(1);
  });

  it("account_fee_profile_overrides PK is (account_id, ticker) — market_code not in PK", async () => {
    const { rows } = await pool.query<{ attname: string }>(
      `SELECT a.attname
       FROM pg_constraint c
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
       WHERE c.conname = 'account_fee_profile_overrides_pkey'
         AND c.conrelid = 'account_fee_profile_overrides'::regclass
       ORDER BY a.attnum`,
    );
    const colNames = rows.map((r) => r.attname);
    expect(colNames).toContain("account_id");
    expect(colNames).toContain("ticker");
    expect(colNames).not.toContain("market_code");
  });

  it("fee_profiles.user_id column was dropped by migration 042", async () => {
    const { rows } = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'fee_profiles'
         AND column_name = 'user_id'`,
    );
    expect(rows).toHaveLength(0);
  });

  it("account_fee_profile_overrides.market_code column was dropped by migration 042", async () => {
    const { rows } = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'account_fee_profile_overrides'
         AND column_name = 'market_code'`,
    );
    expect(rows).toHaveLength(0);
  });

  // ── Cross-account FK rejection (FPS-3, FPS-4) ─────────────────────────────

  it("UPDATE accounts.fee_profile_id to a profile owned by a different account is rejected (FPS-3)", async () => {
    // profileAId is owned by accountA. Pointing accountB at it violates the composite FK.
    // The composite FK (fee_profile_id, id) → fee_profiles(id, account_id) is DEFERRABLE
    // INITIALLY DEFERRED, so the violation is raised at COMMIT time (not at UPDATE).
    let captured: unknown = null;
    try {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `UPDATE accounts SET fee_profile_id = $1 WHERE id = $2`,
          [profileAId, accountBId],
        );
        await client.query("COMMIT"); // FK check fires here
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        captured = err;
      } finally {
        client.release();
      }
    } catch (err) {
      captured = err;
    }
    expect(captured).not.toBeNull();
    // Deferred FK fires at COMMIT → SQLSTATE 23P01 (deferred_foreign_key_constraint)
    // or 23503 depending on PG version.
    const error = captured as { code?: string };
    expect(["23503", "23P01"].includes(error.code ?? "")).toBe(true);
  });

  it("INSERT override (accountB, ticker, profileA) rejected by composite FK (FPS-4)", async () => {
    // profileAId is owned by accountA. An override (accountB, '2330', profileA) is rejected
    // because the composite FK on overrides requires profile.account_id = override.account_id.
    let captured: unknown = null;
    try {
      await pool.query(
        `INSERT INTO account_fee_profile_overrides (account_id, ticker, fee_profile_id)
         VALUES ($1, '2330', $2)`,
        [accountBId, profileAId],
      );
    } catch (err) {
      captured = err;
    }
    expect(captured).not.toBeNull();
    const error = captured as { code?: string };
    expect(["23503", "23P01", "23514"].includes(error.code ?? "")).toBe(true);
  });

  it("INSERT override (accountA, ticker, profileA) succeeds — same-account ownership (FPS-5)", async () => {
    await expect(
      pool.query(
        `INSERT INTO account_fee_profile_overrides (account_id, ticker, fee_profile_id)
         VALUES ($1, '2330', $2)`,
        [accountAId, profileAId],
      ),
    ).resolves.not.toThrow();
  });

  it("(account_id, ticker) duplicate in overrides is rejected by PK — market_code no longer disambiguates (FPS-6)", async () => {
    await pool.query(
      `INSERT INTO account_fee_profile_overrides (account_id, ticker, fee_profile_id)
       VALUES ($1, '2330', $2)`,
      [accountAId, profileAId],
    );

    let captured: unknown = null;
    try {
      await pool.query(
        `INSERT INTO account_fee_profile_overrides (account_id, ticker, fee_profile_id)
         VALUES ($1, '2330', $2)`,
        [accountAId, profileAId],
      );
    } catch (err) {
      captured = err;
    }
    expect(captured).not.toBeNull();
    const error = captured as { code?: string };
    expect(error.code).toBe("23505"); // unique_violation
  });

  it("deleting account A cascades to its fee_profiles (FPS-7)", async () => {
    const { rows: before } = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM fee_profiles WHERE account_id = $1`,
      [accountAId],
    );
    expect(Number(before[0].count)).toBeGreaterThan(0);

    // DELETE cascades through fee_profiles.account_id → accounts(id) ON DELETE CASCADE.
    await pool.query(`DELETE FROM accounts WHERE id = $1`, [accountAId]);

    const { rows: after } = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM fee_profiles WHERE account_id = $1`,
      [accountAId],
    );
    expect(Number(after[0].count)).toBe(0);
  });
});
