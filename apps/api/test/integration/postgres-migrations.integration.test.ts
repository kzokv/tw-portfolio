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
const managedCiStack = process.env.VAKWEN_MANAGED_CI_STACK === "1";

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

  /**
   * KZO-183 helper: seed an account + its owner fee_profile under the post-042
   * schema (fee_profiles has account_id, no user_id). Uses a transaction to defer
   * the composite FK on accounts.fee_profile_id until COMMIT so we can insert
   * accounts before the matching fee_profile row exists.
   *
   * Caller must have already inserted the user row.
   */
  async function seedAccountWithFeeProfilePost042(input: {
    userId: string;
    accountId: string;
    accountName: string;
    feeProfileId: string;
    feeProfileName?: string;
    defaultCurrency?: string;
    accountType?: string;
  }): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO accounts (id, user_id, name, fee_profile_id, default_currency, account_type)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO NOTHING`,
        [
          input.accountId,
          input.userId,
          input.accountName,
          input.feeProfileId,
          input.defaultCurrency ?? "TWD",
          input.accountType ?? "broker",
        ],
      );
      await client.query(
        `INSERT INTO fee_profiles (
           id, account_id, name, commission_rate_bps, commission_discount_bps,
           minimum_commission_amount, commission_currency, commission_rounding_mode,
           tax_rounding_mode, stock_sell_tax_rate_bps, stock_day_trade_tax_rate_bps,
           etf_sell_tax_rate_bps, bond_etf_sell_tax_rate_bps, board_commission_rate,
           commission_discount_percent, commission_charge_mode
         ) VALUES (
           $1, $2, $3, 14, 7200,
           20, 'TWD', 'FLOOR', 'FLOOR',
           30, 15, 10, 0, 1.425, 28, 'CHARGED_UPFRONT'
         )
         ON CONFLICT (id) DO NOTHING`,
        [input.feeProfileId, input.accountId, input.feeProfileName ?? "Default"],
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async function applyNumberedMigrations(): Promise<void> {
    const manifest = await migrationManifestPromise;
    await applyMigrationFiles(manifest.numberedMigrations);
  }

  async function expectDefaultMarketCalendarSources(): Promise<void> {
    const result = await pool.query<{
      id: string;
      market_code: string;
      suggested_source_url: string | null;
      is_default: boolean;
    }>(
      `SELECT id, market_code, suggested_source_url, is_default
         FROM market_data.market_calendar_sources
        WHERE id IN ('official-tw', 'official-us', 'official-au', 'official-kr')
        ORDER BY id`,
    );
    expect(result.rows).toEqual([
      { id: "official-au", market_code: "AU", suggested_source_url: "https://www.asx.com.au/markets/market-resources/trading-hours-calendar/cash-market-trading-hours/trading-calendar", is_default: true },
      { id: "official-kr", market_code: "KR", suggested_source_url: "https://global.krx.co.kr/contents/GLB/05/0501/0501110000/GLB0501110000.jsp", is_default: true },
      { id: "official-tw", market_code: "TW", suggested_source_url: "https://www.twse.com.tw/en/trading/holiday.html", is_default: true },
      { id: "official-us", market_code: "US", suggested_source_url: "https://www.nasdaqtrader.com/trader.aspx?id=Calendar", is_default: true },
    ]);
  }

  async function expectMarketCalendarActivitySchema(): Promise<void> {
    const columns = await pool.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name
         FROM information_schema.columns
        WHERE table_schema = 'market_data'
          AND table_name IN ('market_calendar_sources', 'market_calendar_previews', 'market_calendar_versions', 'market_calendar_activity')
          AND column_name IN ('suggested_source_url', 'source_url', 'source_id', 'coverage', 'annual_counts', 'exceptions', 'source_kind', 'dedupe_key')
        ORDER BY table_name, column_name`,
    );
    expect(columns.rows).toEqual([
      { table_name: "market_calendar_activity", column_name: "dedupe_key" },
      { table_name: "market_calendar_activity", column_name: "source_id" },
      { table_name: "market_calendar_activity", column_name: "source_kind" },
      { table_name: "market_calendar_previews", column_name: "annual_counts" },
      { table_name: "market_calendar_previews", column_name: "coverage" },
      { table_name: "market_calendar_previews", column_name: "exceptions" },
      { table_name: "market_calendar_previews", column_name: "source_id" },
      { table_name: "market_calendar_previews", column_name: "source_url" },
      { table_name: "market_calendar_sources", column_name: "suggested_source_url" },
      { table_name: "market_calendar_versions", column_name: "annual_counts" },
      { table_name: "market_calendar_versions", column_name: "coverage" },
      { table_name: "market_calendar_versions", column_name: "exceptions" },
      { table_name: "market_calendar_versions", column_name: "source_id" },
      { table_name: "market_calendar_versions", column_name: "source_url" },
    ]);

    const sourceTypes = await pool.query<{ source_type: string }>(
      `SELECT DISTINCT source_type
         FROM market_data.market_calendar_sources
        WHERE id IN ('official-tw', 'official-us', 'official-au', 'official-kr')
        ORDER BY source_type`,
    );
    expect(sourceTypes.rows).toEqual([{ source_type: "official_source" }]);
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

  async function getNumberedMigrationsBefore(targetMigration: string): Promise<string[]> {
    const manifest = await migrationManifestPromise;
    const targetIndex = manifest.numberedMigrations.indexOf(targetMigration);
    if (targetIndex === -1) {
      throw new Error(`Expected migration ${targetMigration} in manifest`);
    }
    return manifest.numberedMigrations.slice(0, targetIndex);
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
         WHERE table_schema IN ('public', 'market_data')
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
         WHERE table_schema IN ('public', 'market_data')
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
         WHERE n.nspname IN ('public', 'market_data')
           AND rel.relname <> 'schema_migrations'
         ORDER BY rel.relname, c.contype, pg_get_constraintdef(c.oid)`,
      ),
      pool.query<{ tablename: string; indexname: string; indexdef: string }>(
        `SELECT tablename, indexname, indexdef
         FROM pg_indexes
         WHERE schemaname IN ('public', 'market_data')
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
    await resetDatabase();
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
    ticker: string;
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
    source?: string;
    sourceReference?: string;
    bookedAt?: string;
    reversalOfTradeEventId?: string;
  }): Promise<void> {
    const feeProfileId = `${input.userId}-fp-default`;

    await pool.query(
      `INSERT INTO users (id, email, locale, cost_basis_method, quote_poll_interval_seconds)
       VALUES ($1, $2, 'en', 'WEIGHTED_AVERAGE', 10)
       ON CONFLICT (id) DO NOTHING`,
      [input.userId, `${input.userId}@example.com`],
    );

    // KZO-183: post-042 schema requires accounts row to exist before fee_profiles
    // (fee_profiles.account_id has a regular FK to accounts(id)). The reverse FK
    // accounts.fee_profile_id is DEFERRABLE INITIALLY DEFERRED, so wrap both
    // INSERTs in a transaction to defer constraint checks until COMMIT.
    const seedClient = await pool.connect();
    try {
      await seedClient.query("BEGIN");
      await seedClient.query(
        `INSERT INTO accounts (id, user_id, name, fee_profile_id)
         VALUES ($1, $2, 'Main', $3)
         ON CONFLICT (id) DO NOTHING`,
        [input.accountId, input.userId, feeProfileId],
      );
      await seedClient.query(
        `INSERT INTO fee_profiles (
           id, account_id, name, commission_rate_bps, commission_discount_bps,
           minimum_commission_amount, commission_rounding_mode, tax_rounding_mode,
           stock_sell_tax_rate_bps, stock_day_trade_tax_rate_bps, etf_sell_tax_rate_bps,
           bond_etf_sell_tax_rate_bps
         ) VALUES (
           $1, $2, 'Default Broker', 14, 7200,
           20, 'FLOOR', 'FLOOR',
           30, 15, 10,
           0
         )
         ON CONFLICT (id) DO NOTHING`,
        [feeProfileId, input.accountId],
      );
      await seedClient.query("COMMIT");
    } catch (err) {
      await seedClient.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      seedClient.release();
    }

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
         id, user_id, account_id, ticker, instrument_type, trade_type, quantity, unit_price,
         price_currency, trade_date, trade_timestamp, booking_sequence, commission_amount,
         tax_amount, is_day_trade, fee_policy_snapshot_id, source, source_reference, booked_at,
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
        input.ticker,
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
        input.source ?? "manual",
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

  it("ignores blank legacy migration checksums when verifying applied migrations", async () => {
    const manifest = await migrationManifestPromise;

    persistence = new PostgresPersistence({
      databaseUrl: databaseUrl!,
      redisUrl: redisUrl!,
    });
    await persistence.init();
    await persistence.close();
    persistence = null;

    await pool.query(
      "UPDATE schema_migrations SET checksum = '' WHERE name = $1",
      ["083_market_calendar_activity_legacy_source_nullable.sql"],
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

  it("bootstraps clean databases from the baseline schema and records superseded history", async () => {
    const manifest = await migrationManifestPromise;
    await resetDatabase();

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
    await resetDatabase();
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
    await resetDatabase();
    await applyBaselineMigration();
    await applyMigrationFiles(
      manifest.numberedMigrations.filter((name) => !manifest.baselineSupersedes.includes(name)),
    );

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
    const pre010Migrations = await getNumberedMigrationsBefore(
      "010_trade_snapshot_recompute_normalization.sql",
    );
    await resetDatabase();
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
    const pre010Migrations = await getNumberedMigrationsBefore(
      "010_trade_snapshot_recompute_normalization.sql",
    );
    await resetDatabase();
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

  it("migration 030 rejects duplicate lowercase emails", async () => {
    // beforeEach seeded legacy users via 001 — reset to a clean slate and apply only up to 029.
    const pre030 = await getNumberedMigrationsBefore("030_kzo143_auth_foundations.sql");
    await resetDatabase();
    await applyMigrationFiles(pre030);

    // Seed two users whose emails collide only after lowercasing.
    // Explicitly list all NOT NULL columns present after migrations through 029:
    //   locale, cost_basis_method, quote_poll_interval_seconds — defaults exist but explicit is clear
    //   is_demo — added in migration 015 with DEFAULT false
    await pool.query(
      `INSERT INTO users (id, email, locale, cost_basis_method, quote_poll_interval_seconds, is_demo)
       VALUES
         ('u1', 'Foo@example.com', 'en', 'WEIGHTED_AVERAGE', 10, false),
         ('u2', 'foo@example.com', 'en', 'WEIGHTED_AVERAGE', 10, false)`,
    );

    // Migration 030's DO $$ guard detects the collision and RAISE EXCEPTIONs.
    // The subsequent DDL (ALTER TABLE, CREATE TABLE, DROP INDEX, etc.) never executes.
    await expect(
      applyMigrationFiles(["030_kzo143_auth_foundations.sql"]),
    ).rejects.toThrow(/KZO-143 migration aborted: duplicate lowercase emails require manual cleanup/);

    // Positive assertions — pre-030 state is preserved (effective rollback of the DO $$ statement):
    const emails = await pool.query<{ email: string }>("SELECT email FROM users ORDER BY id");
    expect(emails.rows).toEqual([
      { email: "Foo@example.com" },
      { email: "foo@example.com" },
    ]);

    const uxIdx = await pool.query(
      "SELECT indexname FROM pg_indexes WHERE tablename = 'users' AND indexname = 'ux_users_email'",
    );
    expect(uxIdx.rows).toHaveLength(1);

    // Negative assertions — post-030 artifacts must be absent:
    const roleCol = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'role'`,
    );
    expect(roleCol.rows).toHaveLength(0);

    const lowerIdx = await pool.query(
      "SELECT indexname FROM pg_indexes WHERE indexname = 'ux_users_email_lower'",
    );
    expect(lowerIdx.rows).toHaveLength(0);

    const invitesTable = await pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'invites'`,
    );
    expect(invitesTable.rows).toHaveLength(0);

    const auditTable = await pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'audit_log'`,
    );
    expect(auditTable.rows).toHaveLength(0);
  });

  it("keeps the baseline schema in parity with the numbered upgrade path", async () => {
    await resetDatabase();

    persistence = new PostgresPersistence({
      databaseUrl: databaseUrl!,
      redisUrl: redisUrl!,
    });
    await persistence.init();
    await persistence.close();
    persistence = null;

    await expectDefaultMarketCalendarSources();
    await expectMarketCalendarActivitySchema();
    const baselineSignature = await captureSchemaSignature();

    await resetDatabase();
    await applyNumberedMigrations();

    await expectDefaultMarketCalendarSources();
    await expectMarketCalendarActivitySchema();
    const upgradedSignature = await captureSchemaSignature();
    expect(baselineSignature).toEqual(upgradedSignature);
  }, 15_000);

  it("converts legacy full-year market calendar rows into exception-only records", async () => {
    await resetDatabase();
    await applyMigrationFiles(await getNumberedMigrationsBefore("082_market_calendar_activity_schema_reconcile.sql"));

    const legacyRows = [
      { date: "2026-01-01", isOpen: false, name: "New Year", source: "legacy-calendar" },
      { date: "2026-01-02", isOpen: true, name: "Regular trading", source: "legacy-calendar" },
      { date: "2026-01-03", isOpen: true, name: "Special Saturday session", source: "legacy-calendar" },
      { date: "2026-01-04", isOpen: false, name: "Regular weekend", source: "legacy-calendar" },
    ];

    await pool.query(`ALTER TABLE market_data.market_calendar_previews ADD COLUMN IF NOT EXISTS rows JSONB`);
    await pool.query(`ALTER TABLE market_data.market_calendar_versions ADD COLUMN IF NOT EXISTS rows JSONB`);
    await pool.query(
      `INSERT INTO market_data.market_calendar_previews (
         preview_token, import_operation_id, market_code, calendar_year, source_type,
         retrieved_at, rows, exceptions
       ) VALUES (
         'legacy-preview-082', 'legacy-import-082', 'TW', 2026, 'official_source',
         TIMESTAMPTZ '2026-01-01 00:00:00Z', $1::jsonb, '[]'::jsonb
       )`,
      [JSON.stringify(legacyRows)],
    );
    await pool.query(
      `INSERT INTO market_data.market_calendar_versions (
         version_id, import_operation_id, market_code, calendar_year, source_type,
         retrieved_at, confirmed_at, status, is_active, rows, exceptions
       ) VALUES (
         'legacy-version-082', 'legacy-import-082', 'TW', 2026, 'official_source',
         TIMESTAMPTZ '2026-01-01 00:00:00Z', TIMESTAMPTZ '2026-01-01 00:00:00Z',
         'confirmed', TRUE, $1::jsonb, '[]'::jsonb
       )`,
      [JSON.stringify(legacyRows)],
    );
    await pool.query(
      `INSERT INTO market_data.market_calendar_versions (
         version_id, import_operation_id, market_code, calendar_year, source_type,
         retrieved_at, confirmed_at, status, is_active, exceptions
       ) VALUES (
         'legacy-version-084', 'legacy-import-084', 'US', 2026, 'official_source',
         TIMESTAMPTZ '2026-01-01 00:00:00Z', TIMESTAMPTZ '2026-01-01 00:00:00Z',
         'confirmed', TRUE, $1::jsonb
       )`,
      [JSON.stringify(legacyRows)],
    );

    await applyMigrationFiles([
      "082_market_calendar_activity_schema_reconcile.sql",
      "083_market_calendar_activity_legacy_source_nullable.sql",
      "084_market_calendar_legacy_exception_rows_repair.sql",
    ]);

    const versions = await pool.query<{
      version_id: string;
      exceptions: unknown;
      annual_counts: unknown;
    }>(
      `SELECT version_id, exceptions, annual_counts
         FROM market_data.market_calendar_versions
        WHERE version_id IN ('legacy-version-082', 'legacy-version-084')
        ORDER BY version_id`,
    );
    expect(versions.rows).toHaveLength(2);
    for (const row of versions.rows) {
      expect(row.exceptions).toEqual([
        {
          date: "2026-01-01",
          status: "closed",
          name: "New Year",
          evidence: "legacy-calendar",
          overrideReason: "Migrated from legacy full-year calendar rows",
        },
        {
          date: "2026-01-03",
          status: "open",
          name: "Special Saturday session",
          evidence: "legacy-calendar",
          overrideReason: "Migrated from legacy full-year calendar rows",
        },
      ]);
      expect(row.annual_counts).toEqual({
        tradingDayCount: 2,
        nonTradingDayCount: 2,
        weekdayClosedCount: 1,
        weekendOpenCount: 1,
      });
    }

    const preview = await pool.query<{
      exceptions: unknown;
      annual_counts: unknown;
    }>(
      `SELECT exceptions, annual_counts
         FROM market_data.market_calendar_previews
        WHERE preview_token = 'legacy-preview-082'`,
    );
    expect(preview.rows[0]?.exceptions).toEqual(versions.rows[0]?.exceptions);
    expect(preview.rows[0]?.annual_counts).toEqual(versions.rows[0]?.annual_counts);
  });

  it("backfills normalized fee profile tax rules, snapshot tax components, and market codes in migration 011", async () => {
    await applyMigrationFiles([
      "002_cost_basis_weighted_average.sql",
      "003_accounting_core_schema.sql",
      "004_trade_order_and_lot_allocations.sql",
      "005_booking_order_uniqueness.sql",
      "006_dividend_schema_alignment.sql",
      "007_fee_profile_precision_and_dividend_currency.sql",
      "008_commission_discount_percent.sql",
      "009_retire_twd_ntd_fields.sql",
      "010_trade_snapshot_recompute_normalization.sql",
    ]);

    await pool.query(
      `INSERT INTO users (id, email, locale, cost_basis_method, quote_poll_interval_seconds)
       VALUES ('user-1', 'user-1@example.com', 'en', 'WEIGHTED_AVERAGE', 10)`,
    );
    await pool.query(
      `INSERT INTO fee_profiles (
         id, user_id, name, commission_rate_bps, board_commission_rate, commission_discount_percent, commission_discount_bps,
         minimum_commission_amount, commission_currency, commission_rounding_mode, tax_rounding_mode,
         stock_sell_tax_rate_bps, stock_day_trade_tax_rate_bps, etf_sell_tax_rate_bps, bond_etf_sell_tax_rate_bps,
         commission_charge_mode
       ) VALUES (
         'fp-011', 'user-1', 'Migration Profile', 14, 1.425, 28, 7200,
         20, 'TWD', 'FLOOR', 'FLOOR',
         30, 15, 10, 0,
         'CHARGED_UPFRONT'
       )`,
    );
    await pool.query(
      `INSERT INTO accounts (id, user_id, name, fee_profile_id)
       VALUES ('acc-011', 'user-1', 'Main', 'fp-011')`,
    );
    await pool.query(
      `INSERT INTO account_fee_profile_overrides (account_id, symbol, fee_profile_id)
       VALUES ('acc-011', '2330', 'fp-011')`,
    );
    await pool.query(
      `INSERT INTO symbols (ticker, instrument_type)
       VALUES ('2330', 'STOCK')`,
    );
    await pool.query(
      `INSERT INTO trade_fee_policy_snapshots (
         id, user_id, profile_id_at_booking, profile_name_at_booking, board_commission_rate,
         commission_discount_percent, minimum_commission_amount, commission_currency,
         commission_rounding_mode, tax_rounding_mode, stock_sell_tax_rate_bps,
         stock_day_trade_tax_rate_bps, etf_sell_tax_rate_bps, bond_etf_sell_tax_rate_bps,
         commission_charge_mode, booked_at
       ) VALUES (
         'trade-fee-snapshot:trade-011', 'user-1', 'fp-011', 'Migration Profile', 1.425,
         28, 20, 'TWD',
         'FLOOR', 'FLOOR', 30,
         15, 10, 0,
         'CHARGED_UPFRONT', TIMESTAMP '2026-03-01 09:00:00'
       )`,
    );
    await pool.query(
      `INSERT INTO trade_events (
         id, user_id, account_id, symbol, instrument_type, trade_type, quantity, unit_price,
         price_currency, trade_date, trade_timestamp, booking_sequence, commission_amount,
         tax_amount, is_day_trade, fee_policy_snapshot_id, source_type, source_reference, booked_at
       ) VALUES (
         'trade-011', 'user-1', 'acc-011', '2330', 'STOCK', 'SELL', 10, 1000,
         'TWD', DATE '2026-03-01', TIMESTAMP '2026-03-01 09:00:00', 1, 20,
         300, false, 'trade-fee-snapshot:trade-011', 'manual', 'trade-011', TIMESTAMP '2026-03-01 09:00:00'
       )`,
    );

    await applyMigrationFiles([
      "011_fee_profile_tax_rule_normalization.sql",
      "012_market_code_on_symbols_bindings_and_trades.sql",
    ]);

    const [taxRules, taxComponents, marketCodes] = await Promise.all([
      pool.query<{
        instrument_type: string;
        day_trade_scope: string;
        rate_bps: number;
      }>(
        `SELECT instrument_type, day_trade_scope, rate_bps
         FROM fee_profile_tax_rules
         WHERE fee_profile_id = 'fp-011'
         ORDER BY sort_order`,
      ),
      pool.query<{
        market_code: string;
        instrument_type: string;
        day_trade_scope: string;
        rate_bps: number;
        booked_tax_amount: number;
      }>(
        `SELECT market_code, instrument_type, day_trade_scope, rate_bps, booked_tax_amount
         FROM trade_fee_policy_snapshot_tax_components
         WHERE snapshot_id = 'trade-fee-snapshot:trade-011'
         ORDER BY sort_order`,
      ),
      pool.query<{
        trade_market_code: string;
        symbol_market_code: string;
        binding_market_code: string;
      }>(
        `SELECT
           (SELECT market_code FROM trade_events WHERE id = 'trade-011') AS trade_market_code,
           (SELECT market_code FROM symbols WHERE ticker = '2330') AS symbol_market_code,
           (SELECT market_code FROM account_fee_profile_overrides WHERE account_id = 'acc-011' AND symbol = '2330') AS binding_market_code`,
      ),
    ]);

    expect(taxRules.rows).toEqual([
      { instrument_type: "STOCK", day_trade_scope: "NON_DAY_TRADE_ONLY", rate_bps: 30 },
      { instrument_type: "STOCK", day_trade_scope: "DAY_TRADE_ONLY", rate_bps: 15 },
      { instrument_type: "ETF", day_trade_scope: "ANY", rate_bps: 10 },
      { instrument_type: "BOND_ETF", day_trade_scope: "ANY", rate_bps: 0 },
    ]);
    expect(taxComponents.rows).toEqual([
      {
        market_code: "TW",
        instrument_type: "STOCK",
        day_trade_scope: "NON_DAY_TRADE_ONLY",
        rate_bps: 30,
        booked_tax_amount: 300,
      },
    ]);
    expect(marketCodes.rows).toEqual([
      {
        trade_market_code: "TW",
        symbol_market_code: "TW",
        binding_market_code: "TW",
      },
    ]);
  });

  it("normalizes legacy duplicate booking and lot sequences before adding uniqueness indexes", { timeout: 30_000 }, async () => {
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
         AND ticker = '2330'
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

  // KZO-183: bump to 30s — migration 042 adds 200+ lines (pre-flight CHECKs, fan-out
  // backfill, function/trigger creation) which can push a cold init() past the
  // default 5s vitest timeout under host load.
  it("applies accounting schema objects including dividend alignment", { timeout: 30_000 }, async () => {
    persistence = new PostgresPersistence({
      databaseUrl: databaseUrl!,
      redisUrl: redisUrl!,
    });
    await persistence.init();

    const expectedTables = [
      "fee_profile_tax_rules",
      "trade_events",
      "trade_fee_policy_snapshot_tax_components",
      "lot_allocations",
      "cash_ledger_entries",
      "dividend_ledger_entries",
      "dividend_deduction_entries",
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
      "idx_fee_profile_tax_rules_fee_profile_id",
      "idx_trade_fee_policy_snapshot_tax_components_snapshot_id",
      "idx_trade_events_account_ticker_trade_date",
      "idx_trade_events_account_ticker_booking_order",
      "ux_fee_profile_tax_rules_identity",
      "ux_trade_fee_policy_snapshot_tax_components_snapshot_order",
      "ux_trade_events_account_trade_date_booking_sequence",
      "ux_trade_events_account_source_reference",
      "ux_trade_events_reversal_of_trade_event_id",
      "idx_lot_allocations_trade_event_id",
      "ux_lots_account_ticker_opened_order",
      "ux_lot_allocations_trade_event_lot",
      "idx_cash_ledger_entries_account_entry_date",
      "ux_cash_ledger_entries_account_source_reference",
      "ux_cash_ledger_entries_reversal_of_cash_ledger_entry_id",
      "idx_dividend_ledger_entries_dividend_event_id",
      "ux_dividend_ledger_entries_reversal_of_dividend_ledger_entry_id",
      "idx_dividend_deduction_entries_dividend_ledger_entry_id",
      "ux_dividend_ledger_entries_active_account_event",
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
    expect(hasConstraint("trade_events", "market_code ~ '^[A-Z]{2,10}$'")).toBe(true);
    expect(hasConstraint("fee_profile_tax_rules", "trade_side = 'SELL'::text")).toBe(true);
    expect(hasConstraint("trade_fee_policy_snapshot_tax_components", "trade_side = 'SELL'::text")).toBe(true);

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
        "FOREIGN KEY (dividend_event_id) REFERENCES market_data.dividend_events(id)",
      ),
    ).toBe(true);
    expect(hasConstraint("dividend_ledger_entries", "posting_status = ANY")).toBe(true);
    expect(
      hasConstraint(
        "dividend_deduction_entries",
        "FOREIGN KEY (dividend_ledger_entry_id) REFERENCES dividend_ledger_entries(id)",
      ),
    ).toBe(true);
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
      ticker: "2330",
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
        `INSERT INTO market_data.dividend_events (
           id, ticker, event_type, ex_dividend_date, payment_date,
           cash_dividend_per_share, cash_dividend_currency, stock_dividend_per_share,
           source, source_reference
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
           related_trade_event_id, source, source_reference
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
           related_trade_event_id, source, source_reference
         ) VALUES (
           'cash-invalid-link', $1, $2, DATE '2026-03-02', 'DIVIDEND_RECEIPT', 100, 'TWD',
           'trade-base', 'manual', 'cash-invalid-link'
         )`,
        [userId, accountId],
      ),
    ).rejects.toThrow(/check constraint/i);

    await pool.query(
      `INSERT INTO market_data.dividend_events (
         id, ticker, event_type, ex_dividend_date, payment_date,
         cash_dividend_per_share, cash_dividend_currency, stock_dividend_per_share,
         source, source_reference
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
           withheld_at_source, source, source_reference
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
         withheld_at_source, source, source_reference
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
      ticker: "2330",
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
        ticker: "2330",
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
        ticker: "2330",
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
         id, account_id, ticker, open_quantity, total_cost_amount, cost_currency, opened_at, opened_sequence
       ) VALUES (
         'lot-base', $1, '2330', 100, 60000, 'TWD', DATE '2026-03-01', 1
       )`,
      [accountId],
    );

    await expect(
      pool.query(
        `INSERT INTO lots (
           id, account_id, ticker, open_quantity, total_cost_amount, cost_currency, opened_at, opened_sequence
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
        ticker: "2330",
        // KZO-169: required on BookedTradeEvent.
        marketCode: "TW",
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
        source: "test",
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
        source: "test",
        sourceReference: "cash-kzo48-1",
        bookedAt: "2026-03-01T09:00:01.000Z",
      },
    ];
    store.accounting.projections.lots = [
      {
        id: "lot-kzo46-1",
        accountId: "user-1-acc-1",
        ticker: "2330",
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
        ticker: "2330",
        lotId: "lot-kzo46-1",
        lotOpenedAt: "2026-03-01",
        lotOpenedSequence: 1,
        allocatedQuantity: 10,
        allocatedCostAmount: 1020,
        costCurrency: "TWD",
        createdAt: "2026-03-01T09:00:02.000Z",
      },
    ];
    // daily_portfolio_snapshots is no longer written by saveStore (replaced by daily_holding_snapshots).
    // The table still exists in the schema but saveStore/loadStore skip it.

    await persistence.saveStore(store);

    const tradeEvents = await pool.query<{ id: string; source: string; booking_sequence: number }>(
      `SELECT id, source, booking_sequence
       FROM trade_events
       WHERE user_id = 'user-1'
       ORDER BY id`,
    );
    expect(tradeEvents.rows).toEqual([{ id: "trade-kzo48-1", source: "test", booking_sequence: 1 }]);

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
      `SELECT id, amount::float AS amount, related_trade_event_id
       FROM cash_ledger_entries
       WHERE user_id = 'user-1'
       ORDER BY id`,
    );
    expect(cashEntries.rows).toEqual([
      { id: "cash-kzo48-1", amount: -1020, related_trade_event_id: "trade-kzo48-1" },
    ]);

    // daily_portfolio_snapshots no longer written by saveStore — table is empty.
    const snapshots = await pool.query<{ id: string }>(
      `SELECT id FROM daily_portfolio_snapshots WHERE user_id = 'user-1'`,
    );
    expect(snapshots.rows).toEqual([]);

    const reloaded = await persistence.loadStore("user-1");
    expect(reloaded.accounting.facts.tradeEvents).toEqual([
      expect.objectContaining({
        id: "trade-kzo48-1",
        source: "test",
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
    // loadStore no longer reads daily_portfolio_snapshots — always returns [].
    expect(reloaded.accounting.projections.dailyPortfolioSnapshots).toEqual([]);

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
    // KZO-183: each account must own its own fee profile (composite-FK ownership
    // invariant). Add a new fee profile pinned to acc-2 instead of reusing acc-1's.
    // Strip taxRules from the source spread — those rule ids would collide with
    // the original profile's tax-rule rows under fee_profile_tax_rules_pkey.
    const acc2ProfileId = "user-1-acc-2-fp-default";
    const sourceProfile = { ...store.feeProfiles[0]! };
    delete sourceProfile.taxRules;
    store.feeProfiles.push({
      ...sourceProfile,
      id: acc2ProfileId,
      accountId: "user-1-acc-2",
      name: "Dividend Default",
    });
    store.accounts.push({
      id: "user-1-acc-2",
      userId: "user-1",
      name: "Dividend",
      feeProfileId: acc2ProfileId,
      // KZO-167: AccountDto requires defaultCurrency + accountType.
      defaultCurrency: "TWD",
      accountType: "broker",
    });
    store.marketData.dividendEvents = [
      {
        id: "dividend-event-kzo34-1",
        ticker: "0056",
        eventType: "CASH",
        exDividendDate: "2026-07-15",
        paymentDate: "2026-08-10",
        cashDividendPerShare: 1.2,
        cashDividendCurrency: "TWD",
        stockDividendPerShare: 0,
        source: "manual",
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
        version: 1,
        sourceCompositionStatus: "provided",
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
        version: 1,
        sourceCompositionStatus: "provided",
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
        source: "broker_statement",
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
        source: "broker_statement",
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
        source: "dividend_posting",
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
        source: "dividend_posting",
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
      source: string;
    }>(
      `SELECT id, event_type, cash_dividend_per_share::text AS cash_dividend_per_share, source
       FROM market_data.dividend_events
       ORDER BY id`,
    );
    expect(dividendEvents.rows).toEqual([
      {
        id: "dividend-event-kzo34-1",
        event_type: "CASH",
        cash_dividend_per_share: "1.200000",
        source: "manual",
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
      `SELECT id, related_dividend_ledger_entry_id, entry_type, amount::float AS amount
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
    expect(reloaded.marketData.dividendEvents).toEqual([
      expect.objectContaining({
        id: "dividend-event-kzo34-1",
        eventType: "CASH",
        cashDividendPerShare: 1.2,
        source: "manual",
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
    store.marketData.dividendEvents = [
      {
        id: "dividend-event-kzo34-duplicate",
        ticker: "0056",
        eventType: "CASH",
        exDividendDate: "2026-07-15",
        paymentDate: "2026-08-10",
        cashDividendPerShare: 1.2,
        cashDividendCurrency: "TWD",
        stockDividendPerShare: 0,
        source: "manual",
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
        version: 1,
        sourceCompositionStatus: "provided",
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
        version: 1,
        sourceCompositionStatus: "provided",
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
        ticker: "2330",
        marketCode: "TW",
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
        source: "test",
        sourceReference: "trade-kzo46-dupe-1",
        bookedAt: "2026-03-01T09:00:00.000Z",
      },
      {
        id: "trade-kzo46-dupe-2",
        userId: "user-1",
        accountId: "user-1-acc-1",
        ticker: "2330",
        marketCode: "TW",
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
        source: "test",
        sourceReference: "trade-kzo46-dupe-2",
        bookedAt: "2026-03-01T09:00:01.000Z",
      },
    ];
    store.accounting.projections.lots = [
      {
        id: "lot-kzo46-dupe-1",
        accountId: "user-1-acc-1",
        ticker: "2330",
        openQuantity: 10,
        totalCostAmount: 1000,
        costCurrency: "TWD",
        openedAt: "2026-03-01",
        openedSequence: 1,
      },
      {
        id: "lot-kzo46-dupe-2",
        accountId: "user-1-acc-1",
        ticker: "2330",
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
      `INSERT INTO users (id, email, locale, cost_basis_method, quote_poll_interval_seconds)
       VALUES ('user-1', 'user-1@example.com', 'en', 'WEIGHTED_AVERAGE', 10)
       ON CONFLICT (id) DO NOTHING`,
    );

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
      ticker: "2330",
      marketCode: "TW",
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
      source: string;
      source_reference: string | null;
      booking_sequence: number;
      commission_amount: number;
      tax_amount: number;
    }>(
      `SELECT id, source, source_reference, booking_sequence, commission_amount, tax_amount
       FROM trade_events
       WHERE user_id = 'user-1'
       ORDER BY id`,
    );
    expect(tradeEvents.rows).toEqual([
      {
        id: createdTrade.id,
        source: "portfolio_transaction_api",
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
      source: string;
    }>(
      `SELECT related_trade_event_id, entry_type, amount::float AS amount, source
       FROM cash_ledger_entries
       WHERE user_id = 'user-1'
       ORDER BY id`,
    );
    expect(cashEntries.rows).toEqual([
      {
        related_trade_event_id: createdTrade.id,
        entry_type: "TRADE_SETTLEMENT_OUT",
        amount: -(10 * 100 + 7 + 3),
        source: "trade_settlement",
      },
    ]);

    const lots = await pool.query<{
      ticker: string;
      open_quantity: number;
      total_cost_amount: number;
      opened_sequence: number;
    }>(
      `SELECT ticker, open_quantity, total_cost_amount::float AS total_cost_amount, opened_sequence
       FROM lots
       WHERE account_id = 'user-1-acc-1'
       ORDER BY id`,
    );
    expect(lots.rows).toEqual([
      {
        ticker: "2330",
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
      ticker: "2330",
      marketCode: "TW",
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
      ticker: "2330",
      marketCode: "TW",
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
      `SELECT trade_event_id, allocated_quantity, allocated_cost_amount::float AS allocated_cost_amount, lot_opened_sequence
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
      `SELECT related_trade_event_id, entry_type, amount::float AS amount
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

    const snapshotTaxComponents = await pool.query<{
      snapshot_id: string;
      market_code: string;
      instrument_type: string;
      day_trade_scope: string;
      rate_bps: number;
      booked_tax_amount: number;
    }>(
      `SELECT snapshot_id, market_code, instrument_type, day_trade_scope, rate_bps, booked_tax_amount
       FROM trade_fee_policy_snapshot_tax_components
       WHERE snapshot_id = $1
       ORDER BY sort_order`,
      [`trade-fee-snapshot:${sellTrade.id}`],
    );
    expect(snapshotTaxComponents.rows).toEqual([
      {
        snapshot_id: `trade-fee-snapshot:${sellTrade.id}`,
        market_code: "TW",
        instrument_type: "STOCK",
        day_trade_scope: "NON_DAY_TRADE_ONLY",
        rate_bps: 30,
        booked_tax_amount: 13,
      },
    ]);

    const reloaded = await persistence.loadStore("user-1");
    expect(reloaded.accounting.projections.holdings).toEqual([
      expect.objectContaining({
        accountId: "user-1-acc-1",
        ticker: "2330",
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
      ticker: "2330",
      marketCode: "TW",
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
      ticker: "2330",
      eventType: "CASH_AND_STOCK",
      exDividendDate: "2026-02-01",
      paymentDate: "2026-02-20",
      cashDividendPerShare: 12,
      cashDividendCurrency: "TWD",
      stockDividendPerShare: 0.1,
      source: "manual_dividend_event",
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
          source: "dividend_posting",
          sourceReference: "dividend-deduction-kzo36",
        },
      ],
    });
    await persistence.savePostedDividend("user-1", store.accounting, store.marketData, posting.dividendLedgerEntry.id);

    const dividendEvents = await pool.query<{
      id: string;
      event_type: string;
      cash_dividend_per_share: string;
      stock_dividend_per_share: string;
    }>(
      `SELECT id, event_type, cash_dividend_per_share, stock_dividend_per_share
       FROM market_data.dividend_events
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
      `SELECT deduction_type, amount::float AS amount, currency_code
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
      `SELECT entry_type, amount::float AS amount, related_dividend_ledger_entry_id
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
        ticker: "2330",
        quantity: 11,
        costBasisAmount: 1000,
      }),
    ]);
  }, 15_000);

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
      ticker: "2330",
      marketCode: "TW",
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
      ticker: "2330",
      eventType: "CASH",
      exDividendDate: "2026-02-01",
      paymentDate: "2026-02-20",
      cashDividendPerShare: 12,
      cashDividendCurrency: "TWD",
      stockDividendPerShare: 0,
      source: "manual_dividend_event",
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
          source: "dividend_posting",
          sourceReference: "dividend-deduction-kzo51",
        },
      ],
    });
    await persistence.savePostedDividend("user-1", store.accounting, store.marketData, posting.dividendLedgerEntry.id);

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
      persistence.savePostedDividend("user-1", overwrittenAccounting, store.marketData, posting.dividendLedgerEntry.id),
    ).rejects.toThrow(/cannot be overwritten in place/i);

    const persistedDividendLedgerEntries = await pool.query<{ received_stock_quantity: number; posting_status: string }>(
      `SELECT received_stock_quantity, posting_status
       FROM dividend_ledger_entries
       WHERE id = 'dividend-ledger-kzo51'`,
    );
    expect(persistedDividendLedgerEntries.rows).toEqual([{ received_stock_quantity: 0, posting_status: "posted" }]);

    const persistedCashEntries = await pool.query<{ amount: number }>(
      `SELECT amount::float AS amount
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
      ticker: "2330",
      marketCode: "TW",
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
      ticker: "2330",
      marketCode: "TW",
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
  }, 15_000);

  // ── KZO-165 — migration 038 walk ─────────────────────────────────────────
  // Migration 038 adds per-currency native columns + provider_source to
  // daily_holding_snapshots, tightens the `currency` column to CHAR(3)
  // with an ISO CHECK, and creates the new currency_wallet_snapshots table.
  // This case verifies the migration walks cleanly via the manifest path
  // and that all post-migration schema artifacts are present.
  it("KZO-165: migration 038 walk — adds native columns, ISO CHECK, and currency_wallet_snapshots", async () => {
    // Reset to wipe the legacy-users seed from beforeEach so the full
    // migration chain runs clean from 001 forward (mirrors the
    // "keeps the baseline schema in parity" pattern).
    await resetDatabase();
    await applyNumberedMigrations();

    // 1. New columns on daily_holding_snapshots
    const newCols = await pool.query<{ column_name: string; data_type: string; is_nullable: string }>(
      `SELECT column_name, data_type, is_nullable
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'daily_holding_snapshots'
         AND column_name IN ('value_native', 'cost_basis_native', 'unrealized_pnl_native', 'provider_source')
       ORDER BY column_name`,
    );
    const colNames = newCols.rows.map((r) => r.column_name);
    expect(colNames).toContain("value_native");
    expect(colNames).toContain("cost_basis_native");
    expect(colNames).toContain("unrealized_pnl_native");
    expect(colNames).toContain("provider_source");

    // 2. currency column tightened to CHAR(3) with ISO CHECK constraint
    const currencyCol = await pool.query<{ data_type: string; character_maximum_length: number | null; column_default: string | null }>(
      `SELECT data_type, character_maximum_length, column_default
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'daily_holding_snapshots'
         AND column_name = 'currency'`,
    );
    expect(currencyCol.rows).toHaveLength(1);
    expect(currencyCol.rows[0].character_maximum_length).toBe(3);
    // DEFAULT 'TWD' was dropped per D2.
    expect(currencyCol.rows[0].column_default).toBeNull();

    // 3. ISO CHECK constraint on daily_holding_snapshots.currency
    const isoCheck = await pool.query<{ conname: string; def: string }>(
      `SELECT conname, pg_get_constraintdef(oid) AS def
       FROM pg_constraint
       WHERE conrelid = 'public.daily_holding_snapshots'::regclass
         AND contype = 'c'
         AND pg_get_constraintdef(oid) LIKE '%[A-Z]{3}%'`,
    );
    expect(isoCheck.rows.length).toBeGreaterThanOrEqual(1);

    // 4. currency_wallet_snapshots table exists with composite PK and ISO CHECK
    const walletTable = await pool.query<{ table_name: string }>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'currency_wallet_snapshots'`,
    );
    expect(walletTable.rows).toHaveLength(1);

    const walletCols = await pool.query<{ column_name: string; is_nullable: string }>(
      `SELECT column_name, is_nullable
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'currency_wallet_snapshots'
       ORDER BY column_name`,
    );
    const walletColNames = walletCols.rows.map((r) => r.column_name);
    for (const expected of [
      "user_id", "account_id", "currency", "date",
      "balance_native", "wac_fx_to_usd", "realized_fx_pnl_lifetime",
      "provider_source", "generated_at", "generation_run_id",
    ]) {
      expect(walletColNames).toContain(expected);
    }

    // 5. Secondary index per D8: idx_currency_wallet_snapshots_user_date
    const idx = await pool.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
       WHERE schemaname = 'public'
         AND tablename = 'currency_wallet_snapshots'
         AND indexname = 'idx_currency_wallet_snapshots_user_date'`,
    );
    expect(idx.rows).toHaveLength(1);

    // 6. Composite FK (account_id, user_id) → accounts(id, user_id) per D7
    const fkResult = await pool.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def
       FROM pg_constraint
       WHERE conrelid = 'public.currency_wallet_snapshots'::regclass
         AND contype = 'f'`,
    );
    const fkDefs = fkResult.rows.map((r) => r.def);
    // At least one FK should reference accounts(id, user_id) or accounts(id,
    // user_id) — accept either composite-style ordering.
    const hasComposite = fkDefs.some((d) =>
      /accounts\((id, ?user_id|user_id, ?id)\)/.test(d),
    );
    expect(hasComposite).toBe(true);
  });

  // ── 039: cash_ledger_entries.fx_rate_to_usd column + CHECK ────────────────

  it("migration 039: cash_ledger_entries.fx_rate_to_usd column exists with correct precision and CHECK constraint", async () => {
    await resetDatabase();
    await applyNumberedMigrations();

    // 1. Column exists, is nullable, numeric(20,8)
    const col = await pool.query<{
      column_name: string;
      data_type: string;
      numeric_precision: number;
      numeric_scale: number;
      is_nullable: string;
    }>(
      `SELECT column_name, data_type, numeric_precision, numeric_scale, is_nullable
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'cash_ledger_entries'
         AND column_name = 'fx_rate_to_usd'`,
    );
    expect(col.rows).toHaveLength(1);
    expect(col.rows[0].data_type).toBe("numeric");
    expect(col.rows[0].numeric_precision).toBe(20);
    expect(col.rows[0].numeric_scale).toBe(8);
    expect(col.rows[0].is_nullable).toBe("YES");

    // 2. CHECK constraint exists
    const ck = await pool.query<{ conname: string }>(
      `SELECT conname FROM pg_constraint
       WHERE conname = 'ck_cash_ledger_fx_rate_positive'
         AND conrelid = 'cash_ledger_entries'::regclass`,
    );
    expect(ck.rows).toHaveLength(1);

    // Seed a user + account + fee profile to satisfy FKs on cash_ledger_entries.
    await pool.query(`
      INSERT INTO users (id, email, locale, cost_basis_method, quote_poll_interval_seconds)
      VALUES ('mig039-u', 'mig039@example.com', 'en', 'WEIGHTED_AVERAGE', 10)
    `);
    await seedAccountWithFeeProfilePost042({
      userId: "mig039-u",
      accountId: "mig039-acc",
      accountName: "Main",
      feeProfileId: "mig039-fp",
    });

    // Helper to insert a cash_ledger_entries row with a given fx_rate_to_usd.
    const insertCash = async (id: string, fx: string | null): Promise<void> => {
      await pool.query(
        `INSERT INTO cash_ledger_entries (
           id, user_id, account_id, entry_date, entry_type, amount, currency,
           source, source_reference, booked_at, fx_rate_to_usd
         ) VALUES (
           $1, 'mig039-u', 'mig039-acc', '2025-01-02', 'MANUAL_ADJUSTMENT',
           100, 'TWD', 'mig039_test', $1, NOW(), $2
         )`,
        [id, fx],
      );
    };

    // 3. fx_rate_to_usd = 0 → rejected
    await expect(insertCash("mig039-r1", "0")).rejects.toThrow();

    // 4. fx_rate_to_usd = -1 → rejected
    await expect(insertCash("mig039-r2", "-1")).rejects.toThrow();

    // 5. fx_rate_to_usd = 0.0001 → accepted
    await expect(insertCash("mig039-ok1", "0.0001")).resolves.not.toThrow();

    // 6. fx_rate_to_usd = NULL → accepted
    await expect(insertCash("mig039-ok2", null)).resolves.not.toThrow();
  });

  // ── KZO-167 — migration 040 walk ─────────────────────────────────────────
  // Migration 040 adds two columns to the `accounts` table:
  //   default_currency CHAR(3) NOT NULL DEFAULT 'TWD'
  //   account_type     TEXT    NOT NULL DEFAULT 'broker'
  // Both have CHECK constraints mirroring the DO $$ guard pattern from 039.
  // This case verifies clean walk via the manifest path and all post-migration
  // schema artifacts.

  it("KZO-167: migration 040 walk — accounts.default_currency and accounts.account_type columns with defaults and CHECK constraints", async () => {
    await resetDatabase();
    await applyNumberedMigrations();

    // ── 1. default_currency column existence, type, NOT NULL, DEFAULT ─────────

    const currencyCol = await pool.query<{
      column_name: string;
      data_type: string;
      character_maximum_length: number | null;
      is_nullable: string;
      column_default: string | null;
    }>(
      `SELECT column_name, data_type, character_maximum_length, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'accounts'
         AND column_name = 'default_currency'`,
    );
    expect(currencyCol.rows).toHaveLength(1);
    // CHAR(3) → Postgres reports 'character' with max_length 3
    expect(currencyCol.rows[0].data_type).toBe("character");
    expect(currencyCol.rows[0].character_maximum_length).toBe(3);
    expect(currencyCol.rows[0].is_nullable).toBe("NO");
    // DEFAULT 'TWD'
    expect(currencyCol.rows[0].column_default).toMatch(/TWD/);

    // ── 2. account_type column existence, type, NOT NULL, DEFAULT ────────────

    const typeCol = await pool.query<{
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    }>(
      `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'accounts'
         AND column_name = 'account_type'`,
    );
    expect(typeCol.rows).toHaveLength(1);
    expect(typeCol.rows[0].data_type).toBe("text");
    expect(typeCol.rows[0].is_nullable).toBe("NO");
    // DEFAULT 'broker'
    expect(typeCol.rows[0].column_default).toMatch(/broker/);

    // ── 3. CHECK constraint for default_currency ──────────────────────────────

    const currencyCheck = await pool.query<{ conname: string; def: string }>(
      `SELECT conname, pg_get_constraintdef(oid) AS def
       FROM pg_constraint
       WHERE conrelid = 'public.accounts'::regclass
         AND contype = 'c'
         AND conname = 'ck_accounts_default_currency'`,
    );
    expect(currencyCheck.rows).toHaveLength(1);
    // The constraint body must enumerate the three allowed currencies
    const currencyDef = currencyCheck.rows[0].def;
    expect(currencyDef).toContain("TWD");
    expect(currencyDef).toContain("USD");
    expect(currencyDef).toContain("AUD");

    // ── 4. CHECK constraint for account_type ─────────────────────────────────

    const typeCheck = await pool.query<{ conname: string; def: string }>(
      `SELECT conname, pg_get_constraintdef(oid) AS def
       FROM pg_constraint
       WHERE conrelid = 'public.accounts'::regclass
         AND contype = 'c'
         AND conname = 'ck_accounts_account_type'`,
    );
    expect(typeCheck.rows).toHaveLength(1);
    const typeDef = typeCheck.rows[0].def;
    expect(typeDef).toContain("broker");
    expect(typeDef).toContain("bank");
    expect(typeDef).toContain("wallet");

    // ── 5. Seed a user + fee profile to support accounts FK dependencies ──────

    await pool.query(`
      INSERT INTO users (id, email, locale, cost_basis_method, quote_poll_interval_seconds)
      VALUES ('mig040-u', 'mig040@example.com', 'en', 'WEIGHTED_AVERAGE', 10)
    `);
    await seedAccountWithFeeProfilePost042({
      userId: "mig040-u",
      accountId: "mig040-acc-default",
      accountName: "Main",
      feeProfileId: "mig040-fp",
    });

    // ── 6. DEFAULT values applied: existing INSERT without the new columns ────

    const defaultRow = await pool.query<{ default_currency: string; account_type: string }>(
      `SELECT default_currency, account_type FROM accounts WHERE id = 'mig040-acc-default'`,
    );
    expect(defaultRow.rows).toHaveLength(1);
    expect(defaultRow.rows[0].default_currency.trim()).toBe("TWD");
    expect(defaultRow.rows[0].account_type).toBe("broker");

    // ── 7. Valid custom values accepted by CHECK constraints ──────────────────
    // KZO-183: each new account needs its own owner fee profile (composite FK).

    await expect(
      seedAccountWithFeeProfilePost042({
        userId: "mig040-u",
        accountId: "mig040-acc-usd-bank",
        accountName: "USD Bank",
        feeProfileId: "mig040-fp-usd-bank",
        defaultCurrency: "USD",
        accountType: "bank",
      }),
    ).resolves.not.toThrow();

    await expect(
      seedAccountWithFeeProfilePost042({
        userId: "mig040-u",
        accountId: "mig040-acc-aud-wallet",
        accountName: "AUD Wallet",
        feeProfileId: "mig040-fp-aud-wallet",
        defaultCurrency: "AUD",
        accountType: "wallet",
      }),
    ).resolves.not.toThrow();

    // ── 8. Invalid default_currency rejected by CHECK constraint ─────────────

    await expect(
      pool.query(`
        INSERT INTO accounts (id, user_id, name, fee_profile_id, default_currency, account_type)
        VALUES ('mig040-reject-eur', 'mig040-u', 'Bad EUR', 'mig040-fp', 'EUR', 'broker')
      `),
    ).rejects.toThrow();

    // ── 9. Invalid account_type rejected by CHECK constraint ─────────────────

    await expect(
      pool.query(`
        INSERT INTO accounts (id, user_id, name, fee_profile_id, default_currency, account_type)
        VALUES ('mig040-reject-inv', 'mig040-u', 'Bad Type', 'mig040-fp', 'TWD', 'investment')
      `),
    ).rejects.toThrow();

    // ── 10. NOT NULL enforcement: explicit NULL rejected ──────────────────────

    await expect(
      pool.query(`
        INSERT INTO accounts (id, user_id, name, fee_profile_id, default_currency, account_type)
        VALUES ('mig040-reject-null', 'mig040-u', 'Null Cur', 'mig040-fp', NULL, 'broker')
      `),
    ).rejects.toThrow();
  });

  // ── KZO-179 — migration 041 walk ─────────────────────────────────────────
  // Migration 041 adds:
  //   accounts.created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()  (forensic floor)
  //   ux_accounts_user_id_name UNIQUE INDEX ON accounts(user_id, name)
  //
  // Per KZO-179 D2, no audit_log entry is written on POST /accounts; created_at
  // is the recoverability replacement. Per D3, the unique index is the
  // TOCTOU safety net (clean 409 UX is delivered by the route's pre-check).
  //
  // ui-enhancement: migration 053 REPLACES `ux_accounts_user_id_name` with the
  // partial unique `ux_accounts_user_id_name_active WHERE deleted_at IS NULL`.
  // Because `applyNumberedMigrations` runs every migration through 055, the
  // assertion now reads the post-053 schema state.

  it("KZO-179: migration 041 walk — accounts.created_at column + ux_accounts_user_id_name_active unique index (post-053)", async () => {
    await resetDatabase();
    await applyNumberedMigrations();

    // ── 1. created_at column existence, type, NOT NULL, DEFAULT now() ────────

    const createdAtCol = await pool.query<{
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    }>(
      `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'accounts'
         AND column_name = 'created_at'`,
    );
    expect(createdAtCol.rows).toHaveLength(1);
    expect(createdAtCol.rows[0].data_type).toBe("timestamp with time zone");
    expect(createdAtCol.rows[0].is_nullable).toBe("NO");
    // Postgres normalizes DEFAULT NOW() to "now()". Match either form.
    expect(createdAtCol.rows[0].column_default).toMatch(/now\(\)/i);

    // ── 2. ux_accounts_user_id_name_active unique index existence + columns ─

    const indexRow = await pool.query<{
      indexname: string;
      indexdef: string;
      is_unique: boolean;
    }>(
      `SELECT
         i.relname AS indexname,
         pg_get_indexdef(ix.indexrelid) AS indexdef,
         ix.indisunique AS is_unique
       FROM pg_class i
       JOIN pg_index ix ON ix.indexrelid = i.oid
       JOIN pg_class t ON t.oid = ix.indrelid
       WHERE t.relname = 'accounts'
         AND i.relname = 'ux_accounts_user_id_name_active'`,
    );
    expect(indexRow.rows).toHaveLength(1);
    expect(indexRow.rows[0].is_unique).toBe(true);
    // The index definition must reference both user_id and name columns.
    expect(indexRow.rows[0].indexdef).toMatch(/user_id/);
    expect(indexRow.rows[0].indexdef).toMatch(/name/);
    // ui-enhancement: partial-unique predicate restricts uniqueness to active
    // (non-soft-deleted) rows so name reuse after soft-delete is permitted.
    expect(indexRow.rows[0].indexdef).toMatch(/deleted_at IS NULL/i);
    // The pre-053 index must no longer exist.
    const oldIndexRow = await pool.query<{ count: string }>(
      `SELECT count(*) AS count FROM pg_class
       WHERE relname = 'ux_accounts_user_id_name'`,
    );
    expect(oldIndexRow.rows[0].count).toBe("0");

    // ── 3. Seed FK parents and verify created_at is auto-populated ───────────

    await pool.query(`
      INSERT INTO users (id, email, locale, cost_basis_method, quote_poll_interval_seconds)
      VALUES ('mig041-u', 'mig041@example.com', 'en', 'WEIGHTED_AVERAGE', 10)
    `);
    await seedAccountWithFeeProfilePost042({
      userId: "mig041-u",
      accountId: "mig041-acc-1",
      accountName: "Main",
      feeProfileId: "mig041-fp",
    });
    const createdAtRow = await pool.query<{ created_at: Date | null }>(
      `SELECT created_at FROM accounts WHERE id = 'mig041-acc-1'`,
    );
    expect(createdAtRow.rows).toHaveLength(1);
    expect(createdAtRow.rows[0].created_at).not.toBeNull();

    // ── 4. Per-user uniqueness enforced: same user, same name → rejected ─────

    await expect(
      pool.query(`
        INSERT INTO accounts (id, user_id, name, fee_profile_id)
        VALUES ('mig041-acc-dup', 'mig041-u', 'Main', 'mig041-fp')
      `),
    ).rejects.toThrow();

    // ── 5. Per-user uniqueness scoped: different user, same name → accepted ──

    await pool.query(`
      INSERT INTO users (id, email, locale, cost_basis_method, quote_poll_interval_seconds)
      VALUES ('mig041-u2', 'mig041-u2@example.com', 'en', 'WEIGHTED_AVERAGE', 10)
    `);
    await expect(
      seedAccountWithFeeProfilePost042({
        userId: "mig041-u2",
        accountId: "mig041-acc-other",
        accountName: "Main",
        feeProfileId: "mig041-fp2",
      }),
    ).resolves.not.toThrow();

    // ── 6. Same user, different name → accepted (case-sensitive uniqueness) ─
    // KZO-183: needs its own owner fee profile.

    await expect(
      seedAccountWithFeeProfilePost042({
        userId: "mig041-u",
        accountId: "mig041-acc-2",
        accountName: "main",
        feeProfileId: "mig041-fp-acc-2",
      }),
    ).resolves.not.toThrow();
  });

  // ── KZO-168 — migration 043 walk ─────────────────────────────────────────
  // Migration 043 enables paired FX-transfer cash-ledger entries:
  //   - FX_TRANSFER_OUT / FX_TRANSFER_IN entry types
  //   - fx_transfer_id UUID linkage column
  //   - CHECK limiting fx_transfer_id to FX legs and reversals
  //   - partial UNIQUE index limiting one original OUT and one original IN per transfer
  //   - audit_log actions for create/update/reverse lifecycle events

  it("KZO-168: migration 043 walk — cash ledger FX-transfer entry types, linkage, index, and audit actions", async () => {
    await resetDatabase();
    await applyNumberedMigrations();

    const column = await pool.query<{
      column_name: string;
      data_type: string;
      is_nullable: string;
    }>(
      `SELECT column_name, data_type, is_nullable
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'cash_ledger_entries'
         AND column_name = 'fx_transfer_id'`,
    );
    expect(column.rows).toHaveLength(1);
    expect(column.rows[0].data_type).toBe("uuid");
    expect(column.rows[0].is_nullable).toBe("YES");

    const constraints = await pool.query<{ conname: string; def: string }>(
      `SELECT conname, pg_get_constraintdef(oid) AS def
       FROM pg_constraint
       WHERE conrelid = 'cash_ledger_entries'::regclass`,
    );
    const constraintByName = new Map(constraints.rows.map((row) => [row.conname, row.def]));
    expect(constraintByName.get("cash_ledger_entries_entry_type_check")).toContain("FX_TRANSFER_OUT");
    expect(constraintByName.get("cash_ledger_entries_entry_type_check")).toContain("FX_TRANSFER_IN");
    expect(constraintByName.get("ck_cash_ledger_entries_fx_transfer_id_entry_type")).toContain("fx_transfer_id");

    const index = await pool.query<{ indexdef: string }>(
      `SELECT pg_get_indexdef(indexrelid) AS indexdef
       FROM pg_index
       WHERE indexrelid = 'idx_cash_ledger_fx_transfer_leg_originals'::regclass`,
    );
    expect(index.rows).toHaveLength(1);
    expect(index.rows[0].indexdef).toContain("fx_transfer_id");
    expect(index.rows[0].indexdef).toContain("entry_type");
    expect(index.rows[0].indexdef).toContain("reversal_of_cash_ledger_entry_id IS NULL");

    await pool.query(`
      INSERT INTO users (id, email, locale, cost_basis_method, quote_poll_interval_seconds)
      VALUES ('mig043-u', 'mig043@example.com', 'en', 'WEIGHTED_AVERAGE', 10)
    `);
    await seedAccountWithFeeProfilePost042({
      userId: "mig043-u",
      accountId: "mig043-from",
      accountName: "TWD Wallet",
      feeProfileId: "mig043-fp-from",
      defaultCurrency: "TWD",
      accountType: "wallet",
    });
    await seedAccountWithFeeProfilePost042({
      userId: "mig043-u",
      accountId: "mig043-to",
      accountName: "USD Wallet",
      feeProfileId: "mig043-fp-to",
      defaultCurrency: "USD",
      accountType: "wallet",
    });

    const transferId = "00000000-0000-4000-8000-000000000043";
    await expect(
      pool.query(
        `INSERT INTO cash_ledger_entries (
           id, user_id, account_id, entry_date, entry_type, amount, currency,
           source, source_reference, booked_at, fx_rate_to_usd, fx_transfer_id
         ) VALUES
           ('mig043-out', 'mig043-u', 'mig043-from', '2026-04-01', 'FX_TRANSFER_OUT', -1000, 'TWD',
            'fx_transfer', 'mig043-out', NOW(), 0.032, $1::uuid),
           ('mig043-in', 'mig043-u', 'mig043-to', '2026-04-01', 'FX_TRANSFER_IN', 32, 'USD',
            'fx_transfer', 'mig043-in', NOW(), 1.0, $1::uuid)`,
        [transferId],
      ),
    ).resolves.not.toThrow();

    await expect(
      pool.query(
        `INSERT INTO cash_ledger_entries (
           id, user_id, account_id, entry_date, entry_type, amount, currency,
           source, source_reference, booked_at, fx_transfer_id
         ) VALUES (
           'mig043-invalid-type', 'mig043-u', 'mig043-from', '2026-04-01', 'MANUAL_ADJUSTMENT',
           1, 'TWD', 'fx_transfer', 'mig043-invalid-type', NOW(), $1::uuid
         )`,
        [transferId],
      ),
    ).rejects.toThrow();

    await expect(
      pool.query(
        `INSERT INTO cash_ledger_entries (
           id, user_id, account_id, entry_date, entry_type, amount, currency,
           source, source_reference, booked_at, fx_transfer_id
         ) VALUES (
           'mig043-out-dup', 'mig043-u', 'mig043-from', '2026-04-01', 'FX_TRANSFER_OUT',
           -1, 'TWD', 'fx_transfer', 'mig043-out-dup', NOW(), $1::uuid
         )`,
        [transferId],
      ),
    ).rejects.toThrow();

    await expect(
      pool.query(
        `INSERT INTO audit_log (id, actor_user_id, action, target_user_id, metadata)
         VALUES
           ('mig043-audit-create', 'mig043-u', 'fx_transfer_created', 'mig043-u', '{}'::jsonb),
           ('mig043-audit-update', 'mig043-u', 'fx_transfer_updated', 'mig043-u', '{}'::jsonb),
           ('mig043-audit-reverse', 'mig043-u', 'fx_transfer_reversed', 'mig043-u', '{}'::jsonb)`,
      ),
    ).resolves.not.toThrow();
  });

  // ── KZO-169 — migration 044 walk ─────────────────────────────────────────
  // Migration 044 rewrites primary keys on market_data.instruments and
  // market_data.daily_bars to the composite (ticker, market_code) shape, and
  // adds market_code to market_data.dividend_events + user_monitored_tickers
  // (with PK rewrite + FK rebind). Everything is forward-only and idempotent.

  it("KZO-169: migration 044 walk — composite (ticker, market_code) PKs and column adds", async () => {
    await resetDatabase();
    await applyNumberedMigrations();

    // ── 1. market_data.instruments PK is now composite (ticker, market_code) ──
    const instrumentsPk = await pool.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def
       FROM pg_constraint
       WHERE conrelid = 'market_data.instruments'::regclass
         AND contype = 'p'`,
    );
    expect(instrumentsPk.rows).toHaveLength(1);
    expect(instrumentsPk.rows[0].def).toMatch(/PRIMARY KEY \(ticker, market_code\)/);

    // ── 2. market_data.daily_bars has market_code column + composite PK ──────
    const dailyBarsCol = await pool.query<{ data_type: string; is_nullable: string; column_default: string | null }>(
      `SELECT data_type, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_schema = 'market_data'
         AND table_name = 'daily_bars'
         AND column_name = 'market_code'`,
    );
    expect(dailyBarsCol.rows).toHaveLength(1);
    expect(dailyBarsCol.rows[0].data_type).toBe("text");
    expect(dailyBarsCol.rows[0].is_nullable).toBe("NO");
    expect(dailyBarsCol.rows[0].column_default).toMatch(/TW/);

    const dailyBarsPk = await pool.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def
       FROM pg_constraint
       WHERE conrelid = 'market_data.daily_bars'::regclass
         AND contype = 'p'`,
    );
    expect(dailyBarsPk.rows).toHaveLength(1);
    expect(dailyBarsPk.rows[0].def).toMatch(/PRIMARY KEY \(ticker, market_code, bar_date\)/);

    const dailyBarsCheck = await pool.query<{ conname: string }>(
      `SELECT conname FROM pg_constraint
       WHERE conname = 'ck_daily_bars_market_code'
         AND conrelid = 'market_data.daily_bars'::regclass`,
    );
    expect(dailyBarsCheck.rows).toHaveLength(1);

    // ── 3. market_data.dividend_events has market_code column + CHECK + index ─
    const divCol = await pool.query<{ data_type: string; is_nullable: string; column_default: string | null }>(
      `SELECT data_type, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_schema = 'market_data'
         AND table_name = 'dividend_events'
         AND column_name = 'market_code'`,
    );
    expect(divCol.rows).toHaveLength(1);
    expect(divCol.rows[0].data_type).toBe("text");
    expect(divCol.rows[0].is_nullable).toBe("NO");
    expect(divCol.rows[0].column_default).toMatch(/TW/);

    const divCheck = await pool.query<{ conname: string }>(
      `SELECT conname FROM pg_constraint
       WHERE conname = 'ck_dividend_events_market_code'
         AND conrelid = 'market_data.dividend_events'::regclass`,
    );
    expect(divCheck.rows).toHaveLength(1);

    const divIdx = await pool.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
       WHERE schemaname = 'market_data'
         AND tablename = 'dividend_events'
         AND indexname = 'idx_md_dividend_events_ticker_market_ex_date'`,
    );
    expect(divIdx.rows).toHaveLength(1);

    // ── 4. user_monitored_tickers — column + composite PK + composite FK ─────
    const umtCol = await pool.query<{ data_type: string; is_nullable: string; column_default: string | null }>(
      `SELECT data_type, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'user_monitored_tickers'
         AND column_name = 'market_code'`,
    );
    expect(umtCol.rows).toHaveLength(1);
    expect(umtCol.rows[0].data_type).toBe("text");
    expect(umtCol.rows[0].is_nullable).toBe("NO");
    expect(umtCol.rows[0].column_default).toMatch(/TW/);

    const umtPk = await pool.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def
       FROM pg_constraint
       WHERE conrelid = 'public.user_monitored_tickers'::regclass
         AND contype = 'p'`,
    );
    expect(umtPk.rows).toHaveLength(1);
    expect(umtPk.rows[0].def).toMatch(/PRIMARY KEY \(user_id, ticker, market_code\)/);

    const umtFk = await pool.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def
       FROM pg_constraint
       WHERE conname = 'fk_umt_instrument'
         AND conrelid = 'public.user_monitored_tickers'::regclass`,
    );
    expect(umtFk.rows).toHaveLength(1);
    expect(umtFk.rows[0].def).toMatch(/FOREIGN KEY \(ticker, market_code\) REFERENCES market_data\.instruments\(ticker, market_code\)/);

    // ── 5. Two BHP rows on different markets persist (composite PK in action) ─
    await expect(
      pool.query(
        `INSERT INTO market_data.instruments (ticker, market_code, name, instrument_type)
         VALUES ('BHP', 'US', 'BHP Group ADR', 'STOCK'),
                ('BHP', 'AU', 'BHP Group Ltd', 'STOCK')`,
      ),
    ).resolves.not.toThrow();

    const dupRows = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM market_data.instruments WHERE ticker = 'BHP'`,
    );
    expect(dupRows.rows[0].count).toBe("2");

    // ── 6. market_code regex CHECK rejects malformed codes ───────────────────
    await expect(
      pool.query(
        `INSERT INTO market_data.daily_bars (
           ticker, market_code, bar_date, open, high, low, close, volume, source
         ) VALUES (
           'BHP', 'lower', '2026-04-01', 1, 1, 1, 1, 0, 'test'
         )`,
      ),
    ).rejects.toThrow();

    // ── 7. user_monitored_tickers FK to composite instruments is enforced ────
    await pool.query(
      `INSERT INTO users (id, email, locale, cost_basis_method, quote_poll_interval_seconds)
       VALUES ('mig044-u', 'mig044@example.com', 'en', 'WEIGHTED_AVERAGE', 10)`,
    );

    await expect(
      pool.query(
        `INSERT INTO user_monitored_tickers (user_id, ticker, market_code)
         VALUES ('mig044-u', 'BHP', 'AU')`,
      ),
    ).resolves.not.toThrow();

    // Same (user, ticker) tuple on a different market is allowed by the new
    // composite PK — verifies the disambiguation behaviour for BHP-on-US vs
    // BHP-on-AU monitoring.
    await expect(
      pool.query(
        `INSERT INTO user_monitored_tickers (user_id, ticker, market_code)
         VALUES ('mig044-u', 'BHP', 'US')`,
      ),
    ).resolves.not.toThrow();

    // FK violation: ticker exists but the (ticker, market_code) tuple does not.
    await expect(
      pool.query(
        `INSERT INTO user_monitored_tickers (user_id, ticker, market_code)
         VALUES ('mig044-u', 'BHP', 'TW')`,
      ),
    ).rejects.toThrow();
  });

  it("KZO-210: migrations 057-063 add connector, capability, draft, and MCP OAuth persistence tables", async () => {
    await applyNumberedMigrations();

    const tables = await pool.query<{ tablename: string }>(
      `SELECT tablename
       FROM pg_tables
       WHERE schemaname = 'public'
         AND tablename = ANY($1::text[])
       ORDER BY tablename`,
      [[
        "ai_connector_connections",
        "ai_connector_connection_scopes",
        "ai_connector_tool_toggles",
        "ai_connector_credentials",
        "ai_connector_access_logs",
        "ai_connector_policy_settings",
        "mcp_oauth_authorization_requests",
        "mcp_oauth_authorization_codes",
        "portfolio_share_capabilities",
        "pending_share_invite_capabilities",
        "ai_transaction_draft_batches",
        "ai_transaction_draft_rows",
        "ai_transaction_draft_unsupported_items",
        "ai_transaction_draft_events",
      ]],
    );
    expect(tables.rows.map((row) => row.tablename)).toEqual([
      "ai_connector_access_logs",
      "ai_connector_connection_scopes",
      "ai_connector_connections",
      "ai_connector_credentials",
      "ai_connector_policy_settings",
      "ai_connector_tool_toggles",
      "ai_transaction_draft_batches",
      "ai_transaction_draft_events",
      "ai_transaction_draft_rows",
      "ai_transaction_draft_unsupported_items",
      "mcp_oauth_authorization_codes",
      "mcp_oauth_authorization_requests",
      "pending_share_invite_capabilities",
      "portfolio_share_capabilities",
    ]);

    const auditCheck = await pool.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def
       FROM pg_constraint
       WHERE conname = 'audit_log_action_check'
         AND conrelid = 'public.audit_log'::regclass`,
    );
    expect(auditCheck.rows[0]?.def ?? "").toContain("share_capabilities_updated");
    expect(auditCheck.rows[0]?.def ?? "").toContain("ai_connector_connected");
    expect(auditCheck.rows[0]?.def ?? "").toContain("ai_connector_revoked");
    expect(auditCheck.rows[0]?.def ?? "").toContain("ai_connector_expired");
    expect(auditCheck.rows[0]?.def ?? "").toContain("delegated_portfolio_write");
    expect(auditCheck.rows[0]?.def ?? "").toContain("market_calendar_previewed");
    expect(auditCheck.rows[0]?.def ?? "").toContain("market_calendar_confirmed");
    expect(auditCheck.rows[0]?.def ?? "").toContain("market_calendar_invalidated");
    expect(auditCheck.rows[0]?.def ?? "").toContain("market_calendar_source_updated");

    const connectionIndex = await pool.query<{ indexname: string }>(
      `SELECT indexname
       FROM pg_indexes
       WHERE schemaname = 'public'
         AND tablename = 'ai_connector_connections'
         AND indexname = 'ux_ai_connector_connections_user_provider_active'`,
    );
    expect(connectionIndex.rows).toHaveLength(1);

    const connectionStatusCheck = await pool.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def
       FROM pg_constraint
       WHERE conrelid = 'public.ai_connector_connections'::regclass
         AND conname = 'ai_connector_connections_status_check'`,
    );
    expect(connectionStatusCheck.rows[0]?.def ?? "").toContain("'pending'");

    const oauthIssuerCheck = await pool.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def
       FROM pg_constraint
       WHERE conrelid = 'public.ai_connector_policy_settings'::regclass
         AND pg_get_constraintdef(oid) LIKE '%oauth_public_issuer%'`,
    );
    expect(oauthIssuerCheck.rows[0]?.def ?? "").toContain("^https://");

    const connectorColumns = await pool.query<{ column_name: string }>(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'ai_connector_connections'
         AND column_name = 'expiry_notified_at'`,
    );
    expect(connectorColumns.rows).toHaveLength(1);

    const oauthColumns = await pool.query<{ column_name: string }>(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'ai_connector_credentials'
         AND column_name = ANY($1::text[])
       ORDER BY column_name`,
      [[
        "oauth_client_id",
        "predecessor_credential_id",
        "replaced_by_credential_id",
        "resource",
        "scopes",
        "session_version",
        "token_family_id",
      ]],
    );
    expect(oauthColumns.rows.map((row) => row.column_name)).toEqual([
      "oauth_client_id",
      "predecessor_credential_id",
      "replaced_by_credential_id",
      "resource",
      "scopes",
      "session_version",
      "token_family_id",
    ]);

    const appConfigMcpSecret = await pool.query<{ column_name: string }>(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'app_config'
         AND column_name = 'mcp_oauth_token_secret'`,
    );
    expect(appConfigMcpSecret.rows).toHaveLength(1);

    const policyRow = await pool.query<{
      enabled: boolean;
      read_tools_enabled: boolean;
      draft_tools_enabled: boolean;
      oauth_redirect_uri_allowlist: string[];
    }>(
      `SELECT enabled, read_tools_enabled, draft_tools_enabled, oauth_redirect_uri_allowlist
       FROM ai_connector_policy_settings
       WHERE id = TRUE`,
    );
    expect(policyRow.rows[0]).toMatchObject({
      enabled: true,
      read_tools_enabled: true,
      draft_tools_enabled: true,
      oauth_redirect_uri_allowlist: [],
    });

    const draftRowUnique = await pool.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def
       FROM pg_constraint
       WHERE conrelid = 'public.ai_transaction_draft_rows'::regclass
         AND contype = 'u'`,
    );
    expect(draftRowUnique.rows.some((row) => row.def.includes("(batch_id, row_number)"))).toBe(true);

    const capabilityChecks = await pool.query<{ table_name: string; def: string }>(
      `SELECT c.conrelid::regclass::text AS table_name, pg_get_constraintdef(c.oid) AS def
       FROM pg_constraint c
       WHERE c.conrelid::regclass::text = ANY($1::text[])
         AND c.contype = 'c'
       ORDER BY c.conrelid::regclass::text, c.conname`,
      [[
        "ai_connector_connection_scopes",
        "pending_share_invite_capabilities",
        "portfolio_share_capabilities",
      ]],
    );
    expect(capabilityChecks.rows).toHaveLength(3);
    for (const row of capabilityChecks.rows) {
      expect(row.def).toContain("'account:manage'");
      const shareCapabilityTable = row.table_name === "portfolio_share_capabilities"
        || row.table_name === "pending_share_invite_capabilities";
      if (shareCapabilityTable) {
        expect(row.def).toContain("'sharing:manage'");
      } else {
        expect(row.def).not.toContain("'sharing:manage'");
      }
    }

    await pool.query(
      `INSERT INTO portfolio_shares (id, owner_user_id, grantee_user_id)
       VALUES ('mig087-share', 'legacy-fifo', 'legacy-lifo')`,
    );
    await expect(
      pool.query(
        `INSERT INTO portfolio_share_capabilities (share_id, capability, granted_by_user_id)
         VALUES ('mig087-share', 'sharing:manage', 'legacy-fifo')`,
      ),
    ).resolves.not.toThrow();

    await pool.query(
      `INSERT INTO invites (code, email, role, expires_at, issued_by_user_id, share_owner_user_id)
       VALUES ('MIG087SM', 'mig087-share@example.com', 'viewer', NOW() + INTERVAL '7 days', 'legacy-fifo', 'legacy-fifo')`,
    );
    await expect(
      pool.query(
        `INSERT INTO pending_share_invite_capabilities (invite_code, capability, granted_by_user_id)
         VALUES ('MIG087SM', 'sharing:manage', 'legacy-fifo')`,
      ),
    ).resolves.not.toThrow();
  });

  it("KZO-197: migration 070 backfills provider incidents idempotently from error trail", async () => {
    const before070 = await getNumberedMigrationsBefore("070_kzo197_provider_incident_backfill.sql");
    await applyMigrationFiles(before070);

    await pool.query(
      `INSERT INTO market_data.provider_error_trail (provider_id, occurred_at, error_class, error_message, context)
       VALUES
         ('yahoo-finance-kr', '2026-06-04T10:00:00Z', 'other', 'yahoo_finance_kr_symbol_unresolved: 005930', '{"marketCode":"KR","ticker":"005930"}'::jsonb),
         ('yahoo-finance-kr', '2026-06-04T10:05:00Z', 'other', 'yahoo_finance_kr_symbol_unresolved: 005930', '{"marketCode":"KR","ticker":"005930"}'::jsonb)`,
    );

    await applyMigrationFiles(["070_kzo197_provider_incident_backfill.sql"]);
    await applyMigrationFiles(["070_kzo197_provider_incident_backfill.sql"]);

    const rows = await pool.query<{
      incident_key: string;
      status: string;
      severity: string;
      title: string;
      occurrence_count: number;
      metadata: { seededFrom?: string; sourceSymbol?: string };
    }>(
      `SELECT incident_key, status, severity, title, occurrence_count, metadata
       FROM market_data.provider_incidents
       WHERE provider_id = 'yahoo-finance-kr'
       ORDER BY incident_key`,
    );

    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({
      incident_key: "other:yahoo_finance_kr_symbol_unresolved:KR:005930",
      status: "open",
      severity: "critical",
      title: "yahoo-finance-kr unresolved 005930",
      occurrence_count: 2,
    });
    expect(rows.rows[0]?.metadata).toMatchObject({
      seededFrom: "provider_error_trail_incident_backfill",
      sourceSymbol: "005930",
    });
  });

  it("KZO-210: pending invite capabilities materialize onto the share grant", async () => {
    await applyNumberedMigrations();

    persistence = new PostgresPersistence({
      databaseUrl: databaseUrl!,
      redisUrl: redisUrl!,
    });

    await pool.query(
      `INSERT INTO users (id, email, locale, cost_basis_method, quote_poll_interval_seconds)
       VALUES
         ('owner-kzo210', 'owner-kzo210@example.com', 'en', 'WEIGHTED_AVERAGE', 10),
         ('grantee-kzo210', 'grantee-kzo210@example.com', 'en', 'WEIGHTED_AVERAGE', 10)`,
    );

    const invite = await persistence.createShareCoupledInvite({
      ownerUserId: "owner-kzo210",
      email: "grantee-kzo210@example.com",
      expiresAt: "2026-12-31T00:00:00.000Z",
      issuedByUserId: "owner-kzo210",
    });

    await persistence.setPendingShareInviteCapabilities({
      inviteCode: invite.code,
      capabilities: ["portfolio:mcp_read", "transaction_draft:create"],
      grantedByUserId: "owner-kzo210",
    });

    const [materialized] = await persistence.materializePendingSharesForEmail({
      userId: "grantee-kzo210",
      email: "grantee-kzo210@example.com",
      auditInput: {
        actorUserId: "grantee-kzo210",
        metadata: { source: "test" },
      },
    });

    expect(materialized).toBeTruthy();
    await expect(persistence.getShareCapabilities(materialized!.id)).resolves.toEqual([
      "portfolio:mcp_read",
      "transaction_draft:create",
    ]);
  });

  it("KZO-225: AI draft posting inserts trade events before linking confirmed rows", async () => {
    await applyNumberedMigrations();

    persistence = new PostgresPersistence({
      databaseUrl: databaseUrl!,
      redisUrl: redisUrl!,
    });
    await persistence.init();

    const { userId } = await persistence.resolveOrCreateUser("google", "kzo225-ai-draft-post-sub", {
      email: "kzo225-ai-draft-post@example.com",
      name: "KZO 225 AI Draft Post",
    });
    const store = await persistence.loadStore(userId);
    const trade = createTransaction(store, userId, {
      id: "kzo225-ai-draft-trade",
      accountId: `${userId}-acc-1`,
      ticker: "2330",
      marketCode: "TW",
      quantity: 10,
      unitPrice: 100,
      priceCurrency: "TWD",
      tradeDate: "2026-05-01",
      tradeTimestamp: "2026-05-01T09:00:00.000Z",
      commissionAmount: 7,
      taxAmount: 3,
      type: "BUY",
      isDayTrade: false,
    });
    const now = "2026-05-01T10:00:00.000Z";

    const batch = await persistence.saveAiTransactionDraftBatch({
      id: "kzo225-ai-draft-batch",
      ownerUserId: userId,
      createdByUserId: userId,
      sourceChannel: "mcp",
      status: "open",
      version: 1,
      sourceLabel: "ChatGPT",
      provenance: { sourceType: "csv" },
      rowCount: 1,
      unsupportedCount: 0,
      createdAt: now,
      updatedAt: now,
    });
    expect(batch).toBeTruthy();

    const row = await persistence.saveAiTransactionDraftRow({
      id: "kzo225-ai-draft-row",
      batchId: batch!.id,
      ownerUserId: userId,
      rowNumber: 1,
      state: "ready",
      version: 1,
      accountId: `${userId}-acc-1`,
      tradeType: "BUY",
      ticker: "2330",
      marketCode: "TW",
      quantity: 10,
      unitPrice: 100,
      priceCurrency: "TWD",
      tradeDate: "2026-05-01",
      tradeTimestamp: "2026-05-01T09:00:00.000Z",
      commissionAmount: 7,
      taxAmount: 3,
      feesSource: "SOURCE_PROVIDED",
      normalizedPayload: { row: 1 },
      preflightIssues: [],
      warnings: [],
      createdAt: now,
      updatedAt: now,
    });
    expect(row).toBeTruthy();

    const confirmed = await persistence.confirmAiTransactionDraftPosting({
      ownerUserId: userId,
      accounting: store.accounting,
      rows: [{
        ...row!,
        state: "confirmed",
        version: 2,
        confirmedTradeEventId: trade.id,
        confirmedAt: now,
        confirmedByUserId: userId,
        updatedAt: now,
        expectedVersion: 1,
      }],
      batch: {
        ...batch!,
        version: 2,
        updatedAt: now,
        expectedVersion: 1,
      },
      event: {
        id: "kzo225-ai-draft-event",
        batchId: batch!.id,
        ownerUserId: userId,
        actorUserId: userId,
        eventType: "rows_confirmed",
        summary: "1 draft rows posted",
        metadata: { createdTransactionIds: [trade.id], postedRowIds: [row!.id] },
        sourceIp: "127.0.0.1",
        createdAt: now,
      },
    });

    expect(confirmed?.rows[0]).toMatchObject({
      id: row!.id,
      state: "confirmed",
      confirmedTradeEventId: trade.id,
    });
    await expect(
      pool.query(`SELECT id FROM trade_events WHERE id = $1 AND user_id = $2`, [trade.id, userId]),
    ).resolves.toMatchObject({ rowCount: 1 });
  });
});
