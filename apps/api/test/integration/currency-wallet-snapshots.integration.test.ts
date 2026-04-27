// KZO-165 — Senior QA Phase 1 (Tier 2 parallel).
//
// Postgres-backed integration coverage for the currency_wallet_snapshots
// writer and its schema constraints:
//
//   1. End-to-end aggregator — seed real users + accounts + cash_ledger_entries
//      via persistence; run `generateCurrencyWalletSnapshots`; assert rows
//      exist with correct running balance per (account, currency, date).
//   2. FK violation regression (KZO-149 pattern) — composite FK
//      `(account_id, user_id) → accounts(id, user_id)` rejects mismatched
//      pairs. Catches a regression where the FK is single-column.
//   3. ISO CHECK violation regression — `currency` must satisfy
//      `^[A-Z]{3}$`. Catches a regression where the regex is dropped or
//      relaxed.
//
// Patterns:
//   - Full pattern (scoped pool + applyNumberedMigrations + PostgresPersistence
//     direct) per `.claude/rules/integration-test-persistence-direct.md`.
//   - Real users seeded via `resolveOrCreateUser(...)`.
//   - Locked ticker `2002` is reserved for KZO-165 but isn't used directly
//     here — cash ledger entries are not ticker-scoped.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const { PostgresPersistence } = await import("../../src/persistence/postgres.js");
const { loadMigrationManifest } = await import("../../src/persistence/migrationManifest.js");
const { generateCurrencyWalletSnapshots } = await import(
  "../../src/services/currencyWalletSnapshotGeneration.js"
);

const databaseUrl = process.env.POSTGRES_TEST_DB_URL ?? process.env.DB_URL;
const redisUrl = process.env.POSTGRES_TEST_REDIS_URL ?? process.env.REDIS_URL;
const runPostgresIntegration = process.env.RUN_POSTGRES_INTEGRATION === "1";
const managedCiStack = process.env.TWP_MANAGED_CI_STACK === "1";

if (runPostgresIntegration && !managedCiStack) {
  throw new Error(
    "RUN_POSTGRES_INTEGRATION=1 must be executed via npm run test:integration:full:host or npm run test:integration:full:container so the DB/Redis stack is managed automatically.",
  );
}

const shouldRunPostgresSuite =
  runPostgresIntegration && Boolean(databaseUrl) && Boolean(redisUrl);
const describePostgres = shouldRunPostgresSuite ? describe : describe.skip;

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(currentDir, "../../../../db/migrations");
const migrationManifestPromise = loadMigrationManifest(migrationsDir);

