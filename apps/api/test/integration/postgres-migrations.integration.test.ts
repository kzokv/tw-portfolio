import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { createDividendEvent, postDividend } from "../../src/services/dividends.js";
import { loadMigrationManifest } from "../../src/persistence/migrationManifest.js";
import { createTransaction } from "../../src/services/portfolio.js";
import { PostgresPersistence } from "../../src/persistence/postgres.js";

const databaseUrl = process.env.POSTGRES_TEST_DB_URL ?? process.env.DB_URL;
const redisUrl = process.env.POSTGRES_TEST_REDIS_URL ?? process.env.REDIS_URL;
const runPostgresIntegration = process.env.RUN_POSTGRES_INTEGRATION === "1";
const managedCiStack = process.env.TWP_MANAGED_CI_STACK === "1";

if (runPostgresIntegration && !managedCiStack) {
  throw new Error(
    "RUN_POSTGRES_INTEGRATION=1 must be executed via npm run test:integration:ci:host or npm run test:integration:ci:container so the DB/Redis stack is managed automatically.",
  );
}
const shouldRunPostgresSuite = runPostgresIntegration && Boolean(databaseUrl) && Boolean(redisUrl);

const describePostgres = shouldRunPostgresSuite ? describe : describe.skip;
const legacyUserIds = ["legacy-fifo", "legacy-lifo", "legacy-custom"];
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(currentDir, "../../../../db/migrations");
const migrationManifestPromise = loadMigrationManifest(migrationsDir);

