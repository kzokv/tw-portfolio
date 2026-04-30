/**
 * KZO-168 — FX-transfer service ↔ Postgres integration tests.
 *
 * Coverage (scope-todo Phase 9):
 *   - D2 partial UNIQUE: at most one non-reversal OUT and one non-reversal IN
 *     per `fx_transfer_id`.
 *   - D2 CHECK: `fx_transfer_id` only allowed on FX or REVERSAL rows.
 *   - D10 reversal pairs share their parent's `fx_transfer_id`.
 *   - D7 synchronous balance pre-check rejects via the persistence-level
 *     SUM aggregation with the KZO-166 reversal-pair filter.
 *   - D8 atomic save + audit log: a successful create writes both the cash
 *     ledger pair and the audit row, in a single transaction.
 *
 * Pattern: full pattern (scoped pool + applyNumberedMigrations +
 * PostgresPersistence direct) per `.claude/rules/integration-test-persistence-direct.md`.
 * Does NOT use buildApp() — no Redis in the managed CI stack for integration
 * tests.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const { PostgresPersistence } = await import("../../src/persistence/postgres.js");
const { loadMigrationManifest } = await import("../../src/persistence/migrationManifest.js");
const {
  createFxTransfer,
  reverseFxTransfer,
  updateFxTransfer,
} = await import("../../src/services/fxTransferService.js");

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

describePostgres("fx-transfer service (postgres integration)", () => {
  let pool: Pool;
  let persistence: InstanceType<typeof PostgresPersistence> | null = null;
  let userId: string;
  let twdAccountId: string;
  let usdAccountId: string;

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

  // accounts.fee_profile_id and fee_profiles.account_id form a deferred
  // composite FK (migration 042). Insert both rows inside a single transaction
  // so the FK validates at COMMIT time. This mirrors
  // `seedAccountWithFeeProfilePost042` from postgres-migrations.integration.test.ts.
  async function seedAccount(args: {
    id: string;
    name: string;
    defaultCurrency: "TWD" | "USD" | "AUD";
    feeProfileId: string;
  }): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO accounts (id, user_id, name, fee_profile_id, default_currency, account_type)
         VALUES ($1, $2, $3, $4, $5, 'wallet')`,
        [args.id, userId, args.name, args.feeProfileId, args.defaultCurrency],
      );
      await client.query(
        `INSERT INTO fee_profiles (
           id, account_id, name, commission_rate_bps, commission_discount_bps,
           minimum_commission_amount, commission_currency, commission_rounding_mode,
           tax_rounding_mode, stock_sell_tax_rate_bps, stock_day_trade_tax_rate_bps,
           etf_sell_tax_rate_bps, bond_etf_sell_tax_rate_bps, board_commission_rate,
           commission_discount_percent, commission_charge_mode
         ) VALUES (
           $1, $2, 'Default', 14, 7200,
           20, $3, 'FLOOR', 'FLOOR',
           30, 15, 10, 0, 1.425, 28, 'CHARGED_UPFRONT'
         )`,
        [args.feeProfileId, args.id, args.defaultCurrency],
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async function seedTwdCash(amount: number, id = "seed-twd"): Promise<void> {
    await pool.query(
      `INSERT INTO cash_ledger_entries (
         id, user_id, account_id, entry_date, entry_type, amount, currency,
         source, source_reference, booked_at
       ) VALUES (
         $1, $2, $3, '2026-03-31', 'MANUAL_ADJUSTMENT', $4, 'TWD',
         'kzo168_test_seed', $1, NOW()
       )`,
      [id, userId, twdAccountId, amount],
    );
  }

  async function seedFxRates(): Promise<void> {
    await persistence!.upsertFxRates([
      { date: "2026-04-01", baseCurrency: "TWD", quoteCurrency: "USD", rate: 0.032, source: "frankfurter" },
      { date: "2026-04-01", baseCurrency: "USD", quoteCurrency: "TWD", rate: 31.25, source: "frankfurter" },
    ]);
  }

  beforeEach(async () => {
    pool = new Pool({ connectionString: databaseUrl });
    await resetDatabase();
    await applyNumberedMigrations();
    persistence = new PostgresPersistence({ databaseUrl: databaseUrl!, redisUrl: redisUrl! });
    await persistence.init();

    const owner = await persistence.resolveOrCreateUser(
      "google",
      "kzo168-fx-transfer-routes",
      { email: "kzo168-fx-transfer@example.com", name: "KZO-168 FX Transfer" },
    );
    userId = owner.userId;

    twdAccountId = "kzo168-acc-twd";
    usdAccountId = "kzo168-acc-usd";
    await seedAccount({ id: twdAccountId, name: "TWD Wallet", defaultCurrency: "TWD", feeProfileId: "fp-twd" });
    await seedAccount({ id: usdAccountId, name: "USD Wallet", defaultCurrency: "USD", feeProfileId: "fp-usd" });
    await seedFxRates();
    await seedTwdCash(2000);
  });

  afterEach(async () => {
    if (persistence) {
      await persistence.close();
      persistence = null;
    }
    await pool.end();
  });

  it("createFxTransfer persists paired legs + audit row in a single transaction (D8)", async () => {
    const result = await createFxTransfer(persistence!, userId, {
      fromAccountId: twdAccountId,
      toAccountId: usdAccountId,
      fromAmount: 1000,
      toAmount: 32,
      effectiveRate: 0.032,
      entryDate: "2026-04-01",
    });

    const cashRows = await pool.query<{
      id: string;
      entry_type: string;
      amount: string;
      currency: string;
      fx_transfer_id: string | null;
    }>(
      `SELECT id, entry_type, amount::text, currency, fx_transfer_id::text
       FROM cash_ledger_entries
       WHERE user_id = $1 AND fx_transfer_id = $2::uuid
       ORDER BY entry_type ASC`,
      [userId, result.fxTransferId],
    );
    expect(cashRows.rows.map((row) => row.entry_type)).toEqual([
      "FX_TRANSFER_IN",
      "FX_TRANSFER_OUT",
    ]);

    const audit = await pool.query<{ action: string; metadata: Record<string, unknown> }>(
      `SELECT action, metadata FROM audit_log
       WHERE actor_user_id = $1 AND action = 'fx_transfer_created'`,
      [userId],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].metadata).toMatchObject({
      fxTransferId: result.fxTransferId,
      fromAmount: 1000,
      toAmount: 32,
      decision: "accepted",
    });
  });

  it("D2 partial UNIQUE: cannot insert a second non-reversal OUT for the same fx_transfer_id", async () => {
    const result = await createFxTransfer(persistence!, userId, {
      fromAccountId: twdAccountId,
      toAccountId: usdAccountId,
      fromAmount: 1000,
      toAmount: 32,
      effectiveRate: 0.032,
      entryDate: "2026-04-01",
    });

    await expect(
      pool.query(
        `INSERT INTO cash_ledger_entries (
           id, user_id, account_id, entry_date, entry_type, amount, currency,
           source, source_reference, booked_at, fx_rate_to_usd, fx_transfer_id
         ) VALUES (
           'dup-out', $1, $2, '2026-04-01', 'FX_TRANSFER_OUT', -1, 'TWD',
           'kzo168_test_dup', 'dup-out', NOW(), 0.032, $3::uuid
         )`,
        [userId, twdAccountId, result.fxTransferId],
      ),
    ).rejects.toThrow();
  });

  it("D2 CHECK: fx_transfer_id rejected on a non-FX, non-REVERSAL row", async () => {
    await expect(
      pool.query(
        `INSERT INTO cash_ledger_entries (
           id, user_id, account_id, entry_date, entry_type, amount, currency,
           source, source_reference, booked_at, fx_transfer_id
         ) VALUES (
           'bad-link', $1, $2, '2026-04-01', 'MANUAL_ADJUSTMENT', 1, 'TWD',
           'kzo168_test_bad_link', 'bad-link', NOW(), '00000000-0000-4000-8000-0000000000aa'::uuid
         )`,
        [userId, twdAccountId],
      ),
    ).rejects.toThrow();
  });

  it("D10 reverseFxTransfer creates two REVERSAL rows that inherit the parent fx_transfer_id", async () => {
    const created = await createFxTransfer(persistence!, userId, {
      fromAccountId: twdAccountId,
      toAccountId: usdAccountId,
      fromAmount: 1000,
      toAmount: 32,
      effectiveRate: 0.032,
      entryDate: "2026-04-01",
    });

    const reversed = await reverseFxTransfer(persistence!, userId, created.fxTransferId, {
      reason: "integration test",
    });

    const rows = await pool.query<{ id: string; entry_type: string; fx_transfer_id: string }>(
      `SELECT id, entry_type, fx_transfer_id::text
       FROM cash_ledger_entries
       WHERE user_id = $1 AND fx_transfer_id = $2::uuid
         AND reversal_of_cash_ledger_entry_id IS NOT NULL`,
      [userId, created.fxTransferId],
    );
    expect(rows.rows).toHaveLength(2);
    for (const row of rows.rows) {
      expect(row.entry_type).toBe("REVERSAL");
      expect(row.fx_transfer_id).toBe(created.fxTransferId);
    }
    expect([reversed.reversalLegOutId, reversed.reversalLegInId].sort())
      .toEqual(rows.rows.map((row) => row.id).sort());

    // Reverse-then-edit MUST be blocked.
    await expect(
      updateFxTransfer(persistence!, userId, created.fxTransferId, {
        fromAmount: 500,
        toAmount: 16,
        effectiveRate: 0.032,
      }),
    ).rejects.toMatchObject({ code: "fx_transfer_already_reversed", statusCode: 409 });
  });

  it("D7 synchronous balance pre-check rejects when the live SUM excludes reversal pairs but is still short", async () => {
    // Drain the seeded TWD balance to 1000 via a manual REVERSAL pair, then
    // try to spend 1500 — the balance pre-check (which excludes reversal-pair
    // originals) must reject with `fx_transfer_insufficient_balance`.
    await pool.query(
      `INSERT INTO cash_ledger_entries (
         id, user_id, account_id, entry_date, entry_type, amount, currency,
         source, source_reference, booked_at
       ) VALUES (
         'rev-original', $1, $2, '2026-03-31', 'MANUAL_ADJUSTMENT', 1000, 'TWD',
         'kzo168_test_rev', 'rev-original', NOW()
       )`,
      [userId, twdAccountId],
    );
    await pool.query(
      `INSERT INTO cash_ledger_entries (
         id, user_id, account_id, entry_date, entry_type, amount, currency,
         source, source_reference, booked_at, reversal_of_cash_ledger_entry_id
       ) VALUES (
         'rev-back', $1, $2, '2026-03-31', 'REVERSAL', -1000, 'TWD',
         'kzo168_test_rev', 'rev-back', NOW(), 'rev-original'
       )`,
      [userId, twdAccountId],
    );

    // Live unreversed balance: 2000 (initial seed) + 0 (reversal pair) = 2000.
    // Try to spend 2500 → must reject.
    await expect(
      createFxTransfer(persistence!, userId, {
        fromAccountId: twdAccountId,
        toAccountId: usdAccountId,
        fromAmount: 2500,
        toAmount: 80,
        effectiveRate: 0.032,
        entryDate: "2026-04-01",
      }),
    ).rejects.toMatchObject({ code: "fx_transfer_insufficient_balance", statusCode: 400 });

    // No FX rows should have been inserted on the rejected path.
    const fxCount = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM cash_ledger_entries WHERE user_id = $1 AND fx_transfer_id IS NOT NULL`,
      [userId],
    );
    expect(Number(fxCount.rows[0].n)).toBe(0);
  });
});
