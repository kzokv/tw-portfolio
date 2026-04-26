// KZO-165 — Senior QA Phase 1 (Tier 2 parallel).
//
// Postgres-backed integration coverage for migration 038 (snapshot multi-
// currency schema) AND the persistence round-trip of the new HoldingSnapshot
// fields plus the hardPurgeUser cascade for currency_wallet_snapshots.
//
// Test population:
//   1. Migration backfill correctness — seed pre-migration-shape rows via
//      raw SQL (per `.claude/rules/integration-test-persistence-direct.md`'s
//      "raw INSERT with SQL interval literals" pattern), apply migrations
//      through 038, then assert backfill.
//   2. Round-trip new fields via bulkUpsertHoldingSnapshots +
//      getHoldingSnapshotsForTicker.
//   3. hardPurgeUser cascade — verify currency_wallet_snapshots rows are
//      deleted alongside daily_holding_snapshots when a user is hard-purged.
//
// Patterns:
//   - Full pattern (scoped pool + applyNumberedMigrations + PostgresPersistence
//     direct) per `integration-test-persistence-direct.md`.
//   - Real users seeded via `resolveOrCreateUser(...)` before any audit_log
//     write (FK enforcement is real on Postgres).
//   - Locked ticker `2002` (China Steel — TWSE) per
//     `.claude/rules/e2e-shared-memory-bars-ticker-hygiene.md`. Architect-
//     verified unused as of KZO-165 design pass.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const { PostgresPersistence } = await import("../../src/persistence/postgres.js");
const { loadMigrationManifest } = await import("../../src/persistence/migrationManifest.js");

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
const TARGET_MIGRATION = "038_kzo165_snapshot_multi_currency.sql";

// ── Migration backfill: pre-migration-shape rows ─────────────────────────────
//
// We need to apply every migration BEFORE 038, seed rows into the pre-038
// daily_holding_snapshots shape, then apply 038 alone, then assert backfill.
// Mirrors "drops orphaned recompute preview rows" pattern in
// postgres-migrations.integration.test.ts.

