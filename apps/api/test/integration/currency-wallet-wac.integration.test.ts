/**
 * KZO-166 — Senior QA Phase 1 (Tier 2 parallel).
 *
 * Postgres-direct integration tests for the WAC engine wired into
 * `generateCurrencyWalletSnapshots`. Verifies end-to-end persistence of
 * weighted-average FX cost, realized FX P&L, and all special-case branching
 * (USD wallet, no-FX-trace, REVERSAL filtering).
 *
 * Coverage (§5b of architect-design.md):
 *   1. End-to-end TWD wallet WAC across 3 FX inflows → wac_fx_to_usd correct (AC1)
 *   2. TWD outflow → realized_fx_pnl_lifetime updated (AC2)
 *   3. REVERSAL pair filtered upstream — WAC + realized identical to baseline (D7, D15)
 *   4. USD wallet always carries 1.0 / 0 / 'frankfurter' (D10)
 *   5. Non-USD wallet without FX trace → null / 0 / null (D11, KZO-165 backward compat)
 *   6. Loss case → signed-negative realized_fx_pnl_lifetime (AC2)
 *   7. Insufficient balance → InsufficientWalletBalanceError propagates (D9, D13)
 *
 * Tests are TDD-red until the Implementer:
 *   - Creates migration 039 (fx_rate_to_usd column on cash_ledger_entries)
 *   - Implements getCashLedgerEntriesForWalletReplay on PostgresPersistence
 *   - Wires applyEntryToWalletState into generateCurrencyWalletSnapshots
 *
 * Pattern: full pattern (scoped pool + applyNumberedMigrations + PostgresPersistence direct)
 * per `.claude/rules/integration-test-persistence-direct.md`.
 * Does NOT use buildApp() — no Redis in the managed CI stack for integration tests.
 */
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

// TDD-red until Implementer creates this module.
const { InsufficientWalletBalanceError } = await import(
  "../../src/services/currencyWalletAccounting.js"
);

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

// ── Test suite ────────────────────────────────────────────────────────────────