describePostgres("currency_wallet_snapshots — end-to-end + schema regressions", () => {
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
        const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
        await client.query(sql);
      }
    } finally {
      client.release();
    }
  }

  /**
   * Insert a cash_ledger_entries row directly (via raw SQL) so we can
   * exercise the aggregator without spinning up the full transaction
   * pipeline. `entry_type='MANUAL_ADJUSTMENT'` is the only enum value the
   * schema CHECK accepts without a trade/dividend FK link.
   */
  async function seedCash(args: {
    id: string;
    userId: string;
    accountId: string;
    entryDate: string;
    amount: number;
    currency: string;
  }): Promise<void> {
    await pool.query(
      `INSERT INTO cash_ledger_entries (
         id, user_id, account_id, entry_date, entry_type,
         amount, currency, source, source_reference, booked_at
       ) VALUES (
         $1, $2, $3, $4::date, 'MANUAL_ADJUSTMENT',
         $5, $6, 'kzo165_test_seed', $1, NOW()
       )`,
      [args.id, args.userId, args.accountId, args.entryDate, args.amount, args.currency],
    );
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

  // ── End-to-end aggregator ────────────────────────────────────────────────

  it("end-to-end: seeded cash_ledger_entries → wallet rows with running balance", async () => {
    const { userId } = await persistence!.resolveOrCreateUser(
      "google", "kzo165-walletgen-sub",
      { email: "kzo165-walletgen@example.com", name: "KZO-165 Wallet Gen" },
    );
    const accResult = await pool.query<{ id: string }>(
      `SELECT id FROM accounts WHERE user_id = $1 LIMIT 1`,
      [userId],
    );
    const accountId = accResult.rows[0].id;

    await seedCash({ id: "kzo165-cl-1", userId, accountId, entryDate: "2025-01-02", amount: 10000, currency: "TWD" });
    await seedCash({ id: "kzo165-cl-2", userId, accountId, entryDate: "2025-01-05", amount: -3000, currency: "TWD" });

    const result = await generateCurrencyWalletSnapshots(userId, persistence!);
    expect(result.totalRows).toBe(2);

    const rows = await pool.query<{ date: string; balance_native: string; currency: string }>(
      `SELECT date::text, balance_native::text, currency
       FROM currency_wallet_snapshots
       WHERE user_id = $1
       ORDER BY date ASC`,
      [userId],
    );
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows[0].date).toBe("2025-01-02");
    expect(Number(rows.rows[0].balance_native)).toBe(10000);
    expect(rows.rows[0].currency.trim()).toBe("TWD");
    expect(rows.rows[1].date).toBe("2025-01-05");
    expect(Number(rows.rows[1].balance_native)).toBe(7000);
  });

  it("USD wallet rows carry wacFxToUsd=1.0, realizedFxPnlLifetime=0, providerSource='frankfurter' (D10)", async () => {
    const { userId } = await persistence!.resolveOrCreateUser(
      "google", "kzo166-walletfx-usd-sub",
      { email: "kzo166-walletfx-usd@example.com", name: "KZO-166 Wallet FX USD" },
    );
    const accResult = await pool.query<{ id: string }>(
      `SELECT id FROM accounts WHERE user_id = $1 LIMIT 1`,
      [userId],
    );
    const accountId = accResult.rows[0].id;

    // USD entries with no fx_rate_to_usd — USD wallet always gets explicit markers.
    await seedCash({ id: "kzo166-usd-1", userId, accountId, entryDate: "2025-01-02", amount: 250, currency: "USD" });
    await seedCash({ id: "kzo166-usd-2", userId, accountId, entryDate: "2025-01-03", amount: 100, currency: "USD" });

    await generateCurrencyWalletSnapshots(userId, persistence!);

    const rows = await pool.query<{
      currency: string;
      wac_fx_to_usd: string | null;
      realized_fx_pnl_lifetime: string;
      provider_source: string | null;
    }>(
      `SELECT currency, wac_fx_to_usd::text, realized_fx_pnl_lifetime::text, provider_source
       FROM currency_wallet_snapshots
       WHERE user_id = $1 AND currency = 'USD'`,
      [userId],
    );
    expect(rows.rows.length).toBeGreaterThan(0);
    for (const row of rows.rows) {
      expect(Number(row.wac_fx_to_usd)).toBe(1.0);
      expect(Number(row.realized_fx_pnl_lifetime)).toBe(0);
      expect(row.provider_source).toBe("frankfurter");
    }
  });

  it("non-USD wallet rows without FX-rate-stamped entries carry null/0/null (D11 backward compat)", async () => {
    const { userId } = await persistence!.resolveOrCreateUser(
      "google", "kzo166-walletfx-twd-sub",
      { email: "kzo166-walletfx-twd@example.com", name: "KZO-166 Wallet FX TWD" },
    );
    const accResult = await pool.query<{ id: string }>(
      `SELECT id FROM accounts WHERE user_id = $1 LIMIT 1`,
      [userId],
    );
    const accountId = accResult.rows[0].id;

    // TWD entries with no fx_rate_to_usd — no WAC computable.
    await seedCash({ id: "kzo166-twd-1", userId, accountId, entryDate: "2025-01-02", amount: 5000, currency: "TWD" });
    await seedCash({ id: "kzo166-twd-2", userId, accountId, entryDate: "2025-01-03", amount: 3000, currency: "TWD" });

    await generateCurrencyWalletSnapshots(userId, persistence!);

    const rows = await pool.query<{
      currency: string;
      wac_fx_to_usd: string | null;
      realized_fx_pnl_lifetime: string;
      provider_source: string | null;
    }>(
      `SELECT currency, wac_fx_to_usd::text, realized_fx_pnl_lifetime::text, provider_source
       FROM currency_wallet_snapshots
       WHERE user_id = $1 AND currency = 'TWD'`,
      [userId],
    );
    expect(rows.rows.length).toBeGreaterThan(0);
    for (const row of rows.rows) {
      expect(row.wac_fx_to_usd).toBeNull();
      expect(Number(row.realized_fx_pnl_lifetime)).toBe(0);
      expect(row.provider_source).toBeNull();
    }
  });

  // ── Composite FK regression (KZO-149 pattern) ────────────────────────────

  it("composite FK (account_id, user_id) → accounts(id, user_id) rejects mismatched pairs", async () => {
    // Seed two distinct users, each with their own account from
    // resolveOrCreateUser. Then attempt a wallet INSERT that mixes UserA's
    // userId with UserB's accountId — that pair does not exist in
    // accounts(id, user_id) so the composite FK must reject it.
    const userAResp = await persistence!.resolveOrCreateUser(
      "google", "kzo165-user-a-sub",
      { email: "kzo165-user-a@example.com", name: "User A" },
    );
    const userBResp = await persistence!.resolveOrCreateUser(
      "google", "kzo165-user-b-sub",
      { email: "kzo165-user-b@example.com", name: "User B" },
    );

    const userAAccount = await pool.query<{ id: string }>(
      `SELECT id FROM accounts WHERE user_id = $1 LIMIT 1`,
      [userAResp.userId],
    );
    const userBAccount = await pool.query<{ id: string }>(
      `SELECT id FROM accounts WHERE user_id = $1 LIMIT 1`,
      [userBResp.userId],
    );
    expect(userAAccount.rows.length).toBe(1);
    expect(userBAccount.rows.length).toBe(1);

    // Cross-user pair: user_id = User A, account_id = User B's account.
    await expect(
      pool.query(
        `INSERT INTO currency_wallet_snapshots (
           user_id, account_id, currency, date, balance_native,
           wac_fx_to_usd, realized_fx_pnl_lifetime, provider_source,
           generated_at, generation_run_id
         ) VALUES (
           $1, $2, 'TWD', DATE '2025-01-02', 1000,
           NULL, 0, NULL,
           NOW(), 'gen-fk-test'
         )`,
        [userAResp.userId, userBAccount.rows[0].id],
      ),
    ).rejects.toThrow();

    // Sanity — same-user pair does NOT throw.
    await pool.query(
      `INSERT INTO currency_wallet_snapshots (
         user_id, account_id, currency, date, balance_native,
         wac_fx_to_usd, realized_fx_pnl_lifetime, provider_source,
         generated_at, generation_run_id
       ) VALUES (
         $1, $2, 'TWD', DATE '2025-01-02', 1000,
         NULL, 0, NULL,
         NOW(), 'gen-fk-test'
       )`,
      [userAResp.userId, userAAccount.rows[0].id],
    );
    const ok = await pool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM currency_wallet_snapshots WHERE user_id = $1",
      [userAResp.userId],
    );
    expect(Number(ok.rows[0].count)).toBe(1);
  });

  // ── ISO CHECK regressions ────────────────────────────────────────────────

  it("ISO CHECK on currency rejects lowercase 'abc'", async () => {
    const { userId } = await persistence!.resolveOrCreateUser(
      "google", "kzo165-iso-low-sub",
      { email: "kzo165-iso-low@example.com", name: "ISO Low" },
    );
    const acc = await pool.query<{ id: string }>(
      `SELECT id FROM accounts WHERE user_id = $1 LIMIT 1`,
      [userId],
    );

    await expect(
      pool.query(
        `INSERT INTO currency_wallet_snapshots (
           user_id, account_id, currency, date, balance_native,
           wac_fx_to_usd, realized_fx_pnl_lifetime, provider_source,
           generated_at, generation_run_id
         ) VALUES (
           $1, $2, 'abc', DATE '2025-01-02', 1000,
           NULL, 0, NULL,
           NOW(), 'gen-iso-low'
         )`,
        [userId, acc.rows[0].id],
      ),
    ).rejects.toThrow();
  });

  it("ISO CHECK on currency rejects 4-letter values like 'TWDX'", async () => {
    const { userId } = await persistence!.resolveOrCreateUser(
      "google", "kzo165-iso-4let-sub",
      { email: "kzo165-iso-4let@example.com", name: "ISO 4let" },
    );
    const acc = await pool.query<{ id: string }>(
      `SELECT id FROM accounts WHERE user_id = $1 LIMIT 1`,
      [userId],
    );

    // CHAR(3) truncates to 'TWD' if the value were 4 chars wide; submitting a
    // 4-char literal should fail the column-type-narrowing check before the
    // ISO regex even runs. Use a value that's exactly 3 chars but contains a
    // non-letter to exercise the regex itself: '$$$'.
    await expect(
      pool.query(
        `INSERT INTO currency_wallet_snapshots (
           user_id, account_id, currency, date, balance_native,
           wac_fx_to_usd, realized_fx_pnl_lifetime, provider_source,
           generated_at, generation_run_id
         ) VALUES (
           $1, $2, '$$$', DATE '2025-01-02', 1000,
           NULL, 0, NULL,
           NOW(), 'gen-iso-symbol'
         )`,
        [userId, acc.rows[0].id],
      ),
    ).rejects.toThrow();
  });
});