describePostgres("KZO-165 migration 038 — backfill correctness", () => {
  let pool: Pool;

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

  async function applyMigrationFiles(files: string[]): Promise<void> {
    const client = await pool.connect();
    try {
      for (const file of files) {
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
  });

  afterEach(async () => {
    await pool.end();
  });

  it("backfills value_native, cost_basis_native, unrealized_pnl_native, provider_source on pre-existing rows", async () => {
    const manifest = await migrationManifestPromise;
    const targetIndex = manifest.numberedMigrations.indexOf(TARGET_MIGRATION);
    expect(targetIndex).toBeGreaterThan(-1);
    const preMigrations = manifest.numberedMigrations.slice(0, targetIndex);

    // 1. Apply everything BEFORE migration 038 — leaves daily_holding_snapshots
    //    in its 028 shape (no native columns, currency TEXT DEFAULT 'TWD').
    await applyMigrationFiles(preMigrations);

    // 2. Seed: real user + account + a pre-shape daily_holding_snapshots row.
    //    Use raw SQL because the persistence API would write the post-038 shape.
    //    Note we MUST satisfy the FK on users(id), so insert a user row directly
    //    (cheaper than going through resolveOrCreateUser which would also seed
    //    fee_profiles, accounts, etc., and the schema might already include them
    //    transitively via earlier migrations).
    await pool.query(
      `INSERT INTO users (id, email, locale, cost_basis_method, quote_poll_interval_seconds, is_demo)
       VALUES ('kzo165-user', 'kzo165@example.com', 'en', 'WEIGHTED_AVERAGE', 10, false)`,
    );
    await pool.query(
      `INSERT INTO fee_profiles (
         id, user_id, name, commission_rate_bps, commission_discount_bps,
         minimum_commission_amount, commission_currency, commission_rounding_mode, tax_rounding_mode,
         stock_sell_tax_rate_bps, stock_day_trade_tax_rate_bps, etf_sell_tax_rate_bps,
         bond_etf_sell_tax_rate_bps, board_commission_rate, commission_discount_percent
       ) VALUES (
         'kzo165-fp', 'kzo165-user', 'Default', 14, 7200,
         20, 'TWD', 'FLOOR', 'FLOOR',
         30, 15, 10,
         0, 1.425, 28
       )`,
    );
    await pool.query(
      `INSERT INTO accounts (id, user_id, name, fee_profile_id)
       VALUES ('kzo165-acc', 'kzo165-user', 'Main', 'kzo165-fp')`,
    );

    // Seed pre-migration-shape snapshot rows. Use:
    //   - one row with non-null market_value/unrealized_pnl  → backfilled
    //   - one row with null market_value (provisional)        → value_native must be 0 per migration UPDATE (COALESCE)
    //   - currency='TWD' (existing default) — must survive the CHAR(3) tighten
    await pool.query(
      `INSERT INTO daily_holding_snapshots (
         id, user_id, account_id, ticker, snapshot_date, quantity,
         close_price, market_value, cost_basis, unrealized_pnl,
         cumulative_realized_pnl, cumulative_dividends, is_provisional,
         currency, generated_at, generation_run_id
       ) VALUES (
         'snap-1', 'kzo165-user', 'kzo165-acc', '2002', DATE '2025-01-02', 10,
         100, 1000, 1000, 0,
         0, 0, false,
         'TWD', NOW(), 'gen-1'
       ),
       (
         'snap-2', 'kzo165-user', 'kzo165-acc', '2002', DATE '2025-01-03', 10,
         105, 1050, 1000, 50,
         0, 0, false,
         'TWD', NOW(), 'gen-1'
       ),
       (
         'snap-3-prov', 'kzo165-user', 'kzo165-acc', '2002', DATE '2025-01-06', 10,
         NULL, NULL, 1000, NULL,
         0, 0, true,
         'TWD', NOW(), 'gen-1'
       )`,
    );

    // 3. Apply migration 038 only.
    await applyMigrationFiles([TARGET_MIGRATION]);

    // 4. Assert backfill on the populated rows.
    const populated = await pool.query<{
      id: string;
      value_native: string | null;
      cost_basis_native: string;
      unrealized_pnl_native: string | null;
      provider_source: string | null;
      currency: string;
    }>(
      `SELECT id, value_native::text, cost_basis_native::text,
              unrealized_pnl_native::text, provider_source, currency
       FROM daily_holding_snapshots
       WHERE id IN ('snap-1', 'snap-2', 'snap-3-prov')
       ORDER BY id`,
    );
    expect(populated.rows).toHaveLength(3);

    const byId = Object.fromEntries(populated.rows.map((r) => [r.id, r]));

    // snap-1: value_native = market_value (1000), cost_basis_native = 1000,
    //         unrealized_pnl_native = 0, provider_source = 'finmind'.
    expect(Number(byId["snap-1"].value_native)).toBe(1000);
    expect(Number(byId["snap-1"].cost_basis_native)).toBe(1000);
    expect(Number(byId["snap-1"].unrealized_pnl_native)).toBe(0);
    expect(byId["snap-1"].provider_source).toBe("finmind");

    // snap-2: profit row, all backfilled.
    expect(Number(byId["snap-2"].value_native)).toBe(1050);
    expect(Number(byId["snap-2"].cost_basis_native)).toBe(1000);
    expect(Number(byId["snap-2"].unrealized_pnl_native)).toBe(50);
    expect(byId["snap-2"].provider_source).toBe("finmind");

    // snap-3-prov: provisional pre-migration row. The locked backfill script
    // uses COALESCE(market_value, 0), so value_native is a real numeric zero,
    // not SQL NULL. New KZO-165 writer rows may still use NULL for future
    // provisional snapshots.
    expect(byId["snap-3-prov"].value_native).not.toBeNull();
    expect(Number(byId["snap-3-prov"].value_native)).toBe(0);
    expect(Number(byId["snap-3-prov"].cost_basis_native)).toBe(1000);
    expect(byId["snap-3-prov"].unrealized_pnl_native).toBeNull();
    expect(byId["snap-3-prov"].provider_source).toBe("finmind");

    // 5. currency column survived tightening to CHAR(3) and is uppercase.
    for (const row of populated.rows) {
      // CHAR(3) values may be returned with trailing padding — trim before assert.
      expect(row.currency.trim()).toBe("TWD");
    }
  });

  it("ISO CHECK on currency rejects non-3-letter values after migration 038", async () => {
    const manifest = await migrationManifestPromise;
    await applyMigrationFiles(manifest.numberedMigrations);

    await pool.query(
      `INSERT INTO users (id, email, locale, cost_basis_method, quote_poll_interval_seconds, is_demo)
       VALUES ('kzo165-iso-user', 'kzo165iso@example.com', 'en', 'WEIGHTED_AVERAGE', 10, false)`,
    );
    await pool.query(
      `INSERT INTO fee_profiles (
         id, user_id, name, commission_rate_bps, commission_discount_bps,
         minimum_commission_amount, commission_currency, commission_rounding_mode, tax_rounding_mode,
         stock_sell_tax_rate_bps, stock_day_trade_tax_rate_bps, etf_sell_tax_rate_bps,
         bond_etf_sell_tax_rate_bps, board_commission_rate, commission_discount_percent
       ) VALUES (
         'kzo165-iso-fp', 'kzo165-iso-user', 'Default', 14, 7200,
         20, 'TWD', 'FLOOR', 'FLOOR',
         30, 15, 10,
         0, 1.425, 28
       )`,
    );
    await pool.query(
      `INSERT INTO accounts (id, user_id, name, fee_profile_id)
       VALUES ('kzo165-iso-acc', 'kzo165-iso-user', 'Main', 'kzo165-iso-fp')`,
    );

    // Lowercase 'twd' must violate the ISO CHECK regex '^[A-Z]{3}$'.
    await expect(
      pool.query(
        `INSERT INTO daily_holding_snapshots (
           id, user_id, account_id, ticker, snapshot_date, quantity,
           close_price, market_value, cost_basis, unrealized_pnl,
           cumulative_realized_pnl, cumulative_dividends, is_provisional,
           currency, generated_at, generation_run_id,
           value_native, cost_basis_native, unrealized_pnl_native, provider_source
         ) VALUES (
           'snap-iso-bad', 'kzo165-iso-user', 'kzo165-iso-acc', '2002', DATE '2025-01-02', 10,
           100, 1000, 1000, 0,
           0, 0, false,
           'twd', NOW(), 'gen-iso',
           1000, 1000, 0, 'finmind'
         )`,
      ),
    ).rejects.toThrow();
  });
});

// ── Round-trip new fields + hardPurgeUser cascade ────────────────────────────

describePostgres("KZO-165 — round-trip + hard-purge cascade for currency_wallet_snapshots", () => {
  let pool: Pool;
  let persistence: InstanceType<typeof PostgresPersistence> | null = null;
  let adminActorId: string;

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

    // Real admin actor for hardPurgeUser audit_log writes (FK is real on Postgres).
    const seeded = await persistence!.resolveOrCreateUser(
      "google",
      "kzo165-admin-actor-sub",
      { email: "kzo165-admin@example.com", name: "KZO-165 Admin Actor" },
    );
    adminActorId = seeded.userId;
  });

  afterEach(async () => {
    if (persistence) {
      await persistence.close();
      persistence = null;
    }
    await pool.end();
  });

  it("bulkUpsertHoldingSnapshots → getHoldingSnapshotsForTicker round-trips the new *_native + providerSource columns", async () => {
    // Seed a real user + account so the snapshot FK on users(id) resolves.
    const { userId } = await persistence!.resolveOrCreateUser(
      "google",
      "kzo165-roundtrip-sub",
      { email: "kzo165-roundtrip@example.com", name: "KZO-165 Round Trip User" },
    );
    // Pick the first account auto-seeded by resolveOrCreateUser (mirrors
    // anonymous-share-tokens.integration.test.ts).
    const accountsResult = await pool.query<{ id: string }>(
      `SELECT id FROM accounts WHERE user_id = $1 LIMIT 1`,
      [userId],
    );
    expect(accountsResult.rows.length).toBeGreaterThan(0);
    const accountId = accountsResult.rows[0].id;

    const generatedAt = new Date().toISOString();
    const generationRunId = "gen-kzo165-rt";

    await persistence!.bulkUpsertHoldingSnapshots(userId, [
      {
        id: "rt-snap-1",
        userId,
        accountId,
        ticker: "2002",
        snapshotDate: "2025-01-02",
        quantity: 10,
        closePrice: 100,
        marketValue: 1000,
        costBasis: 1000,
        unrealizedPnl: 0,
        cumulativeRealizedPnl: 0,
        cumulativeDividends: 0,
        isProvisional: false,
        currency: "TWD",
        valueNative: 1000,
        costBasisNative: 1000,
        unrealizedPnlNative: 0,
        providerSource: "finmind",
        generatedAt,
        generationRunId,
      },
      {
        id: "rt-snap-2",
        userId,
        accountId,
        ticker: "2002",
        snapshotDate: "2025-01-03",
        quantity: 10,
        closePrice: 105,
        marketValue: 1050,
        costBasis: 1000,
        unrealizedPnl: 50,
        cumulativeRealizedPnl: 0,
        cumulativeDividends: 0,
        isProvisional: false,
        currency: "TWD",
        valueNative: 1050,
        costBasisNative: 1000,
        unrealizedPnlNative: 50,
        providerSource: "finmind",
        generatedAt,
        generationRunId,
      },
    ]);

    const round = await persistence!.getHoldingSnapshotsForTicker(
      userId, accountId, "2002", "2025-01-01", "2025-12-31",
    );
    expect(round).toHaveLength(2);

    // Day 1 round-trip
    expect(round[0].valueNative).toBe(1000);
    expect(round[0].costBasisNative).toBe(1000);
    expect(round[0].unrealizedPnlNative).toBe(0);
    expect(round[0].providerSource).toBe("finmind");
    expect(round[0].currency.trim()).toBe("TWD");

    // Day 2 round-trip
    expect(round[1].valueNative).toBe(1050);
    expect(round[1].costBasisNative).toBe(1000);
    expect(round[1].unrealizedPnlNative).toBe(50);
    expect(round[1].providerSource).toBe("finmind");
  });

  it("hardPurgeUser cascade: currency_wallet_snapshots rows are deleted when the user is hard-purged", async () => {
    // Seed a real user + account, then write a wallet row for them.
    const { userId } = await persistence!.resolveOrCreateUser(
      "google",
      "kzo165-purge-target-sub",
      { email: "kzo165-purge@example.com", name: "KZO-165 Purge Target" },
    );
    const accountsResult = await pool.query<{ id: string }>(
      `SELECT id FROM accounts WHERE user_id = $1 LIMIT 1`,
      [userId],
    );
    const accountId = accountsResult.rows[0].id;

    // Direct SQL insert keeps the test independent of the persistence
    // method shape (the bulk-upsert signature is locked in scope but exact
    // call-site mechanics are Implementer-owned).
    await pool.query(
      `INSERT INTO currency_wallet_snapshots (
         user_id, account_id, currency, date, balance_native,
         wac_fx_to_usd, realized_fx_pnl_lifetime, provider_source,
         generated_at, generation_run_id
       ) VALUES (
         $1, $2, 'TWD', DATE '2025-01-02', 5000,
         NULL, 0, NULL,
         NOW(), 'gen-purge'
       ),
       (
         $1, $2, 'USD', DATE '2025-01-02', 100,
         NULL, 0, NULL,
         NOW(), 'gen-purge'
       )`,
      [userId, accountId],
    );

    // Also write a daily_holding_snapshots row so we can confirm both delete
    // together inside the same hardPurge transaction.
    await pool.query(
      `INSERT INTO daily_holding_snapshots (
         id, user_id, account_id, ticker, snapshot_date, quantity,
         close_price, market_value, cost_basis, unrealized_pnl,
         cumulative_realized_pnl, cumulative_dividends, is_provisional,
         currency, generated_at, generation_run_id,
         value_native, cost_basis_native, unrealized_pnl_native, provider_source
       ) VALUES (
         'purge-snap-1', $1, $2, '2002', DATE '2025-01-02', 10,
         100, 1000, 1000, 0,
         0, 0, false,
         'TWD', NOW(), 'gen-purge',
         1000, 1000, 0, 'finmind'
       )`,
      [userId, accountId],
    );

    // Sanity — both pre-existing.
    const preWallet = await pool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM currency_wallet_snapshots WHERE user_id = $1",
      [userId],
    );
    expect(Number(preWallet.rows[0].count)).toBe(2);
    const preHolding = await pool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM daily_holding_snapshots WHERE user_id = $1",
      [userId],
    );
    expect(Number(preHolding.rows[0].count)).toBe(1);

    // Act — hard-purge the user.
    await persistence!.hardPurgeUser(userId, { actorUserId: adminActorId });

    // Assert — both wallet and holding-snapshot rows are gone.
    const postWallet = await pool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM currency_wallet_snapshots WHERE user_id = $1",
      [userId],
    );
    expect(Number(postWallet.rows[0].count)).toBe(0);

    const postHolding = await pool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM daily_holding_snapshots WHERE user_id = $1",
      [userId],
    );
    expect(Number(postHolding.rows[0].count)).toBe(0);

    // And the user row is gone.
    const userRow = await pool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM users WHERE id = $1",
      [userId],
    );
    expect(Number(userRow.rows[0].count)).toBe(0);
  });
});