describePostgres("currency_wallet_snapshots — WAC engine (KZO-166)", () => {
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
   * Insert a cash_ledger_entries row with optional fx_rate_to_usd via raw SQL.
   * Uses entry_type='REVERSAL' when reversalOfId is set (satisfies cash_ledger_entries_check1
   * constraint), otherwise 'MANUAL_ADJUSTMENT' — the only FK-free enum value (KZO-165 D1).
   *
   * Migration 039 must exist for fx_rate_to_usd to be a valid column —
   * this helper is TDD-red until that migration lands.
   */
  async function seedCash(args: {
    id: string;
    userId: string;
    accountId: string;
    entryDate: string;
    amount: number;
    currency: string;
    fxRateToUsd?: number | null;
    reversalOfId?: string | null;
    bookedAt?: string;
  }): Promise<void> {
    const entryType = args.reversalOfId ? 'REVERSAL' : 'MANUAL_ADJUSTMENT';
    await pool.query(
      `INSERT INTO cash_ledger_entries (
         id, user_id, account_id, entry_date, entry_type,
         amount, currency, fx_rate_to_usd, source, source_reference,
         reversal_of_cash_ledger_entry_id, booked_at
       ) VALUES (
         $1, $2, $3, $4::date, $10,
         $5, $6, $7, 'kzo166_test_seed', $1, $8, $9
       )`,
      [
        args.id,
        args.userId,
        args.accountId,
        args.entryDate,
        args.amount,
        args.currency,
        args.fxRateToUsd ?? null,
        args.reversalOfId ?? null,
        args.bookedAt ?? new Date().toISOString(),
        entryType,
      ],
    );
  }

  /** Read all currency_wallet_snapshot rows for a user, ordered by (date, currency). */
  async function readSnapshots(userId: string): Promise<Array<{
    date: string;
    currency: string;
    balance_native: string;
    wac_fx_to_usd: string | null;
    realized_fx_pnl_lifetime: string;
    provider_source: string | null;
  }>> {
    const { rows } = await pool.query(
      `SELECT date::text, currency,
              balance_native::text,
              wac_fx_to_usd::text,
              realized_fx_pnl_lifetime::text,
              provider_source
         FROM currency_wallet_snapshots
        WHERE user_id = $1
        ORDER BY date ASC, currency ASC`,
      [userId],
    );
    return rows;
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

  // ── Case 1: End-to-end TWD wallet WAC across 3 FX inflows ────────────────────

  it("AC1: three TWD FX inflows → wac_fx_to_usd weighted-average per date, provider_source='frankfurter'", async () => {
    // AC1 mapping: seed 3 FX-rate-stamped MANUAL_ADJUSTMENT entries for TWD.
    // Verify the persisted wac_fx_to_usd matches the WAC formula at each date.
    const { userId } = await persistence!.resolveOrCreateUser(
      "google", "kzo166-wac-three-inflows",
      { email: "kzo166-wac-three@example.com", name: "KZO-166 WAC Three" },
    );
    const { rows: accRows } = await pool.query<{ id: string }>(
      `SELECT id FROM accounts WHERE user_id = $1 LIMIT 1`,
      [userId],
    );
    const accountId = accRows[0].id;

    // Inflow 1: 100 TWD at rate 0.030 (2026-01-10)
    await seedCash({ id: "wac-i1", userId, accountId, entryDate: "2026-01-10", amount: 100, currency: "TWD", fxRateToUsd: 0.030 });
    // Inflow 2: 200 TWD at rate 0.032 (2026-01-15)
    await seedCash({ id: "wac-i2", userId, accountId, entryDate: "2026-01-15", amount: 200, currency: "TWD", fxRateToUsd: 0.032 });
    // Inflow 3: 100 TWD at rate 0.034 (2026-01-20)
    await seedCash({ id: "wac-i3", userId, accountId, entryDate: "2026-01-20", amount: 100, currency: "TWD", fxRateToUsd: 0.034 });

    await generateCurrencyWalletSnapshots(userId, persistence!);

    const rows = await readSnapshots(userId);
    expect(rows).toHaveLength(3);

    // Day 1: balance=100, WAC=0.030
    const d1 = rows.find((r) => r.date === "2026-01-10")!;
    expect(Number(d1.balance_native)).toBe(100);
    expect(Number(d1.wac_fx_to_usd)).toBeCloseTo(0.030, 6);
    expect(d1.provider_source).toBe("frankfurter");   // D11
    expect(Number(d1.realized_fx_pnl_lifetime)).toBe(0);

    // Day 2: balance=300, WAC=(100×0.030 + 200×0.032)/300 = 9.4/300 ≈ 0.031333
    const d2 = rows.find((r) => r.date === "2026-01-15")!;
    expect(Number(d2.balance_native)).toBe(300);
    expect(Number(d2.wac_fx_to_usd)).toBeCloseTo(9.4 / 300, 6);
    expect(d2.provider_source).toBe("frankfurter");

    // Day 3: balance=400, WAC=(300×(9.4/300) + 100×0.034)/400 = (9.4+3.4)/400 = 12.8/400 = 0.032
    const d3 = rows.find((r) => r.date === "2026-01-20")!;
    expect(Number(d3.balance_native)).toBe(400);
    expect(Number(d3.wac_fx_to_usd)).toBeCloseTo(0.032, 6);
    expect(d3.provider_source).toBe("frankfurter");
  });

  // ── Case 2: TWD outflow → realized_fx_pnl_lifetime updated ───────────────────

  it("AC2: TWD outflow at higher rate → realized_fx_pnl_lifetime = gain amount, WAC unchanged", async () => {
    // AC2: sell TWD at a better rate than WAC → positive realized P&L.
    // WAC after 3 inflows = 0.032 (from case 1). Sell 200 at 0.034.
    // realized = (0.034 − 0.032) × 200 = 0.40 USD.
    const { userId } = await persistence!.resolveOrCreateUser(
      "google", "kzo166-wac-outflow",
      { email: "kzo166-wac-outflow@example.com", name: "KZO-166 WAC Outflow" },
    );
    const { rows: accRows } = await pool.query<{ id: string }>(
      `SELECT id FROM accounts WHERE user_id = $1 LIMIT 1`,
      [userId],
    );
    const accountId = accRows[0].id;

    // Inflows to establish WAC = 0.032 at balance=400
    await seedCash({ id: "ac2-i1", userId, accountId, entryDate: "2026-01-10", amount: 100, currency: "TWD", fxRateToUsd: 0.030 });
    await seedCash({ id: "ac2-i2", userId, accountId, entryDate: "2026-01-15", amount: 200, currency: "TWD", fxRateToUsd: 0.032 });
    await seedCash({ id: "ac2-i3", userId, accountId, entryDate: "2026-01-20", amount: 100, currency: "TWD", fxRateToUsd: 0.034 });
    // Outflow: sell 200 at 0.034
    await seedCash({ id: "ac2-o1", userId, accountId, entryDate: "2026-01-25", amount: -200, currency: "TWD", fxRateToUsd: 0.034 });

    await generateCurrencyWalletSnapshots(userId, persistence!);

    const rows = await readSnapshots(userId);
    // 4 distinct dates → 4 snapshot rows
    expect(rows).toHaveLength(4);

    const outflowRow = rows.find((r) => r.date === "2026-01-25")!;
    expect(Number(outflowRow.balance_native)).toBe(200);  // 400 − 200
    // realized = (0.034 − 0.032) × 200 = 0.40
    expect(Number(outflowRow.realized_fx_pnl_lifetime)).toBeCloseTo(0.40, 2);
    // WAC unchanged after outflow (AC3)
    expect(Number(outflowRow.wac_fx_to_usd)).toBeCloseTo(0.032, 6);
    expect(outflowRow.provider_source).toBe("frankfurter");
  });

  // ── Case 3: REVERSAL pair filtered upstream ───────────────────────────────────

  it("D7/D15: REVERSAL pair filtered out — WAC and realized identical to empty baseline", async () => {
    // D7: both the original FX inflow and its REVERSAL counterpart are invisible to
    // the WAC walker. balance_native sums to 0.
    const { userId } = await persistence!.resolveOrCreateUser(
      "google", "kzo166-reversal-filter",
      { email: "kzo166-reversal@example.com", name: "KZO-166 Reversal" },
    );
    const { rows: accRows } = await pool.query<{ id: string }>(
      `SELECT id FROM accounts WHERE user_id = $1 LIMIT 1`,
      [userId],
    );
    const accountId = accRows[0].id;

    // Original FX inflow entry
    await seedCash({ id: "rev-orig", userId, accountId, entryDate: "2026-02-01", amount: 500, currency: "TWD", fxRateToUsd: 0.031 });
    // REVERSAL entry pointing back at the original
    await seedCash({
      id: "rev-rev",
      userId,
      accountId,
      entryDate: "2026-02-01",
      amount: -500,
      currency: "TWD",
      fxRateToUsd: null,
      reversalOfId: "rev-orig",
    });

    const result = await generateCurrencyWalletSnapshots(userId, persistence!);

    // Both entries cancel: the WAC walker sees neither → no snapshots emitted
    // (or snapshot with balance=0 depending on generator flush logic;
    // the key assertion is WAC=null and realized=0).
    if (result.totalRows > 0) {
      const rows = await readSnapshots(userId);
      for (const row of rows) {
        // Neither entry influenced WAC or realized P&L (D7: filtered upstream)
        expect(row.wac_fx_to_usd).toBeNull();
        expect(Number(row.realized_fx_pnl_lifetime)).toBe(0);
      }
    }
    // The generator emitting 0 rows is also acceptable (REVERSAL pair + original cancel to net 0 balance)
    // Both outcomes prove D7: the WAC state is the same as the empty baseline.
  });

  // ── Case 4: USD wallet always 1.0 / 0 / 'frankfurter' ────────────────────────

  it("D10: USD wallet rows always carry wac_fx_to_usd=1.0, realized=0, provider_source='frankfurter'", async () => {
    // D10: USD is always 1.0 regardless of fx_rate_to_usd stamped on entries.
    // Seed USD MANUAL_ADJUSTMENT entries with no FX rate (USD has no FX conversion).
    const { userId } = await persistence!.resolveOrCreateUser(
      "google", "kzo166-usd-wallet",
      { email: "kzo166-usd@example.com", name: "KZO-166 USD Wallet" },
    );
    const { rows: accRows } = await pool.query<{ id: string }>(
      `SELECT id FROM accounts WHERE user_id = $1 LIMIT 1`,
      [userId],
    );
    const accountId = accRows[0].id;

    await seedCash({ id: "usd-1", userId, accountId, entryDate: "2026-02-10", amount: 1000, currency: "USD", fxRateToUsd: null });
    await seedCash({ id: "usd-2", userId, accountId, entryDate: "2026-02-15", amount: 500, currency: "USD", fxRateToUsd: null });

    await generateCurrencyWalletSnapshots(userId, persistence!);

    const rows = await readSnapshots(userId);
    expect(rows.length).toBeGreaterThan(0);

    const usdRows = rows.filter((r) => r.currency === "USD");
    expect(usdRows.length).toBeGreaterThan(0);

    for (const row of usdRows) {
      // D10: USD wallet must always carry these exact values
      expect(Number(row.wac_fx_to_usd)).toBe(1.0);
      expect(Number(row.realized_fx_pnl_lifetime)).toBe(0);
      expect(row.provider_source).toBe("frankfurter");
    }
  });

  // ── Case 5: Non-USD wallet without FX trace → null/0/null ─────────────────────

  it("D11: non-USD wallet with no FX-rate-stamped entries stays null/0/null (KZO-165 compat)", async () => {
    // D11 / KZO-165 backward compat: TWD entries without fx_rate_to_usd should
    // produce null/0/null on the snapshot columns, matching the KZO-165 stub semantics.
    const { userId } = await persistence!.resolveOrCreateUser(
      "google", "kzo166-no-fx-trace",
      { email: "kzo166-no-fx@example.com", name: "KZO-166 No FX Trace" },
    );
    const { rows: accRows } = await pool.query<{ id: string }>(
      `SELECT id FROM accounts WHERE user_id = $1 LIMIT 1`,
      [userId],
    );
    const accountId = accRows[0].id;

    await seedCash({ id: "nofx-1", userId, accountId, entryDate: "2026-03-01", amount: 5000, currency: "TWD", fxRateToUsd: null });
    await seedCash({ id: "nofx-2", userId, accountId, entryDate: "2026-03-05", amount: 2000, currency: "TWD", fxRateToUsd: null });

    await generateCurrencyWalletSnapshots(userId, persistence!);

    const rows = await readSnapshots(userId);
    const twdRows = rows.filter((r) => r.currency === "TWD");
    expect(twdRows.length).toBeGreaterThan(0);

    for (const row of twdRows) {
      expect(row.wac_fx_to_usd).toBeNull();   // no FX trace → null
      expect(Number(row.realized_fx_pnl_lifetime)).toBe(0);
      expect(row.provider_source).toBeNull();  // no FX trace → null
    }
  });

  // ── Case 6: Loss case → signed-negative realized ──────────────────────────────

  it("AC2: loss case — outflow at lower rate than WAC → realized_fx_pnl_lifetime is negative", async () => {
    // TWD: inflow at 0.034, outflow at 0.032 → loss.
    // realized = (0.032 − 0.034) × 500 = -1.00 USD.
    const { userId } = await persistence!.resolveOrCreateUser(
      "google", "kzo166-loss-case",
      { email: "kzo166-loss@example.com", name: "KZO-166 Loss" },
    );
    const { rows: accRows } = await pool.query<{ id: string }>(
      `SELECT id FROM accounts WHERE user_id = $1 LIMIT 1`,
      [userId],
    );
    const accountId = accRows[0].id;

    await seedCash({ id: "loss-i1", userId, accountId, entryDate: "2026-03-10", amount: 500, currency: "TWD", fxRateToUsd: 0.034 });
    await seedCash({ id: "loss-o1", userId, accountId, entryDate: "2026-03-15", amount: -500, currency: "TWD", fxRateToUsd: 0.032 });

    await generateCurrencyWalletSnapshots(userId, persistence!);

    const rows = await readSnapshots(userId);
    const outflowRow = rows.find((r) => r.date === "2026-03-15")!;

    // realized = (0.032 − 0.034) × 500 = −1.00
    expect(Number(outflowRow.realized_fx_pnl_lifetime)).toBeCloseTo(-1.0, 2);
    expect(Number(outflowRow.balance_native)).toBe(0);   // fully sold
  });

  // ── Case 7: Insufficient balance → error propagates ───────────────────────────

  it("D9/D13: FX outflow exceeding balance → generator throws InsufficientWalletBalanceError", async () => {
    // D9: the typed error must propagate out of generateCurrencyWalletSnapshots.
    // D13: no warn-and-continue catch may swallow it.
    const { userId } = await persistence!.resolveOrCreateUser(
      "google", "kzo166-insuf-balance",
      { email: "kzo166-insuf@example.com", name: "KZO-166 Insufficient" },
    );
    const { rows: accRows } = await pool.query<{ id: string }>(
      `SELECT id FROM accounts WHERE user_id = $1 LIMIT 1`,
      [userId],
    );
    const accountId = accRows[0].id;

    // No prior inflow — outflow with FX rate immediately triggers insufficient balance.
    await seedCash({ id: "insuf-o1", userId, accountId, entryDate: "2026-04-01", amount: -1000, currency: "TWD", fxRateToUsd: 0.032 });

    await expect(
      generateCurrencyWalletSnapshots(userId, persistence!),
    ).rejects.toThrow(InsufficientWalletBalanceError);
  });

  it("D9: InsufficientWalletBalanceError carries structured details from the failing entry", async () => {
    // Verify the error.details payload contains actionable context.
    const { userId } = await persistence!.resolveOrCreateUser(
      "google", "kzo166-insuf-details",
      { email: "kzo166-insuf-details@example.com", name: "KZO-166 Insuf Details" },
    );
    const { rows: accRows } = await pool.query<{ id: string }>(
      `SELECT id FROM accounts WHERE user_id = $1 LIMIT 1`,
      [userId],
    );
    const accountId = accRows[0].id;

    // Small inflow then a large outflow
    await seedCash({ id: "isd-i1", userId, accountId, entryDate: "2026-04-01", amount: 100, currency: "TWD", fxRateToUsd: 0.032 });
    await seedCash({ id: "isd-o1", userId, accountId, entryDate: "2026-04-05", amount: -1000, currency: "TWD", fxRateToUsd: 0.032 });

    let caught: InstanceType<typeof InsufficientWalletBalanceError> | null = null;
    try {
      await generateCurrencyWalletSnapshots(userId, persistence!);
    } catch (err) {
      caught = err as InstanceType<typeof InsufficientWalletBalanceError>;
    }

    expect(caught).not.toBeNull();
    expect(caught).toBeInstanceOf(InsufficientWalletBalanceError);
    expect(caught!.details.available).toBe(100);   // only 100 TWD available
    expect(caught!.details.requested).toBe(1000);  // tried to sell 1000
    expect(caught!.details.currency).toBe("TWD");
    expect(caught!.details.accountId).toBe(accountId);
  });
});
