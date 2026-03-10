import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
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

  it("normalizes legacy duplicate booking and lot sequences before adding uniqueness indexes", async () => {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const migrationsDir = path.resolve(currentDir, "../../../../db/migrations");
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
           'user-1-fp-default', 'user-1', 'Default Broker', 14, 10000,
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
    await pool.query(
      `INSERT INTO trade_events (
         id, user_id, account_id, symbol, instrument_type, trade_type, quantity, price_ntd,
         trade_date, trade_timestamp, booking_sequence, commission_ntd, tax_ntd, is_day_trade,
         fee_snapshot_json, source_type, source_reference, booked_at
       ) VALUES (
         'trade-base', $1, $2, '2330', 'STOCK', 'BUY', 100, 600,
         DATE '2026-03-01', TIMESTAMP '2026-03-01 09:00:00', 1, 10, 0, false,
         '{}', 'manual', 'trade-base', NOW()
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
      `INSERT INTO dividend_events (
         id, symbol, event_type, ex_dividend_date, payment_date,
         cash_dividend_per_share, stock_dividend_per_share, source_type, source_reference
       ) VALUES (
         'dividend-base', '0056', 'CASH', DATE '2026-07-15', DATE '2026-08-10',
         1.2, 0, 'manual', 'dividend-base'
       )`,
    );

    await expect(
      pool.query(
        `INSERT INTO dividend_ledger_entries (
           id, account_id, dividend_event_id, eligible_quantity, expected_cash_amount_ntd,
           expected_stock_quantity, received_cash_amount_ntd, received_stock_quantity,
           posting_status, reconciliation_status
         ) VALUES (
           'dividend-ledger-invalid-status', $1, 'dividend-base', 2000, 2400,
           0, 0, 0,
           'reconciled', 'open'
         )`,
        [accountId],
      ),
    ).rejects.toThrow(/check constraint/i);

    await pool.query(
      `INSERT INTO dividend_ledger_entries (
         id, account_id, dividend_event_id, eligible_quantity, expected_cash_amount_ntd,
         expected_stock_quantity, received_cash_amount_ntd, received_stock_quantity,
         posting_status, reconciliation_status
       ) VALUES (
         'dividend-ledger-active-1', $1, 'dividend-base', 2000, 2400,
         0, 2280, 0,
         'posted', 'open'
       )`,
      [accountId],
    );

    await expect(
      pool.query(
        `INSERT INTO dividend_ledger_entries (
           id, account_id, dividend_event_id, eligible_quantity, expected_cash_amount_ntd,
           expected_stock_quantity, received_cash_amount_ntd, received_stock_quantity,
           posting_status, reconciliation_status
         ) VALUES (
           'dividend-ledger-active-2', $1, 'dividend-base', 2000, 2400,
           0, 2280, 0,
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
         id, account_id, dividend_event_id, eligible_quantity, expected_cash_amount_ntd,
         expected_stock_quantity, received_cash_amount_ntd, received_stock_quantity,
         posting_status, reconciliation_status
       ) VALUES (
         'dividend-ledger-active-2', $1, 'dividend-base', 2000, 2400,
         0, 2280, 0,
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
           'NHI_SUPPLEMENTAL_PREMIUM', 120, 'USD',
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

    await pool.query(
      `INSERT INTO trade_events (
         id, user_id, account_id, symbol, instrument_type, trade_type, quantity, price_ntd,
         trade_date, trade_timestamp, booking_sequence, commission_ntd, tax_ntd, is_day_trade,
         fee_snapshot_json, source_type, source_reference, booked_at, reversal_of_trade_event_id
       ) VALUES (
         'trade-reversal-1', $1, $2, '2330', 'STOCK', 'SELL', 100, 600,
         DATE '2026-03-03', TIMESTAMP '2026-03-03 09:00:00', 1, 10, 0, false,
         '{}', 'manual', 'trade-reversal-1', NOW(), 'trade-base'
       )`,
      [userId, accountId],
    );
    await expect(
      pool.query(
        `INSERT INTO trade_events (
           id, user_id, account_id, symbol, instrument_type, trade_type, quantity, price_ntd,
           trade_date, trade_timestamp, booking_sequence, commission_ntd, tax_ntd, is_day_trade,
           fee_snapshot_json, source_type, source_reference, booked_at, reversal_of_trade_event_id
         ) VALUES (
           'trade-reversal-2', $1, $2, '2330', 'STOCK', 'SELL', 100, 600,
           DATE '2026-03-04', TIMESTAMP '2026-03-04 09:00:00', 1, 10, 0, false,
           '{}', 'manual', 'trade-reversal-2', NOW(), 'trade-base'
         )`,
        [userId, accountId],
      ),
    ).rejects.toThrow(/duplicate key value/i);

    await expect(
      pool.query(
        `INSERT INTO trade_events (
           id, user_id, account_id, symbol, instrument_type, trade_type, quantity, price_ntd,
           trade_date, trade_timestamp, booking_sequence, commission_ntd, tax_ntd, is_day_trade,
           fee_snapshot_json, source_type, source_reference, booked_at
         ) VALUES (
           'trade-duplicate-sequence', $1, $2, '2330', 'STOCK', 'BUY', 10, 610,
           DATE '2026-03-01', TIMESTAMP '2026-03-01 09:00:01', 1, 10, 0, false,
           '{}', 'manual', 'trade-duplicate-sequence', NOW()
         )`,
        [userId, accountId],
      ),
    ).rejects.toThrow(/duplicate key value/i);

    await pool.query(
      `INSERT INTO lots (
         id, account_id, symbol, open_quantity, total_cost_ntd, opened_at, opened_sequence
       ) VALUES (
         'lot-base', $1, '2330', 100, 60000, DATE '2026-03-01', 1
       )`,
      [accountId],
    );

    await expect(
      pool.query(
        `INSERT INTO lots (
           id, account_id, symbol, open_quantity, total_cost_ntd, opened_at, opened_sequence
         ) VALUES (
           'lot-duplicate-order', $1, '2330', 50, 30000, DATE '2026-03-01', 1
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
        priceNtd: 100,
        tradeDate: "2026-03-01",
        tradeTimestamp: "2026-03-01T09:00:00.000Z",
        bookingSequence: 1,
        commissionNtd: 20,
        taxNtd: 0,
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
        amountNtd: -1020,
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
        totalCostNtd: 1020,
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
        allocatedCostNtd: 1020,
        createdAt: "2026-03-01T09:00:02.000Z",
      },
    ];
    store.accounting.projections.dailyPortfolioSnapshots = [
      {
        id: "snapshot-kzo48-1",
        snapshotDate: "2026-03-01",
        totalMarketValueNtd: 1000,
        totalCostNtd: 1020,
        totalUnrealizedPnlNtd: -20,
        totalRealizedPnlNtd: 0,
        totalDividendReceivedNtd: 0,
        totalCashBalanceNtd: -1020,
        totalNavNtd: -20,
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

    const cashEntries = await pool.query<{ id: string; amount_ntd: number; related_trade_event_id: string | null }>(
      `SELECT id, amount_ntd, related_trade_event_id
       FROM cash_ledger_entries
       WHERE user_id = 'user-1'
       ORDER BY id`,
    );
    expect(cashEntries.rows).toEqual([
      { id: "cash-kzo48-1", amount_ntd: -1020, related_trade_event_id: "trade-kzo48-1" },
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
        amountNtd: -1020,
      }),
    ]);
    expect(reloaded.accounting.projections.dailyPortfolioSnapshots).toEqual([
      expect.objectContaining({
        id: "snapshot-kzo48-1",
        generationRunId: "run-kzo48-1",
      }),
    ]);

    const mirroredTransactions = await pool.query<{ id: string }>(
      `SELECT id
       FROM transactions
       WHERE user_id = 'user-1'
       ORDER BY id`,
    );
    expect(mirroredTransactions.rows).toEqual([{ id: "trade-kzo48-1" }]);
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
        priceNtd: 100,
        tradeDate: "2026-03-01",
        tradeTimestamp: "2026-03-01T09:00:00.000Z",
        bookingSequence: 1,
        commissionNtd: 20,
        taxNtd: 0,
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
        priceNtd: 110,
        tradeDate: "2026-03-01",
        tradeTimestamp: "2026-03-01T09:00:01.000Z",
        bookingSequence: 1,
        commissionNtd: 20,
        taxNtd: 0,
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
        totalCostNtd: 1000,
        openedAt: "2026-03-01",
        openedSequence: 1,
      },
      {
        id: "lot-kzo46-dupe-2",
        accountId: "user-1-acc-1",
        symbol: "2330",
        openQuantity: 5,
        totalCostNtd: 550,
        openedAt: "2026-03-01",
        openedSequence: 1,
      },
    ];

    await expect(persistence.saveStore(store)).rejects.toThrow(
      /duplicates booking sequence 1|duplicates opened sequence 1/i,
    );
  });

  it("does not load legacy mirrored transactions when canonical trade events are absent", async () => {
    persistence = new PostgresPersistence({
      databaseUrl: databaseUrl!,
      redisUrl: redisUrl!,
    });
    await persistence.init();

    await pool.query(
      `INSERT INTO transactions (
         id, user_id, account_id, symbol, instrument_type, tx_type,
         quantity, price_ntd, trade_date, commission_ntd, tax_ntd,
         is_day_trade, fee_profile_id, fee_snapshot_json, realized_pnl_ntd
       ) VALUES (
         'legacy-transaction-only', 'user-1', 'user-1-acc-1', '2330', 'STOCK', 'BUY',
         10, 100, DATE '2026-03-01', 20, 0,
         false, 'user-1-fp-default', '{}', NULL
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
      priceNtd: 100,
      tradeDate: "2026-03-01",
      tradeTimestamp: "2026-03-01T09:00:00.000Z",
      commissionNtd: 7,
      taxNtd: 3,
      type: "BUY",
      isDayTrade: false,
    });

    await persistence.savePostedTrade("user-1", store.accounting, createdTrade.id);

    const tradeEvents = await pool.query<{
      id: string;
      source_type: string;
      source_reference: string | null;
      booking_sequence: number;
      commission_ntd: number;
      tax_ntd: number;
    }>(
      `SELECT id, source_type, source_reference, booking_sequence, commission_ntd, tax_ntd
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
        commission_ntd: 7,
        tax_ntd: 3,
      },
    ]);

    const cashEntries = await pool.query<{
      related_trade_event_id: string | null;
      entry_type: string;
      amount_ntd: number;
      source_type: string;
    }>(
      `SELECT related_trade_event_id, entry_type, amount_ntd, source_type
       FROM cash_ledger_entries
       WHERE user_id = 'user-1'
       ORDER BY id`,
    );
    expect(cashEntries.rows).toEqual([
      {
        related_trade_event_id: createdTrade.id,
        entry_type: "TRADE_SETTLEMENT_OUT",
        amount_ntd: -(10 * 100 + 7 + 3),
        source_type: "trade_settlement",
      },
    ]);

    const lots = await pool.query<{
      symbol: string;
      open_quantity: number;
      total_cost_ntd: number;
      opened_sequence: number;
    }>(
      `SELECT symbol, open_quantity, total_cost_ntd, opened_sequence
       FROM lots
       WHERE account_id = 'user-1-acc-1'
       ORDER BY id`,
    );
    expect(lots.rows).toEqual([
      {
        symbol: "2330",
        open_quantity: 10,
        total_cost_ntd: 10 * 100 + 7 + 3,
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
      priceNtd: 100,
      tradeDate: "2026-03-01",
      tradeTimestamp: "2026-03-01T09:00:00.000Z",
      commissionNtd: 7,
      taxNtd: 3,
      type: "BUY",
      isDayTrade: false,
    });
    await persistence.savePostedTrade("user-1", store.accounting, buyTrade.id);

    const sellTrade = createTransaction(store, "user-1", {
      id: "trade-kzo24-sell",
      accountId: "user-1-acc-1",
      symbol: "2330",
      quantity: 5,
      priceNtd: 130,
      tradeDate: "2026-03-02",
      tradeTimestamp: "2026-03-02T09:00:00.000Z",
      commissionNtd: 11,
      taxNtd: 13,
      type: "SELL",
      isDayTrade: false,
    });
    await persistence.savePostedTrade("user-1", store.accounting, sellTrade.id);

    const tradeEvents = await pool.query<{
      id: string;
      commission_ntd: number;
      tax_ntd: number;
    }>(
      `SELECT id, commission_ntd, tax_ntd
       FROM trade_events
       WHERE user_id = 'user-1'
       ORDER BY trade_date, booking_sequence, id`,
    );
    expect(tradeEvents.rows).toEqual([
      {
        id: buyTrade.id,
        commission_ntd: 7,
        tax_ntd: 3,
      },
      {
        id: sellTrade.id,
        commission_ntd: 11,
        tax_ntd: 13,
      },
    ]);

    const mirroredTransactions = await pool.query<{
      id: string;
      realized_pnl_ntd: number | null;
    }>(
      `SELECT id, realized_pnl_ntd
       FROM transactions
       WHERE user_id = 'user-1'
       ORDER BY trade_date, id`,
    );
    expect(mirroredTransactions.rows).toEqual([
      {
        id: buyTrade.id,
        realized_pnl_ntd: null,
      },
      {
        id: sellTrade.id,
        realized_pnl_ntd: 121,
      },
    ]);

    const lotAllocations = await pool.query<{
      trade_event_id: string;
      allocated_quantity: number;
      allocated_cost_ntd: number;
      lot_opened_sequence: number;
    }>(
      `SELECT trade_event_id, allocated_quantity, allocated_cost_ntd, lot_opened_sequence
       FROM lot_allocations
       WHERE user_id = 'user-1'
       ORDER BY id`,
    );
    expect(lotAllocations.rows).toEqual([
      {
        trade_event_id: sellTrade.id,
        allocated_quantity: 5,
        allocated_cost_ntd: 505,
        lot_opened_sequence: 1,
      },
    ]);

    const cashEntries = await pool.query<{
      related_trade_event_id: string | null;
      entry_type: string;
      amount_ntd: number;
    }>(
      `SELECT related_trade_event_id, entry_type, amount_ntd
       FROM cash_ledger_entries
       WHERE user_id = 'user-1'
       ORDER BY entry_date, id`,
    );
    expect(cashEntries.rows).toEqual([
      {
        related_trade_event_id: buyTrade.id,
        entry_type: "TRADE_SETTLEMENT_OUT",
        amount_ntd: -1010,
      },
      {
        related_trade_event_id: sellTrade.id,
        entry_type: "TRADE_SETTLEMENT_IN",
        amount_ntd: 626,
      },
    ]);

    await pool.query(`DELETE FROM transactions WHERE user_id = 'user-1'`);

    const reloaded = await persistence.loadStore("user-1");
    expect(reloaded.accounting.projections.holdings).toEqual([
      expect.objectContaining({
        accountId: "user-1-acc-1",
        symbol: "2330",
        quantity: 5,
        costNtd: 505,
      }),
    ]);
    const reloadedSell = reloaded.accounting.facts.tradeEvents.find((tx) => tx.id === sellTrade.id);
    expect(reloadedSell?.realizedPnlNtd).toBe(121);
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
      priceNtd: 100,
      tradeDate: "2026-03-01",
      tradeTimestamp: "2026-03-01T09:00:00.000Z",
      commissionNtd: 7,
      taxNtd: 3,
      type: "BUY",
      isDayTrade: false,
    });
    createTransaction(store, "user-1", {
      id: "trade-kzo52-sell",
      accountId: "user-1-acc-1",
      symbol: "2330",
      quantity: 5,
      priceNtd: 130,
      tradeDate: "2026-03-02",
      tradeTimestamp: "2026-03-02T09:00:00.000Z",
      commissionNtd: 11,
      taxNtd: 13,
      type: "SELL",
      isDayTrade: false,
    });

    const staleSellTrade = store.accounting.facts.tradeEvents.find((tx) => tx.id === "trade-kzo52-sell");
    expect(staleSellTrade).toBeDefined();
    staleSellTrade!.realizedPnlNtd = -999;

    await persistence.saveStore(store);

    const mirrored = await pool.query<{ realized_pnl_ntd: number | null }>(
      `SELECT realized_pnl_ntd
       FROM transactions
       WHERE id = 'trade-kzo52-sell'`,
    );
    expect(mirrored.rows).toEqual([{ realized_pnl_ntd: 121 }]);

    const reloaded = await persistence.loadStore("user-1");
    const reloadedSell = reloaded.accounting.facts.tradeEvents.find((tx) => tx.id === "trade-kzo52-sell");
    expect(reloadedSell?.realizedPnlNtd).toBe(121);
  });
});
