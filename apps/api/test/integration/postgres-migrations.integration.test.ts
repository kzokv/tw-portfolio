import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
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

describePostgres("postgres migrations", () => {
  let pool: Pool;
  let persistence: PostgresPersistence | null = null;

  beforeEach(async () => {
    pool = new Pool({ connectionString: databaseUrl });
    const client = await pool.connect();
    try {
      await client.query("DROP SCHEMA IF EXISTS public CASCADE");
      await client.query("CREATE SCHEMA public");
      await client.query("GRANT ALL ON SCHEMA public TO public");

      const currentDir = path.dirname(fileURLToPath(import.meta.url));
      const initMigrationPath = path.resolve(currentDir, "../../../../db/migrations/001_init.sql");
      const initMigration = await fs.readFile(initMigrationPath, "utf8");
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
  });

  afterEach(async () => {
    if (persistence) {
      await persistence.close();
      persistence = null;
    }
    await pool.end();
  });

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
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const migrationsDir = path.resolve(currentDir, "../../../../db/migrations");
    const migrationFiles = (await fs.readdir(migrationsDir))
      .filter((file) => /^\d+_.*\.sql$/.test(file))
      .sort((a, b) => a.localeCompare(b));

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
    expect(firstPass.rows.map((row) => row.name)).toEqual(migrationFiles);

    persistence = new PostgresPersistence({
      databaseUrl: databaseUrl!,
      redisUrl: redisUrl!,
    });
    await persistence.init();

    const secondPass = await pool.query<{ name: string }>(
      "SELECT name FROM schema_migrations ORDER BY name",
    );
    expect(secondPass.rows.map((row) => row.name)).toEqual(migrationFiles);
  });

  it("applies KZO-15 accounting schema objects", async () => {
    persistence = new PostgresPersistence({
      databaseUrl: databaseUrl!,
      redisUrl: redisUrl!,
    });
    await persistence.init();

    const expectedTables = [
      "trade_events",
      "cash_ledger_entries",
      "dividend_events",
      "dividend_ledger_entries",
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
      "ux_trade_events_account_source_reference",
      "ux_trade_events_reversal_of_trade_event_id",
      "idx_cash_ledger_entries_account_entry_date",
      "ux_cash_ledger_entries_account_source_reference",
      "ux_cash_ledger_entries_reversal_of_cash_ledger_entry_id",
      "idx_dividend_events_symbol_ex_dividend_date",
      "idx_dividend_ledger_entries_dividend_event_id",
      "ux_dividend_ledger_entries_reversal_of_dividend_ledger_entry_id",
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
    expect(hasConstraint("reconciliation_records", "reconciliation_status = ANY")).toBe(true);

    expect(
      hasConstraint(
        "daily_portfolio_snapshots",
        "FOREIGN KEY (user_id) REFERENCES users(id)",
      ),
    ).toBe(true);

    const userId = "user-1";
    const accountId = "user-1-acc-1";
    await pool.query(
      `INSERT INTO trade_events (
         id, user_id, account_id, symbol, instrument_type, trade_type, quantity, price_ntd,
         trade_date, commission_ntd, tax_ntd, is_day_trade, fee_snapshot_json, source_type,
         source_reference, booked_at
       ) VALUES (
         'trade-base', $1, $2, '2330', 'STOCK', 'BUY', 100, 600,
         DATE '2026-03-01', 10, 0, false, '{}', 'manual', 'trade-base', NOW()
       )`,
      [userId, accountId],
    );

    await expect(
      pool.query(
        `INSERT INTO dividend_events (
           id, symbol, event_type, ex_dividend_date, payment_date,
           cash_dividend_per_share, stock_dividend_per_share, source_type, source_reference
         ) VALUES (
           'dividend-invalid-type', '0056', 'CASH', DATE '2026-07-15', DATE '2026-08-10',
           0, 1.2, 'manual', 'dividend-invalid-type'
         )`,
      ),
    ).rejects.toThrow(/check constraint/i);

    await expect(
      pool.query(
        `INSERT INTO cash_ledger_entries (
           id, user_id, account_id, entry_date, entry_type, amount_ntd, currency,
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
           id, user_id, account_id, entry_date, entry_type, amount_ntd, currency,
           related_trade_event_id, source_type, source_reference
         ) VALUES (
           'cash-invalid-link', $1, $2, DATE '2026-03-02', 'DIVIDEND_RECEIPT', 100, 'TWD',
           'trade-base', 'manual', 'cash-invalid-link'
         )`,
        [userId, accountId],
      ),
    ).rejects.toThrow(/check constraint/i);

    await pool.query(
      `INSERT INTO trade_events (
         id, user_id, account_id, symbol, instrument_type, trade_type, quantity, price_ntd,
         trade_date, commission_ntd, tax_ntd, is_day_trade, fee_snapshot_json, source_type,
         source_reference, booked_at, reversal_of_trade_event_id
       ) VALUES (
         'trade-reversal-1', $1, $2, '2330', 'STOCK', 'SELL', 100, 600,
         DATE '2026-03-03', 10, 0, false, '{}', 'manual', 'trade-reversal-1', NOW(), 'trade-base'
       )`,
      [userId, accountId],
    );
    await expect(
      pool.query(
        `INSERT INTO trade_events (
           id, user_id, account_id, symbol, instrument_type, trade_type, quantity, price_ntd,
           trade_date, commission_ntd, tax_ntd, is_day_trade, fee_snapshot_json, source_type,
           source_reference, booked_at, reversal_of_trade_event_id
         ) VALUES (
           'trade-reversal-2', $1, $2, '2330', 'STOCK', 'SELL', 100, 600,
           DATE '2026-03-04', 10, 0, false, '{}', 'manual', 'trade-reversal-2', NOW(), 'trade-base'
         )`,
        [userId, accountId],
      ),
    ).rejects.toThrow(/duplicate key value/i);
  });
});