describePostgres("postgres migrations", () => {
  let pool: Pool;
  let persistence: PostgresPersistence | null = null;

  async function resetPublicSchema(): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query("DROP SCHEMA IF EXISTS public CASCADE");
      await client.query("CREATE SCHEMA public");
      await client.query("GRANT ALL ON SCHEMA public TO public");
    } finally {
      client.release();
    }
  }

  async function seedLegacyUsers(): Promise<void> {
    const client = await pool.connect();
    try {
      const initMigration = await fs.readFile(path.join(migrationsDir, "001_init.sql"), "utf8");
      await client.query(initMigration);

      await client.query(
        `INSERT INTO users (id, email, locale, cost_basis_method, quote_poll_interval_seconds)
         VALUES
           ('legacy-fifo', 'legacy-fifo@example.com', 'en', 'FIFO', 10),
           ('legacy-lifo', 'legacy-lifo@example.com', 'en', 'LIFO', 10),
           ('legacy-custom', 'legacy-custom@example.com', 'en', 'LEGACY', 10)`,
      );
    } finally {
      client.release();
    }
  }

  async function applyMigrationFiles(files: string[]): Promise<void> {
    const client = await pool.connect();
    try {
      for (const file of files) {
        const migrationSql = await fs.readFile(path.join(migrationsDir, file), "utf8");
        await client.query(migrationSql);
      }
    } finally {
      client.release();
    }
  }

  async function applyNumberedMigrations(): Promise<void> {
    const manifest = await migrationManifestPromise;
    await applyMigrationFiles(manifest.numberedMigrations);
  }

  async function applyBaselineMigration(): Promise<void> {
    const manifest = await migrationManifestPromise;
    if (!manifest.baselineMigration) {
      throw new Error("Expected a baseline migration for postgres migration tests");
    }

    const client = await pool.connect();
    try {
      const baselineSql = await fs.readFile(
        path.join(migrationsDir, manifest.baselineMigration),
        "utf8",
      );
      await client.query(baselineSql);
    } finally {
      client.release();
    }
  }

  async function seedAppliedMigrationLedger(appliedMigrations: string[]): Promise<void> {
    await pool.query(
      `CREATE TABLE schema_migrations (
         name TEXT PRIMARY KEY,
         applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       )`,
    );
    await pool.query(
      `INSERT INTO schema_migrations (name)
       SELECT migration_name
       FROM unnest($1::text[]) AS migration_name`,
      [appliedMigrations],
    );
  }

  async function seedLegacyRecomputeOrphan(options?: { simulatePartial010?: boolean }): Promise<void> {
    await pool.query(
      `INSERT INTO users (id, email, locale, cost_basis_method, quote_poll_interval_seconds)
       VALUES ('user-1', 'user-1@example.com', 'en', 'WEIGHTED_AVERAGE', 10)`,
    );
    await pool.query(
      `INSERT INTO fee_profiles (
         id, user_id, name, commission_rate_bps, commission_discount_bps,
         minimum_commission_amount, commission_currency, commission_rounding_mode, tax_rounding_mode,
         stock_sell_tax_rate_bps, stock_day_trade_tax_rate_bps, etf_sell_tax_rate_bps,
         bond_etf_sell_tax_rate_bps, board_commission_rate, commission_discount_percent
       ) VALUES (
         'fp-1', 'user-1', 'Default', 14, 7200,
         20, 'TWD', 'FLOOR', 'FLOOR',
         30, 15, 10,
         0, 1.425, 28
       )`,
    );
    await pool.query(
      `INSERT INTO accounts (id, user_id, name, fee_profile_id)
       VALUES ('acc-1', 'user-1', 'Main', 'fp-1')`,
    );
    await pool.query(
      `INSERT INTO transactions (
         id, user_id, account_id, symbol, instrument_type, tx_type,
         quantity, unit_price, trade_date, commission_amount, tax_amount,
         is_day_trade, fee_profile_id, fee_snapshot_json, realized_pnl_amount, price_currency
       ) VALUES (
         '54553566-a7a3-4088-ba7c-5773de255917', 'user-1', 'acc-1', '2330', 'STOCK', 'BUY',
         10, 100, DATE '2026-03-01', 20, 0,
         false, 'fp-1',
         '{"id":"fp-1","name":"Default","commissionRateBps":14,"commissionDiscountBps":7200,"minCommissionNtd":20}',
         NULL, 'TWD'
       )`,
    );
    await pool.query(
      `INSERT INTO recompute_jobs (id, user_id, account_id, profile_id, status, created_at)
       VALUES ('job-1', 'user-1', 'acc-1', 'fp-1', 'PREVIEWED', TIMESTAMP '2026-03-02 00:00:00')`,
    );
    await pool.query(
      `INSERT INTO recompute_job_items (
         id, job_id, transaction_id, previous_commission_amount, previous_tax_amount,
         next_commission_amount, next_tax_amount
       ) VALUES (
         'item-1', 'job-1', '54553566-a7a3-4088-ba7c-5773de255917', 20, 0,
         18, 0
       )`,
    );

    if (options?.simulatePartial010) {
      await pool.query(`ALTER TABLE recompute_job_items ADD COLUMN IF NOT EXISTS trade_event_id TEXT`);
      await pool.query(
        `UPDATE recompute_job_items
         SET trade_event_id = transaction_id
         WHERE trade_event_id IS NULL`,
      );
      await pool.query(`ALTER TABLE recompute_job_items ALTER COLUMN trade_event_id SET NOT NULL`);
    }
  }

  async function captureSchemaSignature(): Promise<{
    tables: string[];
    columns: string[];
    constraints: string[];
    indexes: string[];
  }> {
    const [tables, columns, constraints, indexes] = await Promise.all([
      pool.query<{ table_name: string }>(
        `SELECT table_name
         FROM information_schema.tables
         WHERE table_schema = 'public'
           AND table_type = 'BASE TABLE'
           AND table_name <> 'schema_migrations'
         ORDER BY table_name`,
      ),
      pool.query<{
        table_name: string;
        column_name: string;
        data_type: string;
        is_nullable: string;
        column_default: string | null;
      }>(
        `SELECT table_name, column_name, data_type, is_nullable, column_default
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name <> 'schema_migrations'
         ORDER BY table_name, ordinal_position`,
      ),
      pool.query<{
        table_name: string;
        constraint_type: string;
        definition: string;
      }>(
        `SELECT rel.relname AS table_name,
                c.contype AS constraint_type,
                pg_get_constraintdef(c.oid) AS definition
         FROM pg_constraint AS c
         JOIN pg_class AS rel
           ON rel.oid = c.conrelid
         JOIN pg_namespace AS n
           ON n.oid = c.connamespace
         WHERE n.nspname = 'public'
           AND rel.relname <> 'schema_migrations'
         ORDER BY rel.relname, c.contype, pg_get_constraintdef(c.oid)`,
      ),
      pool.query<{ tablename: string; indexname: string; indexdef: string }>(
        `SELECT tablename, indexname, indexdef
         FROM pg_indexes
         WHERE schemaname = 'public'
           AND tablename <> 'schema_migrations'
         ORDER BY tablename, indexname`,
      ),
    ]);

    return {
      tables: tables.rows.map((row) => row.table_name),
      columns: columns.rows.map(
        (row) =>
          `${row.table_name}:${row.column_name}:${row.data_type}:${row.is_nullable}:${row.column_default ?? ""}`,
      ),
      constraints: constraints.rows.map(
        (row) => `${row.table_name}:${row.constraint_type}:${row.definition}`,
      ),
      indexes: indexes.rows.map((row) => `${row.tablename}:${row.indexname}:${row.indexdef}`),
    };
  }

  beforeEach(async () => {
    pool = new Pool({ connectionString: databaseUrl });
    await resetPublicSchema();
    await seedLegacyUsers();
  });

  afterEach(async () => {
    if (persistence) {
      await persistence.close();
      persistence = null;
    }
    await pool.end();
  });

  async function insertTradeEventWithSnapshot(input: {
    id: string;
    userId: string;
    accountId: string;
    symbol: string;
    instrumentType: string;
    tradeType: string;
    quantity: number;
    unitPrice: number;
    priceCurrency?: string;
    tradeDate: string;
    tradeTimestamp: string;
    bookingSequence: number;
    commissionAmount: number;
    taxAmount: number;
    isDayTrade?: boolean;
    sourceType?: string;
    sourceReference?: string;
    bookedAt?: string;
    reversalOfTradeEventId?: string;
  }): Promise<void> {
    const feePolicySnapshotId = `trade-fee-snapshot:${input.id}`;
    await pool.query(
      `INSERT INTO trade_fee_policy_snapshots (
         id, user_id, profile_id_at_booking, profile_name_at_booking, board_commission_rate,
         commission_discount_percent, minimum_commission_amount, commission_currency,
         commission_rounding_mode, tax_rounding_mode, stock_sell_tax_rate_bps,
         stock_day_trade_tax_rate_bps, etf_sell_tax_rate_bps, bond_etf_sell_tax_rate_bps,
         commission_charge_mode, booked_at
       ) VALUES (
         $1, $2, 'fp-default', 'Default Broker', 1.425,
         0, 20, 'TWD',
         'FLOOR', 'FLOOR', 30,
         15, 10, 0,
         'CHARGED_UPFRONT', $3
       )`,
      [feePolicySnapshotId, input.userId, input.bookedAt ?? input.tradeTimestamp],
    );

    await pool.query(
      `INSERT INTO trade_events (
         id, user_id, account_id, symbol, instrument_type, trade_type, quantity, unit_price,
         price_currency, trade_date, trade_timestamp, booking_sequence, commission_amount,
         tax_amount, is_day_trade, fee_policy_snapshot_id, source_type, source_reference, booked_at,
         reversal_of_trade_event_id
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8,
         $9, $10, $11, $12, $13,
         $14, $15, $16, $17, $18, $19,
         $20
       )`,
      [
        input.id,
        input.userId,
        input.accountId,
        input.symbol,
        input.instrumentType,
        input.tradeType,
        input.quantity,
        input.unitPrice,
        input.priceCurrency ?? "TWD",
        input.tradeDate,
        input.tradeTimestamp,
        input.bookingSequence,
        input.commissionAmount,
        input.taxAmount,
        input.isDayTrade ?? false,
        feePolicySnapshotId,
        input.sourceType ?? "manual",
        input.sourceReference ?? input.id,
        input.bookedAt ?? input.tradeTimestamp,
        input.reversalOfTradeEventId ?? null,
      ],
    );
  }

  it("normalizes legacy cost basis values to WEIGHTED_AVERAGE on init", async () => {
    persistence = new PostgresPersistence({
      databaseUrl: databaseUrl!,
      redisUrl: redisUrl!,
    });
    await persistence.init();

    const users = await pool.query<{ id: string; cost_basis_method: string }>(
      `SELECT id, cost_basis_method
       FROM users
       WHERE id = ANY($1)
       ORDER BY id`,
      [legacyUserIds],
    );
    expect(users.rows).toHaveLength(3);
    for (const user of users.rows) {
      expect(user.cost_basis_method).toBe("WEIGHTED_AVERAGE");
    }
  });

  it("records applied migrations and avoids replaying them on subsequent init", async () => {
    const manifest = await migrationManifestPromise;

    persistence = new PostgresPersistence({
      databaseUrl: databaseUrl!,
      redisUrl: redisUrl!,
    });
    await persistence.init();
    await persistence.close();
    persistence = null;

    const firstPass = await pool.query<{ name: string }>(
      "SELECT name FROM schema_migrations ORDER BY name",
    );
    expect(firstPass.rows.map((row) => row.name)).toEqual(manifest.numberedMigrations);

    persistence = new PostgresPersistence({
      databaseUrl: databaseUrl!,
      redisUrl: redisUrl!,
    });
    await persistence.init();

    const secondPass = await pool.query<{ name: string }>(
      "SELECT name FROM schema_migrations ORDER BY name",
    );
    expect(secondPass.rows.map((row) => row.name)).toEqual(manifest.numberedMigrations);
  });

  it("bootstraps clean databases from the baseline schema and records superseded history", async () => {
    const manifest = await migrationManifestPromise;
    await resetPublicSchema();

    persistence = new PostgresPersistence({
      databaseUrl: databaseUrl!,
      redisUrl: redisUrl!,
    });
    await persistence.init();

    const migrationLedger = await pool.query<{ name: string }>(
      "SELECT name FROM schema_migrations ORDER BY name",
    );
    expect(migrationLedger.rows.map((row) => row.name)).toEqual(
      [...manifest.numberedMigrations, manifest.baselineMigration].filter(Boolean).sort(),
    );

    const transactionsTable = await pool.query<{ regclass: string | null }>(
      "SELECT to_regclass('public.transactions') AS regclass",
    );
    expect(transactionsTable.rows[0]?.regclass).toBeNull();

    const tradeColumns = await pool.query<{ column_name: string }>(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'trade_events'
       ORDER BY ordinal_position`,
    );
    expect(tradeColumns.rows.map((row) => row.column_name)).toContain("fee_policy_snapshot_id");
    expect(tradeColumns.rows.map((row) => row.column_name)).not.toContain("fee_snapshot_json");
  });

  it("reconciles an empty migration ledger when the current baseline schema already exists", async () => {
    const manifest = await migrationManifestPromise;
    await resetPublicSchema();
    await applyBaselineMigration();

    persistence = new PostgresPersistence({
      databaseUrl: databaseUrl!,
      redisUrl: redisUrl!,
    });
    await persistence.init();

    const migrationLedger = await pool.query<{ name: string }>(
      "SELECT name FROM schema_migrations ORDER BY name",
    );
    expect(migrationLedger.rows.map((row) => row.name)).toEqual(
      [...manifest.numberedMigrations, manifest.baselineMigration].filter(Boolean).sort(),
    );
  });

  it("reconciles missing 009 and 010 ledger rows when the schema already reflects them", async () => {
    const manifest = await migrationManifestPromise;
    await resetPublicSchema();
    await applyBaselineMigration();

    await seedAppliedMigrationLedger(
      manifest.numberedMigrations.filter(
        (name) => !["009_retire_twd_ntd_fields.sql", "010_trade_snapshot_recompute_normalization.sql"].includes(name),
      ),
    );

    persistence = new PostgresPersistence({
      databaseUrl: databaseUrl!,
      redisUrl: redisUrl!,
    });
    await persistence.init();

    const migrationLedger = await pool.query<{ name: string }>(
      "SELECT name FROM schema_migrations ORDER BY name",
    );
    expect(migrationLedger.rows.map((row) => row.name)).toEqual(manifest.numberedMigrations);
  });

  it("drops orphaned recompute preview rows before adding the trade event foreign key", async () => {
    const manifest = await migrationManifestPromise;
    const pre010Migrations = manifest.numberedMigrations.filter(
      (name) => name !== "010_trade_snapshot_recompute_normalization.sql",
    );
    await resetPublicSchema();
    await applyMigrationFiles(pre010Migrations);
    await seedAppliedMigrationLedger(pre010Migrations);
    await seedLegacyRecomputeOrphan();

    persistence = new PostgresPersistence({
      databaseUrl: databaseUrl!,
      redisUrl: redisUrl!,
    });
    await persistence.init();

    const [recomputeItems, recomputeJobs, migrationLedger, transactionIdColumn] = await Promise.all([
      pool.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM recompute_job_items"),
      pool.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM recompute_jobs"),
      pool.query<{ name: string }>("SELECT name FROM schema_migrations ORDER BY name"),
      pool.query<{ column_name: string }>(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'recompute_job_items'
           AND column_name = 'transaction_id'`,
      ),
    ]);

    expect(recomputeItems.rows[0]?.count).toBe("0");
    expect(recomputeJobs.rows[0]?.count).toBe("0");
    expect(migrationLedger.rows.map((row) => row.name)).toEqual(manifest.numberedMigrations);
    expect(transactionIdColumn.rows).toHaveLength(0);
  });

  it("recovers from a partially failed 010 retry with orphaned recompute rows", async () => {
    const manifest = await migrationManifestPromise;
    const pre010Migrations = manifest.numberedMigrations.filter(
      (name) => name !== "010_trade_snapshot_recompute_normalization.sql",
    );
    await resetPublicSchema();
    await applyMigrationFiles(pre010Migrations);
    await seedAppliedMigrationLedger(pre010Migrations);
    await seedLegacyRecomputeOrphan({ simulatePartial010: true });

    persistence = new PostgresPersistence({
      databaseUrl: databaseUrl!,
      redisUrl: redisUrl!,
    });
    await persistence.init();

    const [recomputeItems, recomputeJobs, migrationLedger] = await Promise.all([
      pool.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM recompute_job_items"),
      pool.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM recompute_jobs"),
      pool.query<{ name: string }>("SELECT name FROM schema_migrations ORDER BY name"),
    ]);

    expect(recomputeItems.rows[0]?.count).toBe("0");
    expect(recomputeJobs.rows[0]?.count).toBe("0");
    expect(migrationLedger.rows.map((row) => row.name)).toEqual(manifest.numberedMigrations);
  });

  it("keeps the baseline schema in parity with the numbered upgrade path", async () => {
    await resetPublicSchema();

    persistence = new PostgresPersistence({
      databaseUrl: databaseUrl!,
      redisUrl: redisUrl!,
    });
    await persistence.init();
    await persistence.close();
    persistence = null;

    const baselineSignature = await captureSchemaSignature();

    await resetPublicSchema();
    await applyNumberedMigrations();

    const upgradedSignature = await captureSchemaSignature();
    expect(baselineSignature).toEqual(upgradedSignature);
  });

  it("normalizes legacy duplicate booking and lot sequences before adding uniqueness indexes", async () => {
    const client = await pool.connect();

    try {
      for (const file of [
        "002_cost_basis_weighted_average.sql",
        "003_accounting_core_schema.sql",
        "004_trade_order_and_lot_allocations.sql",
      ]) {
        const migrationSql = await fs.readFile(path.join(migrationsDir, file), "utf8");
        await client.query(migrationSql);
      }

      await client.query(
        `CREATE TABLE schema_migrations (
           name TEXT PRIMARY KEY,
           applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
         )`,
      );
      await client.query(
        `INSERT INTO schema_migrations (name)
         VALUES
           ('001_init.sql'),
           ('002_cost_basis_weighted_average.sql'),
           ('003_accounting_core_schema.sql'),
           ('004_trade_order_and_lot_allocations.sql')`,
      );

      await client.query(
        `INSERT INTO users (id, email, locale, cost_basis_method, quote_poll_interval_seconds)
         VALUES ('user-1', 'user-1@example.com', 'en', 'WEIGHTED_AVERAGE', 10)`,
      );
      await client.query(
        `INSERT INTO fee_profiles (
           id, user_id, name, commission_rate_bps, commission_discount_bps,
           min_commission_ntd, commission_rounding_mode, tax_rounding_mode,
           stock_sell_tax_rate_bps, stock_day_trade_tax_rate_bps, etf_sell_tax_rate_bps,
           bond_etf_sell_tax_rate_bps
         ) VALUES (
           'user-1-fp-default', 'user-1', 'Default Broker', 14, 7200,
           20, 'FLOOR', 'FLOOR',
           30, 15, 10,
           0
         )`,
      );
      await client.query(
        `INSERT INTO accounts (id, user_id, name, fee_profile_id)
         VALUES ('user-1-acc-1', 'user-1', 'Main', 'user-1-fp-default')`,
      );

      await client.query(
        `INSERT INTO trade_events (
           id, user_id, account_id, symbol, instrument_type, trade_type,
           quantity, price_ntd, trade_date, trade_timestamp, booking_sequence, commission_ntd,
           tax_ntd, is_day_trade, fee_snapshot_json, source_type, source_reference, booked_at
         ) VALUES
           (
             'legacy-trade-1', 'user-1', 'user-1-acc-1', '2330', 'STOCK', 'BUY',
             10, 100, DATE '2026-03-01', TIMESTAMP '2026-03-01 09:00:00', 1, 20,
             0, false, '{}', 'legacy_import', 'legacy-trade-1', TIMESTAMP '2026-03-01 09:00:00'
           ),
           (
             'legacy-trade-2', 'user-1', 'user-1-acc-1', '2330', 'STOCK', 'BUY',
             5, 110, DATE '2026-03-01', TIMESTAMP '2026-03-01 09:00:01', 1, 20,
             0, false, '{}', 'legacy_import', 'legacy-trade-2', TIMESTAMP '2026-03-01 09:00:01'
           ),
           (
             'legacy-trade-3', 'user-1', 'user-1-acc-1', '2330', 'STOCK', 'BUY',
             3, 120, DATE '2026-03-01', TIMESTAMP '2026-03-01 09:00:02', 3, 20,
             0, false, '{}', 'legacy_import', 'legacy-trade-3', TIMESTAMP '2026-03-01 09:00:02'
           )`,
      );

      await client.query(
        `INSERT INTO lots (
           id, account_id, symbol, open_quantity, total_cost_ntd, opened_at, opened_sequence
         ) VALUES
           ('legacy-lot-1', 'user-1-acc-1', '2330', 10, 1020, DATE '2026-03-01', 1),
           ('legacy-lot-2', 'user-1-acc-1', '2330', 5, 570, DATE '2026-03-01', 1)`,
      );
    } finally {
      client.release();
    }

    persistence = new PostgresPersistence({
      databaseUrl: databaseUrl!,
      redisUrl: redisUrl!,
    });
    await persistence.init();

    const tradeEvents = await pool.query<{ id: string; booking_sequence: number }>(
      `SELECT id, booking_sequence
       FROM trade_events
       WHERE account_id = 'user-1-acc-1'
       ORDER BY booking_sequence`,
    );
    expect(tradeEvents.rows).toEqual([
      { id: "legacy-trade-1", booking_sequence: 1 },
      { id: "legacy-trade-2", booking_sequence: 2 },
      { id: "legacy-trade-3", booking_sequence: 3 },
    ]);

    const lots = await pool.query<{ id: string; opened_sequence: number }>(
      `SELECT id, opened_sequence
       FROM lots
       WHERE account_id = 'user-1-acc-1'
         AND symbol = '2330'
      ORDER BY opened_sequence`,
    );
    expect(lots.rows).toEqual([
      { id: "legacy-lot-1", opened_sequence: 1 },
      { id: "legacy-lot-2", opened_sequence: 2 },
    ]);

    const feeProfile = await pool.query<{ commission_discount_percent: string }>(
      `SELECT commission_discount_percent
       FROM fee_profiles
       WHERE id = 'user-1-fp-default'`,
    );
    expect(Number(feeProfile.rows[0]?.commission_discount_percent)).toBe(28);
  });

  it("applies accounting schema objects including dividend alignment", async () => {
    persistence = new PostgresPersistence({
      databaseUrl: databaseUrl!,
      redisUrl: redisUrl!,
    });
    await persistence.init();

    const expectedTables = [
      "trade_events",
      "lot_allocations",
      "cash_ledger_entries",
      "dividend_events",
      "dividend_ledger_entries",
      "dividend_deduction_entries",
      "reconciliation_records",
      "daily_portfolio_snapshots",
    ];
    const tables = await pool.query<{ table_name: string }>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = ANY($1)
       ORDER BY table_name`,
      [expectedTables],
    );
    expect(tables.rows.map((row) => row.table_name)).toEqual([...expectedTables].sort());

    const expectedIndexes = [
      "idx_trade_events_account_symbol_trade_date",
      "idx_trade_events_account_symbol_booking_order",
      "ux_trade_events_account_trade_date_booking_sequence",
      "ux_trade_events_account_source_reference",
      "ux_trade_events_reversal_of_trade_event_id",
      "idx_lot_allocations_trade_event_id",
      "ux_lots_account_symbol_opened_order",
      "ux_lot_allocations_trade_event_lot",
      "idx_cash_ledger_entries_account_entry_date",
      "ux_cash_ledger_entries_account_source_reference",
      "ux_cash_ledger_entries_reversal_of_cash_ledger_entry_id",
      "idx_dividend_events_symbol_ex_dividend_date",
      "idx_dividend_ledger_entries_dividend_event_id",
      "ux_dividend_ledger_entries_reversal_of_dividend_ledger_entry_id",
      "idx_dividend_deduction_entries_dividend_ledger_entry_id",
      "ux_dividend_ledger_entries_active_account_event",
      "idx_reconciliation_records_user_account_status",
      "ux_daily_portfolio_snapshots_user_date_run",
    ];
    const indexes = await pool.query<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef
       FROM pg_indexes
       WHERE schemaname = 'public'
         AND indexname = ANY($1)
       ORDER BY indexname`,
      [expectedIndexes],
    );
    expect(indexes.rows.map((row) => row.indexname)).toEqual([...expectedIndexes].sort());

    const indexDefByName = new Map(
      indexes.rows.map((row) => [row.indexname, row.indexdef]),
    );
    expect(indexDefByName.get("ux_trade_events_account_source_reference")).toMatch(
      /CREATE UNIQUE INDEX/i,
    );
    expect(indexDefByName.get("ux_trade_events_account_source_reference")).toMatch(
      /source_reference IS NOT NULL/i,
    );
    expect(indexDefByName.get("ux_cash_ledger_entries_account_source_reference")).toMatch(
      /CREATE UNIQUE INDEX/i,
    );
    expect(indexDefByName.get("ux_cash_ledger_entries_account_source_reference")).toMatch(
      /source_reference IS NOT NULL/i,
    );
    expect(indexDefByName.get("ux_dividend_ledger_entries_active_account_event")).toMatch(
      /CREATE UNIQUE INDEX/i,
    );
    expect(indexDefByName.get("ux_dividend_ledger_entries_active_account_event")).toMatch(
      /superseded_at IS NULL/i,
    );

    const constraints = await pool.query<{ table_name: string; definition: string }>(
      `SELECT rel.relname AS table_name, pg_get_constraintdef(c.oid) AS definition
       FROM pg_constraint c
       JOIN pg_namespace n ON n.oid = c.connamespace
       JOIN pg_class rel ON rel.oid = c.conrelid
       WHERE n.nspname = 'public'
         AND rel.relname = ANY($1)
         AND c.contype IN ('f', 'c')
       ORDER BY rel.relname, definition`,
      [expectedTables],
    );

    const hasConstraint = (tableName: string, snippet: string): boolean =>
      constraints.rows.some(
        (row) => row.table_name === tableName && row.definition.includes(snippet),
      );

    expect(
      hasConstraint(
        "trade_events",
        "FOREIGN KEY (account_id, user_id) REFERENCES accounts(id, user_id)",
      ),
    ).toBe(true);
    expect(hasConstraint("trade_events", "FOREIGN KEY (user_id) REFERENCES users(id)")).toBe(true);
    expect(hasConstraint("trade_events", "FOREIGN KEY (account_id) REFERENCES accounts(id)")).toBe(
      true,
    );
    expect(hasConstraint("trade_events", "trade_type = ANY")).toBe(true);
    expect(hasConstraint("trade_events", "quantity > 0")).toBe(true);
    expect(hasConstraint("trade_events", "booking_sequence > 0")).toBe(true);

    expect(
      hasConstraint(
        "lot_allocations",
        "FOREIGN KEY (trade_event_id) REFERENCES trade_events(id)",
      ),
    ).toBe(true);
    expect(hasConstraint("lot_allocations", "allocated_quantity > 0")).toBe(true);
    expect(hasConstraint("lot_allocations", "lot_opened_sequence > 0")).toBe(true);

    expect(
      hasConstraint(
        "cash_ledger_entries",
        "FOREIGN KEY (related_trade_event_id) REFERENCES trade_events(id)",
      ),
    ).toBe(true);
    expect(
      hasConstraint(
        "cash_ledger_entries",
        "FOREIGN KEY (related_dividend_ledger_entry_id) REFERENCES dividend_ledger_entries(id)",
      ),
    ).toBe(true);
    expect(hasConstraint("cash_ledger_entries", "entry_type = ANY")).toBe(true);

    expect(
      hasConstraint(
        "dividend_ledger_entries",
        "FOREIGN KEY (dividend_event_id) REFERENCES dividend_events(id)",
      ),
    ).toBe(true);
    expect(hasConstraint("dividend_ledger_entries", "posting_status = ANY")).toBe(true);
    expect(
      hasConstraint(
        "dividend_deduction_entries",
        "FOREIGN KEY (dividend_ledger_entry_id) REFERENCES dividend_ledger_entries(id)",
      ),
    ).toBe(true);
    expect(hasConstraint("reconciliation_records", "reconciliation_status = ANY")).toBe(true);

    expect(
      hasConstraint(
        "daily_portfolio_snapshots",
        "FOREIGN KEY (user_id) REFERENCES users(id)",
      ),
    ).toBe(true);

    const userId = "user-1";
    const accountId = "user-1-acc-1";
    await insertTradeEventWithSnapshot({
      id: "trade-base",
      userId,
      accountId,
      symbol: "2330",
      instrumentType: "STOCK",
      tradeType: "BUY",
      quantity: 100,
      unitPrice: 600,
      tradeDate: "2026-03-01",
      tradeTimestamp: "2026-03-01T09:00:00.000Z",
      bookingSequence: 1,
      commissionAmount: 10,
      taxAmount: 0,
    });

    await expect(
      pool.query(
        `INSERT INTO dividend_events (
           id, symbol, event_type, ex_dividend_date, payment_date,
           cash_dividend_per_share, cash_dividend_currency, stock_dividend_per_share,
           source_type, source_reference
         ) VALUES (
           'dividend-invalid-type', '0056', 'CASH', DATE '2026-07-15', DATE '2026-08-10',
           0, 'TWD', 1.2, 'manual', 'dividend-invalid-type'
         )`,
      ),
    ).rejects.toThrow(/check constraint/i);

    await expect(
      pool.query(
        `INSERT INTO cash_ledger_entries (
           id, user_id, account_id, entry_date, entry_type, amount, currency,
           related_trade_event_id, source_type, source_reference
         ) VALUES (
           'cash-invalid-sign', $1, $2, DATE '2026-03-02', 'TRADE_SETTLEMENT_OUT', 100, 'TWD',
           'trade-base', 'manual', 'cash-invalid-sign'
         )`,
        [userId, accountId],
      ),
    ).rejects.toThrow(/check constraint/i);

    await expect(
      pool.query(
        `INSERT INTO cash_ledger_entries (
           id, user_id, account_id, entry_date, entry_type, amount, currency,
           related_trade_event_id, source_type, source_reference
         ) VALUES (
           'cash-invalid-link', $1, $2, DATE '2026-03-02', 'DIVIDEND_RECEIPT', 100, 'TWD',
           'trade-base', 'manual', 'cash-invalid-link'
         )`,
        [userId, accountId],
      ),
    ).rejects.toThrow(/check constraint/i);

    await pool.query(
      `INSERT INTO dividend_events (
         id, symbol, event_type, ex_dividend_date, payment_date,
         cash_dividend_per_share, cash_dividend_currency, stock_dividend_per_share,
         source_type, source_reference
       ) VALUES (
         'dividend-base', '0056', 'CASH', DATE '2026-07-15', DATE '2026-08-10',
         1.2, 'TWD', 0, 'manual', 'dividend-base'
       )`,
    );

    await expect(
      pool.query(
        `INSERT INTO dividend_ledger_entries (
           id, account_id, dividend_event_id, eligible_quantity, expected_cash_amount,
           expected_stock_quantity, received_stock_quantity,
           posting_status, reconciliation_status
         ) VALUES (
           'dividend-ledger-invalid-status', $1, 'dividend-base', 2000, 2400,
           0, 0,
           'reconciled', 'open'
         )`,
        [accountId],
      ),
    ).rejects.toThrow(/check constraint/i);

    await pool.query(
      `INSERT INTO dividend_ledger_entries (
         id, account_id, dividend_event_id, eligible_quantity, expected_cash_amount,
         expected_stock_quantity, received_stock_quantity,
         posting_status, reconciliation_status
       ) VALUES (
         'dividend-ledger-active-1', $1, 'dividend-base', 2000, 2400,
         0, 0,
         'posted', 'open'
       )`,
      [accountId],
    );

    await expect(
      pool.query(
        `INSERT INTO dividend_ledger_entries (
           id, account_id, dividend_event_id, eligible_quantity, expected_cash_amount,
           expected_stock_quantity, received_stock_quantity,
           posting_status, reconciliation_status
         ) VALUES (
           'dividend-ledger-active-2', $1, 'dividend-base', 2000, 2400,
           0, 0,
           'posted', 'open'
         )`,
        [accountId],
      ),
    ).rejects.toThrow(/duplicate key value/i);

    await pool.query(
      `UPDATE dividend_ledger_entries
       SET superseded_at = NOW()
       WHERE id = 'dividend-ledger-active-1'`,
    );

    await pool.query(
      `INSERT INTO dividend_ledger_entries (
         id, account_id, dividend_event_id, eligible_quantity, expected_cash_amount,
         expected_stock_quantity, received_stock_quantity,
         posting_status, reconciliation_status
       ) VALUES (
         'dividend-ledger-active-2', $1, 'dividend-base', 2000, 2400,
         0, 0,
         'adjusted', 'open'
       )`,
      [accountId],
    );

    await expect(
      pool.query(
        `INSERT INTO dividend_deduction_entries (
           id, dividend_ledger_entry_id, deduction_type, amount, currency_code,
           withheld_at_source, source_type, source_reference
         ) VALUES (
           'dividend-deduction-invalid-currency', 'dividend-ledger-active-2',
           'NHI_SUPPLEMENTAL_PREMIUM', 120, 'US',
           true, 'manual', 'dividend-deduction-invalid-currency'
         )`,
      ),
    ).rejects.toThrow(/check constraint/i);

    await pool.query(
      `INSERT INTO dividend_deduction_entries (
         id, dividend_ledger_entry_id, deduction_type, amount, currency_code,
         withheld_at_source, source_type, source_reference
       ) VALUES (
         'dividend-deduction-valid', 'dividend-ledger-active-2',
         'NHI_SUPPLEMENTAL_PREMIUM', 120, 'TWD',
         true, 'manual', 'dividend-deduction-valid'
       )`,
    );

    await insertTradeEventWithSnapshot({
      id: "trade-reversal-1",
      userId,
      accountId,
      symbol: "2330",
      instrumentType: "STOCK",
      tradeType: "SELL",
      quantity: 100,
      unitPrice: 600,
      tradeDate: "2026-03-03",
      tradeTimestamp: "2026-03-03T09:00:00.000Z",
      bookingSequence: 1,
      commissionAmount: 10,
      taxAmount: 0,
      reversalOfTradeEventId: "trade-base",
    });
    await expect(
      insertTradeEventWithSnapshot({
        id: "trade-reversal-2",
        userId,
        accountId,
        symbol: "2330",
        instrumentType: "STOCK",
        tradeType: "SELL",
        quantity: 100,
        unitPrice: 600,
        tradeDate: "2026-03-04",
        tradeTimestamp: "2026-03-04T09:00:00.000Z",
        bookingSequence: 1,
        commissionAmount: 10,
        taxAmount: 0,
        reversalOfTradeEventId: "trade-base",
      }),
    ).rejects.toThrow(/duplicate key value/i);

    await expect(
      insertTradeEventWithSnapshot({
        id: "trade-duplicate-sequence",
        userId,
        accountId,
        symbol: "2330",
        instrumentType: "STOCK",
        tradeType: "BUY",
        quantity: 10,
        unitPrice: 610,
        tradeDate: "2026-03-01",
        tradeTimestamp: "2026-03-01T09:00:01.000Z",
        bookingSequence: 1,
        commissionAmount: 10,
        taxAmount: 0,
      }),
    ).rejects.toThrow(/duplicate key value/i);

    await pool.query(
      `INSERT INTO lots (
         id, account_id, symbol, open_quantity, total_cost_amount, cost_currency, opened_at, opened_sequence
       ) VALUES (
         'lot-base', $1, '2330', 100, 60000, 'TWD', DATE '2026-03-01', 1
       )`,
      [accountId],
    );

    await expect(
      pool.query(
        `INSERT INTO lots (
           id, account_id, symbol, open_quantity, total_cost_amount, cost_currency, opened_at, opened_sequence
         ) VALUES (
           'lot-duplicate-order', $1, '2330', 50, 30000, 'TWD', DATE '2026-03-01', 1
         )`,
        [accountId],
      ),
    ).rejects.toThrow(/duplicate key value/i);
  });

  it("round-trips canonical trade facts and snapshots through Postgres persistence", async () => {
    persistence = new PostgresPersistence({
      databaseUrl: databaseUrl!,
      redisUrl: redisUrl!,
    });
    await persistence.init();

    const store = await persistence.loadStore("user-1");
    store.accounting.facts.tradeEvents = [
      {
        id: "trade-kzo48-1",
        userId: "user-1",
        accountId: "user-1-acc-1",
        symbol: "2330",
        instrumentType: "STOCK",
        type: "BUY",
        quantity: 10,
        unitPrice: 100,
        priceCurrency: "TWD",
        tradeDate: "2026-03-01",
        tradeTimestamp: "2026-03-01T09:00:00.000Z",
        bookingSequence: 1,
        commissionAmount: 20,
        taxAmount: 0,
        isDayTrade: false,
        feeSnapshot: store.feeProfiles[0],
        sourceType: "test",
        sourceReference: "trade-kzo48-1",
        bookedAt: "2026-03-01T09:00:00.000Z",
      },
    ];
    store.accounting.facts.cashLedgerEntries = [
      {
        id: "cash-kzo48-1",
        userId: "user-1",
        accountId: "user-1-acc-1",
        entryDate: "2026-03-01",
        entryType: "TRADE_SETTLEMENT_OUT",
        amount: -1020,
        currency: "TWD",
        relatedTradeEventId: "trade-kzo48-1",
        sourceType: "test",
        sourceReference: "cash-kzo48-1",
        bookedAt: "2026-03-01T09:00:01.000Z",
      },
    ];
    store.accounting.projections.lots = [
      {
        id: "lot-kzo46-1",
        accountId: "user-1-acc-1",
        symbol: "2330",
        openQuantity: 10,
        totalCostAmount: 1020,
        costCurrency: "TWD",
        openedAt: "2026-03-01",
        openedSequence: 1,
      },
    ];
    store.accounting.projections.lotAllocations = [
      {
        id: "alloc-kzo46-1",
        userId: "user-1",
        accountId: "user-1-acc-1",
        tradeEventId: "trade-kzo48-1",
        symbol: "2330",
        lotId: "lot-kzo46-1",
        lotOpenedAt: "2026-03-01",
        lotOpenedSequence: 1,
        allocatedQuantity: 10,
        allocatedCostAmount: 1020,
        costCurrency: "TWD",
        createdAt: "2026-03-01T09:00:02.000Z",
      },
    ];
    store.accounting.projections.dailyPortfolioSnapshots = [
      {
        id: "snapshot-kzo48-1",
        snapshotDate: "2026-03-01",
        totalMarketValueAmount: 1000,
        totalCostAmount: 1020,
        totalUnrealizedPnlAmount: -20,
        totalRealizedPnlAmount: 0,
        totalDividendReceivedAmount: 0,
        totalCashBalanceAmount: -1020,
        totalNavAmount: -20,
        currency: "TWD",
        generatedAt: "2026-03-01T23:59:59.000Z",
        generationRunId: "run-kzo48-1",
      },
    ];

    await persistence.saveStore(store);

    const tradeEvents = await pool.query<{ id: string; source_type: string; booking_sequence: number }>(
      `SELECT id, source_type, booking_sequence
       FROM trade_events
       WHERE user_id = 'user-1'
       ORDER BY id`,
    );
    expect(tradeEvents.rows).toEqual([{ id: "trade-kzo48-1", source_type: "test", booking_sequence: 1 }]);

    const lotAllocations = await pool.query<{ id: string; trade_event_id: string; lot_opened_sequence: number }>(
      `SELECT id, trade_event_id, lot_opened_sequence
       FROM lot_allocations
       WHERE user_id = 'user-1'
       ORDER BY id`,
    );
    expect(lotAllocations.rows).toEqual([
      { id: "alloc-kzo46-1", trade_event_id: "trade-kzo48-1", lot_opened_sequence: 1 },
    ]);

    const cashEntries = await pool.query<{ id: string; amount: number; related_trade_event_id: string | null }>(
      `SELECT id, amount, related_trade_event_id
       FROM cash_ledger_entries
       WHERE user_id = 'user-1'
       ORDER BY id`,
    );
    expect(cashEntries.rows).toEqual([
      { id: "cash-kzo48-1", amount: -1020, related_trade_event_id: "trade-kzo48-1" },
    ]);

    const snapshots = await pool.query<{ id: string; generation_run_id: string }>(
      `SELECT id, generation_run_id
       FROM daily_portfolio_snapshots
       WHERE user_id = 'user-1'
       ORDER BY id`,
    );
    expect(snapshots.rows).toEqual([{ id: "snapshot-kzo48-1", generation_run_id: "run-kzo48-1" }]);

    const reloaded = await persistence.loadStore("user-1");
    expect(reloaded.accounting.facts.tradeEvents).toEqual([
      expect.objectContaining({
        id: "trade-kzo48-1",
        sourceType: "test",
        sourceReference: "trade-kzo48-1",
        bookingSequence: 1,
      }),
    ]);
    expect(reloaded.accounting.projections.lotAllocations).toEqual([
      expect.objectContaining({
        id: "alloc-kzo46-1",
        tradeEventId: "trade-kzo48-1",
        lotOpenedSequence: 1,
      }),
    ]);
    expect(reloaded.accounting.facts.cashLedgerEntries).toEqual([
      expect.objectContaining({
        id: "cash-kzo48-1",
        entryType: "TRADE_SETTLEMENT_OUT",
        amount: -1020,
      }),
    ]);
    expect(reloaded.accounting.projections.dailyPortfolioSnapshots).toEqual([
      expect.objectContaining({
        id: "snapshot-kzo48-1",
        generationRunId: "run-kzo48-1",
      }),
    ]);

    const feeSnapshots = await pool.query<{
      id: string;
      profile_id_at_booking: string;
      board_commission_rate: string;
    }>(
      `SELECT id, profile_id_at_booking, board_commission_rate::TEXT
       FROM trade_fee_policy_snapshots
       WHERE user_id = 'user-1'
       ORDER BY id`,
    );
    expect(feeSnapshots.rows).toEqual([
      {
        id: "trade-fee-snapshot:trade-kzo48-1",
        profile_id_at_booking: "user-1-fp-default",
        board_commission_rate: "1.425000",
      },
    ]);
  });

  it("round-trips dividend events, ledger entries, deductions, and linked cash entries", async () => {
    persistence = new PostgresPersistence({
      databaseUrl: databaseUrl!,
      redisUrl: redisUrl!,
    });
    await persistence.init();

    const store = await persistence.loadStore("user-1");
    store.accounts.push({
      id: "user-1-acc-2",
      userId: "user-1",
      name: "Dividend",
      feeProfileId: store.feeProfiles[0].id,
    });
    store.accounting.facts.dividendEvents = [
      {
        id: "dividend-event-kzo34-1",
        symbol: "0056",
        eventType: "CASH",
        exDividendDate: "2026-07-15",
        paymentDate: "2026-08-10",
        cashDividendPerShare: 1.2,
        cashDividendCurrency: "TWD",
        stockDividendPerShare: 0,
        sourceType: "manual",
        sourceReference: "dividend-event-kzo34-1",
        createdAt: "2026-07-01T00:00:00.000Z",
      },
    ];
    store.accounting.facts.dividendLedgerEntries = [
      {
        id: "dividend-ledger-kzo34-1",
        accountId: "user-1-acc-1",
        dividendEventId: "dividend-event-kzo34-1",
        eligibleQuantity: 2000,
        expectedCashAmount: 2400,
        expectedStockQuantity: 0,
        receivedCashAmount: 2289,
        receivedStockQuantity: 0,
        postingStatus: "posted",
        reconciliationStatus: "matched",
        bookedAt: "2026-08-10T09:00:00.000Z",
      },
      {
        id: "dividend-ledger-kzo34-2",
        accountId: "user-1-acc-2",
        dividendEventId: "dividend-event-kzo34-1",
        eligibleQuantity: 500,
        expectedCashAmount: 600,
        expectedStockQuantity: 0,
        receivedCashAmount: 0,
        receivedStockQuantity: 0,
        postingStatus: "expected",
        reconciliationStatus: "open",
        bookedAt: "2026-07-16T09:00:00.000Z",
      },
    ];
    store.accounting.facts.dividendDeductionEntries = [
      {
        id: "dividend-deduction-kzo34-tax",
        dividendLedgerEntryId: "dividend-ledger-kzo34-1",
        deductionType: "WITHHOLDING_TAX",
        amount: 100,
        currencyCode: "TWD",
        withheldAtSource: true,
        sourceType: "broker_statement",
        sourceReference: "stmt-tax",
        note: "withholding tax",
        bookedAt: "2026-08-10T09:00:01.000Z",
      },
      {
        id: "dividend-deduction-kzo34-nhi",
        dividendLedgerEntryId: "dividend-ledger-kzo34-1",
        deductionType: "NHI_SUPPLEMENTAL_PREMIUM",
        amount: 11,
        currencyCode: "TWD",
        withheldAtSource: true,
        sourceType: "broker_statement",
        sourceReference: "stmt-nhi",
        note: "supplemental premium",
        bookedAt: "2026-08-10T09:00:02.000Z",
      },
    ];
    store.accounting.facts.cashLedgerEntries = [
      {
        id: "cash-kzo34-receipt",
        userId: "user-1",
        accountId: "user-1-acc-1",
        entryDate: "2026-08-10",
        entryType: "DIVIDEND_RECEIPT",
        amount: 2289,
        currency: "TWD",
        relatedDividendLedgerEntryId: "dividend-ledger-kzo34-1",
        sourceType: "dividend_posting",
        sourceReference: "cash-kzo34-receipt",
        bookedAt: "2026-08-10T09:00:03.000Z",
      },
      {
        id: "cash-kzo34-deduction",
        userId: "user-1",
        accountId: "user-1-acc-1",
        entryDate: "2026-08-10",
        entryType: "DIVIDEND_DEDUCTION",
        amount: -111,
        currency: "TWD",
        relatedDividendLedgerEntryId: "dividend-ledger-kzo34-1",
        sourceType: "dividend_posting",
        sourceReference: "cash-kzo34-deduction",
        note: "at-source deductions",
        bookedAt: "2026-08-10T09:00:04.000Z",
      },
    ];

    await persistence.saveStore(store);

    const dividendEvents = await pool.query<{
      id: string;
      event_type: string;
      cash_dividend_per_share: string;
      source_type: string;
    }>(
      `SELECT id, event_type, cash_dividend_per_share::text AS cash_dividend_per_share, source_type
       FROM dividend_events
       ORDER BY id`,
    );
    expect(dividendEvents.rows).toEqual([
      {
        id: "dividend-event-kzo34-1",
        event_type: "CASH",
        cash_dividend_per_share: "1.200000",
        source_type: "manual",
      },
    ]);

    const dividendLedgers = await pool.query<{
      id: string;
      account_id: string;
      posting_status: string;
      reconciliation_status: string;
    }>(
      `SELECT id, account_id, posting_status, reconciliation_status
       FROM dividend_ledger_entries
       ORDER BY id`,
    );
    expect(dividendLedgers.rows).toEqual([
      {
        id: "dividend-ledger-kzo34-1",
        account_id: "user-1-acc-1",
        posting_status: "posted",
        reconciliation_status: "matched",
      },
      {
        id: "dividend-ledger-kzo34-2",
        account_id: "user-1-acc-2",
        posting_status: "expected",
        reconciliation_status: "open",
      },
    ]);

    const dividendDeductions = await pool.query<{
      id: string;
      dividend_ledger_entry_id: string;
      deduction_type: string;
      currency_code: string;
    }>(
      `SELECT id, dividend_ledger_entry_id, deduction_type, currency_code
       FROM dividend_deduction_entries
       ORDER BY id`,
    );
    expect(dividendDeductions.rows).toEqual([
      {
        id: "dividend-deduction-kzo34-nhi",
        dividend_ledger_entry_id: "dividend-ledger-kzo34-1",
        deduction_type: "NHI_SUPPLEMENTAL_PREMIUM",
        currency_code: "TWD",
      },
      {
        id: "dividend-deduction-kzo34-tax",
        dividend_ledger_entry_id: "dividend-ledger-kzo34-1",
        deduction_type: "WITHHOLDING_TAX",
        currency_code: "TWD",
      },
    ]);

    const cashEntries = await pool.query<{
      id: string;
      related_dividend_ledger_entry_id: string | null;
      entry_type: string;
      amount: number;
    }>(
      `SELECT id, related_dividend_ledger_entry_id, entry_type, amount
       FROM cash_ledger_entries
       WHERE user_id = 'user-1'
       ORDER BY id`,
    );
    expect(cashEntries.rows).toEqual([
      {
        id: "cash-kzo34-deduction",
        related_dividend_ledger_entry_id: "dividend-ledger-kzo34-1",
        entry_type: "DIVIDEND_DEDUCTION",
        amount: -111,
      },
      {
        id: "cash-kzo34-receipt",
        related_dividend_ledger_entry_id: "dividend-ledger-kzo34-1",
        entry_type: "DIVIDEND_RECEIPT",
        amount: 2289,
      },
    ]);

    const reloaded = await persistence.loadStore("user-1");
    expect(reloaded.accounting.facts.dividendEvents).toEqual([
      expect.objectContaining({
        id: "dividend-event-kzo34-1",
        eventType: "CASH",
        cashDividendPerShare: 1.2,
        sourceType: "manual",
      }),
    ]);
    expect(reloaded.accounting.facts.dividendLedgerEntries).toEqual([
      expect.objectContaining({
        id: "dividend-ledger-kzo34-2",
        accountId: "user-1-acc-2",
        postingStatus: "expected",
      }),
      expect.objectContaining({
        id: "dividend-ledger-kzo34-1",
        accountId: "user-1-acc-1",
        postingStatus: "posted",
      }),
    ]);
    expect(reloaded.accounting.facts.dividendDeductionEntries).toEqual([
      expect.objectContaining({
        id: "dividend-deduction-kzo34-tax",
        dividendLedgerEntryId: "dividend-ledger-kzo34-1",
        deductionType: "WITHHOLDING_TAX",
        currencyCode: "TWD",
      }),
      expect.objectContaining({
        id: "dividend-deduction-kzo34-nhi",
        dividendLedgerEntryId: "dividend-ledger-kzo34-1",
        deductionType: "NHI_SUPPLEMENTAL_PREMIUM",
        currencyCode: "TWD",
      }),
    ]);
    expect(reloaded.accounting.facts.cashLedgerEntries).toEqual([
      expect.objectContaining({
        id: "cash-kzo34-receipt",
        relatedDividendLedgerEntryId: "dividend-ledger-kzo34-1",
        entryType: "DIVIDEND_RECEIPT",
      }),
      expect.objectContaining({
        id: "cash-kzo34-deduction",
        relatedDividendLedgerEntryId: "dividend-ledger-kzo34-1",
        entryType: "DIVIDEND_DEDUCTION",
      }),
    ]);
  });

  it("rejects duplicate active dividend ledger rows in accounting store saves", async () => {
    persistence = new PostgresPersistence({
      databaseUrl: databaseUrl!,
      redisUrl: redisUrl!,
    });
    await persistence.init();

    const store = await persistence.loadStore("user-1");
    store.accounting.facts.dividendEvents = [
      {
        id: "dividend-event-kzo34-duplicate",
        symbol: "0056",
        eventType: "CASH",
        exDividendDate: "2026-07-15",
        paymentDate: "2026-08-10",
        cashDividendPerShare: 1.2,
        cashDividendCurrency: "TWD",
        stockDividendPerShare: 0,
        sourceType: "manual",
        sourceReference: "dividend-event-kzo34-duplicate",
      },
    ];
    store.accounting.facts.dividendLedgerEntries = [
      {
        id: "dividend-ledger-kzo34-duplicate-1",
        accountId: "user-1-acc-1",
        dividendEventId: "dividend-event-kzo34-duplicate",
        eligibleQuantity: 1000,
        expectedCashAmount: 1200,
        expectedStockQuantity: 0,
        receivedCashAmount: 0,
        receivedStockQuantity: 0,
        postingStatus: "expected",
        reconciliationStatus: "open",
      },
      {
        id: "dividend-ledger-kzo34-duplicate-2",
        accountId: "user-1-acc-1",
        dividendEventId: "dividend-event-kzo34-duplicate",
        eligibleQuantity: 1000,
        expectedCashAmount: 1200,
        expectedStockQuantity: 0,
        receivedCashAmount: 0,
        receivedStockQuantity: 0,
        postingStatus: "expected",
        reconciliationStatus: "open",
      },
    ];

    await expect(persistence.saveStore(store)).rejects.toThrow(/duplicates active row/i);
  });

  it("rejects duplicate persisted booking sequence and opened sequence in accounting store saves", async () => {
    persistence = new PostgresPersistence({
      databaseUrl: databaseUrl!,
      redisUrl: redisUrl!,
    });
    await persistence.init();

    const store = await persistence.loadStore("user-1");
    store.accounting.facts.tradeEvents = [
      {
        id: "trade-kzo46-dupe-1",
        userId: "user-1",
        accountId: "user-1-acc-1",
        symbol: "2330",
        instrumentType: "STOCK",
        type: "BUY",
        quantity: 10,
        unitPrice: 100,
        priceCurrency: "TWD",
        tradeDate: "2026-03-01",
        tradeTimestamp: "2026-03-01T09:00:00.000Z",
        bookingSequence: 1,
        commissionAmount: 20,
        taxAmount: 0,
        isDayTrade: false,
        feeSnapshot: store.feeProfiles[0],
        sourceType: "test",
        sourceReference: "trade-kzo46-dupe-1",
        bookedAt: "2026-03-01T09:00:00.000Z",
      },
      {
        id: "trade-kzo46-dupe-2",
        userId: "user-1",
        accountId: "user-1-acc-1",
        symbol: "2330",
        instrumentType: "STOCK",
        type: "BUY",
        quantity: 5,
        unitPrice: 110,
        priceCurrency: "TWD",
        tradeDate: "2026-03-01",
        tradeTimestamp: "2026-03-01T09:00:01.000Z",
        bookingSequence: 1,
        commissionAmount: 20,
        taxAmount: 0,
        isDayTrade: false,
        feeSnapshot: store.feeProfiles[0],
        sourceType: "test",
        sourceReference: "trade-kzo46-dupe-2",
        bookedAt: "2026-03-01T09:00:01.000Z",
      },
    ];
    store.accounting.projections.lots = [
      {
        id: "lot-kzo46-dupe-1",
        accountId: "user-1-acc-1",
        symbol: "2330",
        openQuantity: 10,
        totalCostAmount: 1000,
        costCurrency: "TWD",
        openedAt: "2026-03-01",
        openedSequence: 1,
      },
      {
        id: "lot-kzo46-dupe-2",
        accountId: "user-1-acc-1",
        symbol: "2330",
        openQuantity: 5,
        totalCostAmount: 550,
        costCurrency: "TWD",
        openedAt: "2026-03-01",
        openedSequence: 1,
      },
    ];

    await expect(persistence.saveStore(store)).rejects.toThrow(
      /duplicates booking sequence 1|duplicates opened sequence 1/i,
    );
  });

  it("does not load orphaned trade fee snapshots when canonical trade events are absent", async () => {
    persistence = new PostgresPersistence({
      databaseUrl: databaseUrl!,
      redisUrl: redisUrl!,
    });
    await persistence.init();

    await pool.query(
      `INSERT INTO trade_fee_policy_snapshots (
         id, user_id, profile_id_at_booking, profile_name_at_booking, board_commission_rate,
         commission_discount_percent, minimum_commission_amount, commission_currency,
         commission_rounding_mode, tax_rounding_mode, stock_sell_tax_rate_bps,
         stock_day_trade_tax_rate_bps, etf_sell_tax_rate_bps, bond_etf_sell_tax_rate_bps,
         commission_charge_mode, booked_at
       ) VALUES (
         'trade-fee-snapshot:orphan-only', 'user-1', 'user-1-fp-default', 'Default Broker', 1.425,
         0, 20, 'TWD',
         'FLOOR', 'FLOOR', 30,
         15, 10, 0,
         'CHARGED_UPFRONT', NOW()
       )`,
    );

    const reloaded = await persistence.loadStore("user-1");

    expect(reloaded.accounting.facts.tradeEvents).toEqual([]);
  });

  it("persists a posted buy through the canonical savePostedTrade path", async () => {
    persistence = new PostgresPersistence({
      databaseUrl: databaseUrl!,
      redisUrl: redisUrl!,
    });
    await persistence.init();

    const store = await persistence.loadStore("user-1");
    const createdTrade = createTransaction(store, "user-1", {
      id: "trade-kzo24-buy",
      accountId: "user-1-acc-1",
      symbol: "2330",
      quantity: 10,
      unitPrice: 100,
      priceCurrency: "TWD",
      tradeDate: "2026-03-01",
      tradeTimestamp: "2026-03-01T09:00:00.000Z",
      commissionAmount: 7,
      taxAmount: 3,
      type: "BUY",
      isDayTrade: false,
    });

    await persistence.savePostedTrade("user-1", store.accounting, createdTrade.id);

    const tradeEvents = await pool.query<{
      id: string;
      source_type: string;
      source_reference: string | null;
      booking_sequence: number;
      commission_amount: number;
      tax_amount: number;
    }>(
      `SELECT id, source_type, source_reference, booking_sequence, commission_amount, tax_amount
       FROM trade_events
       WHERE user_id = 'user-1'
       ORDER BY id`,
    );
    expect(tradeEvents.rows).toEqual([
      {
        id: createdTrade.id,
        source_type: "portfolio_transaction_api",
        source_reference: createdTrade.id,
        booking_sequence: 1,
        commission_amount: 7,
        tax_amount: 3,
      },
    ]);

    const cashEntries = await pool.query<{
      related_trade_event_id: string | null;
      entry_type: string;
      amount: number;
      source_type: string;
    }>(
      `SELECT related_trade_event_id, entry_type, amount, source_type
       FROM cash_ledger_entries
       WHERE user_id = 'user-1'
       ORDER BY id`,
    );
    expect(cashEntries.rows).toEqual([
      {
        related_trade_event_id: createdTrade.id,
        entry_type: "TRADE_SETTLEMENT_OUT",
        amount: -(10 * 100 + 7 + 3),
        source_type: "trade_settlement",
      },
    ]);

    const lots = await pool.query<{
      symbol: string;
      open_quantity: number;
      total_cost_amount: number;
      opened_sequence: number;
    }>(
      `SELECT symbol, open_quantity, total_cost_amount, opened_sequence
       FROM lots
       WHERE account_id = 'user-1-acc-1'
       ORDER BY id`,
    );
    expect(lots.rows).toEqual([
      {
        symbol: "2330",
        open_quantity: 10,
        total_cost_amount: 10 * 100 + 7 + 3,
        opened_sequence: 1,
      },
    ]);
  });

  it("persists a posted sell with lot allocations and reloadable holdings", async () => {
    persistence = new PostgresPersistence({
      databaseUrl: databaseUrl!,
      redisUrl: redisUrl!,
    });
    await persistence.init();

    const store = await persistence.loadStore("user-1");
    const buyTrade = createTransaction(store, "user-1", {
      id: "trade-kzo24-seeded-buy",
      accountId: "user-1-acc-1",
      symbol: "2330",
      quantity: 10,
      unitPrice: 100,
      priceCurrency: "TWD",
      tradeDate: "2026-03-01",
      tradeTimestamp: "2026-03-01T09:00:00.000Z",
      commissionAmount: 7,
      taxAmount: 3,
      type: "BUY",
      isDayTrade: false,
    });
    await persistence.savePostedTrade("user-1", store.accounting, buyTrade.id);

    const sellTrade = createTransaction(store, "user-1", {
      id: "trade-kzo24-sell",
      accountId: "user-1-acc-1",
      symbol: "2330",
      quantity: 5,
      unitPrice: 130,
      priceCurrency: "TWD",
      tradeDate: "2026-03-02",
      tradeTimestamp: "2026-03-02T09:00:00.000Z",
      commissionAmount: 11,
      taxAmount: 13,
      type: "SELL",
      isDayTrade: false,
    });
    await persistence.savePostedTrade("user-1", store.accounting, sellTrade.id);

    const tradeEvents = await pool.query<{
      id: string;
      commission_amount: number;
      tax_amount: number;
    }>(
      `SELECT id, commission_amount, tax_amount
       FROM trade_events
       WHERE user_id = 'user-1'
       ORDER BY trade_date, booking_sequence, id`,
    );
    expect(tradeEvents.rows).toEqual([
      {
        id: buyTrade.id,
        commission_amount: 7,
        tax_amount: 3,
      },
      {
        id: sellTrade.id,
        commission_amount: 11,
        tax_amount: 13,
      },
    ]);

    const lotAllocations = await pool.query<{
      trade_event_id: string;
      allocated_quantity: number;
      allocated_cost_amount: number;
      lot_opened_sequence: number;
    }>(
      `SELECT trade_event_id, allocated_quantity, allocated_cost_amount, lot_opened_sequence
       FROM lot_allocations
       WHERE user_id = 'user-1'
       ORDER BY id`,
    );
    expect(lotAllocations.rows).toEqual([
      {
        trade_event_id: sellTrade.id,
        allocated_quantity: 5,
        allocated_cost_amount: 505,
        lot_opened_sequence: 1,
      },
    ]);

    const cashEntries = await pool.query<{
      related_trade_event_id: string | null;
      entry_type: string;
      amount: number;
    }>(
      `SELECT related_trade_event_id, entry_type, amount
       FROM cash_ledger_entries
       WHERE user_id = 'user-1'
       ORDER BY entry_date, id`,
    );
    expect(cashEntries.rows).toEqual([
      {
        related_trade_event_id: buyTrade.id,
        entry_type: "TRADE_SETTLEMENT_OUT",
        amount: -1010,
      },
      {
        related_trade_event_id: sellTrade.id,
        entry_type: "TRADE_SETTLEMENT_IN",
        amount: 626,
      },
    ]);

    const reloaded = await persistence.loadStore("user-1");
    expect(reloaded.accounting.projections.holdings).toEqual([
      expect.objectContaining({
        accountId: "user-1-acc-1",
        symbol: "2330",
        quantity: 5,
        costBasisAmount: 505,
      }),
    ]);
    const reloadedSell = reloaded.accounting.facts.tradeEvents.find((tx) => tx.id === sellTrade.id);
    expect(reloadedSell?.realizedPnlAmount).toBe(121);
  });

  it("persists a posted dividend with typed deductions and linked cash effects", async () => {
    persistence = new PostgresPersistence({
      databaseUrl: databaseUrl!,
      redisUrl: redisUrl!,
    });
    await persistence.init();

    const store = await persistence.loadStore("user-1");
    const seededBuy = createTransaction(store, "user-1", {
      id: "trade-kzo36-buy",
      accountId: "user-1-acc-1",
      symbol: "2330",
      quantity: 10,
      unitPrice: 100,
      priceCurrency: "TWD",
      tradeDate: "2026-01-15",
      tradeTimestamp: "2026-01-15T09:00:00.000Z",
      commissionAmount: 0,
      taxAmount: 0,
      type: "BUY",
      isDayTrade: false,
    });
    await persistence.savePostedTrade("user-1", store.accounting, seededBuy.id);

    const dividendEvent = createDividendEvent(store, {
      id: "dividend-event-kzo36",
      symbol: "2330",
      eventType: "CASH_AND_STOCK",
      exDividendDate: "2026-02-01",
      paymentDate: "2026-02-20",
      cashDividendPerShare: 12,
      cashDividendCurrency: "TWD",
      stockDividendPerShare: 0.1,
      sourceType: "manual_dividend_event",
      sourceReference: "dividend-event-kzo36",
    });

    const posting = postDividend(store, "user-1", {
      id: "dividend-ledger-kzo36",
      accountId: "user-1-acc-1",
      dividendEventId: dividendEvent.id,
      receivedCashAmount: 108,
      receivedStockQuantity: 1,
      deductions: [
        {
          id: "dividend-deduction-kzo36",
          deductionType: "NHI_SUPPLEMENTAL_PREMIUM",
          amount: 12,
          currencyCode: "TWD",
          withheldAtSource: true,
          sourceType: "dividend_posting",
          sourceReference: "dividend-deduction-kzo36",
        },
      ],
    });
    await persistence.savePostedDividend("user-1", store.accounting, posting.dividendLedgerEntry.id);

    const dividendEvents = await pool.query<{
      id: string;
      event_type: string;
      cash_dividend_per_share: string;
      stock_dividend_per_share: string;
    }>(
      `SELECT id, event_type, cash_dividend_per_share, stock_dividend_per_share
       FROM dividend_events
       WHERE id = 'dividend-event-kzo36'`,
    );
    expect(dividendEvents.rows).toEqual([
      {
        id: "dividend-event-kzo36",
        event_type: "CASH_AND_STOCK",
        cash_dividend_per_share: "12.000000",
        stock_dividend_per_share: "0.100000",
      },
    ]);

    const dividendLedgerEntries = await pool.query<{
      id: string;
      eligible_quantity: number;
      expected_cash_amount: number;
      expected_stock_quantity: number;
      received_stock_quantity: number;
      posting_status: string;
    }>(
      `SELECT id, eligible_quantity, expected_cash_amount, expected_stock_quantity,
              received_stock_quantity, posting_status
       FROM dividend_ledger_entries
       WHERE id = 'dividend-ledger-kzo36'`,
    );
    expect(dividendLedgerEntries.rows).toEqual([
      {
        id: "dividend-ledger-kzo36",
        eligible_quantity: 10,
        expected_cash_amount: 120,
        expected_stock_quantity: 1,
        received_stock_quantity: 1,
        posting_status: "posted",
      },
    ]);

    const dividendDeductions = await pool.query<{
      deduction_type: string;
      amount: number;
      currency_code: string;
    }>(
      `SELECT deduction_type, amount, currency_code
       FROM dividend_deduction_entries
       WHERE dividend_ledger_entry_id = 'dividend-ledger-kzo36'`,
    );
    expect(dividendDeductions.rows).toEqual([
      {
        deduction_type: "NHI_SUPPLEMENTAL_PREMIUM",
        amount: 12,
        currency_code: "TWD",
      },
    ]);

    const cashEntries = await pool.query<{
      entry_type: string;
      amount: number;
      related_dividend_ledger_entry_id: string | null;
    }>(
      `SELECT entry_type, amount, related_dividend_ledger_entry_id
       FROM cash_ledger_entries
       WHERE related_dividend_ledger_entry_id = 'dividend-ledger-kzo36'
       ORDER BY amount DESC`,
    );
    expect(cashEntries.rows).toEqual([
      {
        entry_type: "DIVIDEND_RECEIPT",
        amount: 108,
        related_dividend_ledger_entry_id: "dividend-ledger-kzo36",
      },
      {
        entry_type: "DIVIDEND_DEDUCTION",
        amount: -12,
        related_dividend_ledger_entry_id: "dividend-ledger-kzo36",
      },
    ]);

    const reloaded = await persistence.loadStore("user-1");
    expect(reloaded.accounting.facts.dividendLedgerEntries).toEqual([
      expect.objectContaining({
        id: "dividend-ledger-kzo36",
        expectedCashAmount: 120,
        receivedCashAmount: 108,
        receivedStockQuantity: 1,
      }),
    ]);
    expect(reloaded.accounting.facts.dividendDeductionEntries).toEqual([
      expect.objectContaining({
        id: "dividend-deduction-kzo36",
        dividendLedgerEntryId: "dividend-ledger-kzo36",
        deductionType: "NHI_SUPPLEMENTAL_PREMIUM",
        amount: 12,
        currencyCode: "TWD",
      }),
    ]);
    expect(reloaded.accounting.projections.holdings).toEqual([
      expect.objectContaining({
        accountId: "user-1-acc-1",
        symbol: "2330",
        quantity: 11,
        costBasisAmount: 1000,
      }),
    ]);
  });

  it("rejects overwriting an already-posted dividend ledger entry in place", async () => {
    persistence = new PostgresPersistence({
      databaseUrl: databaseUrl!,
      redisUrl: redisUrl!,
    });
    await persistence.init();

    const store = await persistence.loadStore("user-1");
    const seededBuy = createTransaction(store, "user-1", {
      id: "trade-kzo51-buy",
      accountId: "user-1-acc-1",
      symbol: "2330",
      quantity: 10,
      unitPrice: 100,
      priceCurrency: "TWD",
      tradeDate: "2026-01-15",
      tradeTimestamp: "2026-01-15T09:00:00.000Z",
      commissionAmount: 0,
      taxAmount: 0,
      type: "BUY",
      isDayTrade: false,
    });
    await persistence.savePostedTrade("user-1", store.accounting, seededBuy.id);

    const dividendEvent = createDividendEvent(store, {
      id: "dividend-event-kzo51",
      symbol: "2330",
      eventType: "CASH",
      exDividendDate: "2026-02-01",
      paymentDate: "2026-02-20",
      cashDividendPerShare: 12,
      cashDividendCurrency: "TWD",
      stockDividendPerShare: 0,
      sourceType: "manual_dividend_event",
      sourceReference: "dividend-event-kzo51",
    });

    const posting = postDividend(store, "user-1", {
      id: "dividend-ledger-kzo51",
      accountId: "user-1-acc-1",
      dividendEventId: dividendEvent.id,
      receivedCashAmount: 108,
      receivedStockQuantity: 0,
      deductions: [
        {
          id: "dividend-deduction-kzo51",
          deductionType: "NHI_SUPPLEMENTAL_PREMIUM",
          amount: 12,
          currencyCode: "TWD",
          withheldAtSource: true,
          sourceType: "dividend_posting",
          sourceReference: "dividend-deduction-kzo51",
        },
      ],
    });
    await persistence.savePostedDividend("user-1", store.accounting, posting.dividendLedgerEntry.id);

    const overwrittenAccounting = structuredClone(store.accounting);
    const overwrittenDividendLedgerEntry = overwrittenAccounting.facts.dividendLedgerEntries.find(
      (entry) => entry.id === posting.dividendLedgerEntry.id,
    );
    if (!overwrittenDividendLedgerEntry) {
      throw new Error("expected posted dividend ledger entry in accounting store");
    }
    overwrittenDividendLedgerEntry.receivedCashAmount = 999;

    const overwrittenReceiptEntry = overwrittenAccounting.facts.cashLedgerEntries.find(
      (entry) => entry.id === `${posting.dividendLedgerEntry.id}:receipt`,
    );
    if (!overwrittenReceiptEntry) {
      throw new Error("expected dividend receipt cash entry in accounting store");
    }
    overwrittenReceiptEntry.amount = 999;

    await expect(
      persistence.savePostedDividend("user-1", overwrittenAccounting, posting.dividendLedgerEntry.id),
    ).rejects.toThrow(/cannot be overwritten in place/i);

    const persistedDividendLedgerEntries = await pool.query<{ received_stock_quantity: number; posting_status: string }>(
      `SELECT received_stock_quantity, posting_status
       FROM dividend_ledger_entries
       WHERE id = 'dividend-ledger-kzo51'`,
    );
    expect(persistedDividendLedgerEntries.rows).toEqual([{ received_stock_quantity: 0, posting_status: "posted" }]);

    const persistedCashEntries = await pool.query<{ amount: number }>(
      `SELECT amount
       FROM cash_ledger_entries
       WHERE id = 'dividend-ledger-kzo51:receipt'`,
    );
    expect(persistedCashEntries.rows).toEqual([{ amount: 108 }]);
  });

  it("persists mirrored realized pnl from canonical allocations instead of stale trade state", async () => {
    persistence = new PostgresPersistence({
      databaseUrl: databaseUrl!,
      redisUrl: redisUrl!,
    });
    await persistence.init();

    const store = await persistence.loadStore("user-1");
    createTransaction(store, "user-1", {
      id: "trade-kzo52-buy",
      accountId: "user-1-acc-1",
      symbol: "2330",
      quantity: 10,
      unitPrice: 100,
      priceCurrency: "TWD",
      tradeDate: "2026-03-01",
      tradeTimestamp: "2026-03-01T09:00:00.000Z",
      commissionAmount: 7,
      taxAmount: 3,
      type: "BUY",
      isDayTrade: false,
    });
    createTransaction(store, "user-1", {
      id: "trade-kzo52-sell",
      accountId: "user-1-acc-1",
      symbol: "2330",
      quantity: 5,
      unitPrice: 130,
      priceCurrency: "TWD",
      tradeDate: "2026-03-02",
      tradeTimestamp: "2026-03-02T09:00:00.000Z",
      commissionAmount: 11,
      taxAmount: 13,
      type: "SELL",
      isDayTrade: false,
    });

    const staleSellTrade = store.accounting.facts.tradeEvents.find((tx) => tx.id === "trade-kzo52-sell");
    expect(staleSellTrade).toBeDefined();
    staleSellTrade!.realizedPnlAmount = -999;

    await persistence.saveStore(store);

    const reloaded = await persistence.loadStore("user-1");
    const reloadedSell = reloaded.accounting.facts.tradeEvents.find((tx) => tx.id === "trade-kzo52-sell");
    expect(reloadedSell?.realizedPnlAmount).toBe(121);
  });
});
