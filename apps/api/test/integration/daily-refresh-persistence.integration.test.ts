import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import type { Lot } from "@vakwen/domain";
import type { CatalogInstrument } from "../../src/persistence/types.js";
import { loadMigrationManifest } from "../../src/persistence/migrationManifest.js";
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
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(currentDir, "../../../../db/migrations");
const migrationManifestPromise = loadMigrationManifest(migrationsDir);

// KZO-170: per-row `marketCode` is now required on `CatalogInstrument`. Pre-KZO-170
// fixtures stamped 'TW' implicitly at the SQL layer (`array_fill('TW'::text, ...)`);
// post-KZO-170 the source of truth is each row's `marketCode` field.
const sampleCatalog: CatalogInstrument[] = [
  { ticker: "1101", name: "Taiwan Cement", typeRaw: "twse", industryCategoryRaw: "水泥工業", finmindDate: "2026-03-31", instrumentType: "STOCK", marketCode: "TW" },
  { ticker: "2317", name: "Hon Hai", typeRaw: "twse", industryCategoryRaw: "其他電子業", finmindDate: "2026-03-31", instrumentType: "STOCK", marketCode: "TW" },
  { ticker: "2330", name: "TSMC", typeRaw: "twse", industryCategoryRaw: "半導體業", finmindDate: "2026-03-31", instrumentType: "STOCK", marketCode: "TW" },
  { ticker: "2603", name: "Evergreen", typeRaw: "twse", industryCategoryRaw: "航運業", finmindDate: "2026-03-31", instrumentType: "STOCK", marketCode: "TW" },
  { ticker: "0050", name: "Yuanta Taiwan 50", typeRaw: "twse", industryCategoryRaw: "ETF", finmindDate: "2026-03-31", instrumentType: "ETF", marketCode: "TW" },
  { ticker: "AAPL", name: "Apple", typeRaw: "stock", industryCategoryRaw: "Technology", finmindDate: "2026-03-31", instrumentType: "STOCK", marketCode: "US" },
];

describePostgres("daily refresh persistence queries", () => {
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

  async function applyNumberedMigrations(): Promise<void> {
    const manifest = await migrationManifestPromise;
    const client = await pool.connect();
    try {
      for (const file of manifest.numberedMigrations) {
        const migrationSql = await fs.readFile(path.join(migrationsDir, file), "utf8");
        await client.query(migrationSql);
      }
    } finally {
      client.release();
    }
  }

  async function createUser(email: string, isDemo = false): Promise<{ userId: string; accountId: string; feeProfileId: string }> {
    const { userId } = await persistence!.resolveOrCreateUser("google", `sub:${email}`, {
      email,
      name: email,
      emailVerified: true,
    });
    if (isDemo) {
      await persistence!.markDemoUser(userId, 3600);
    }
    const store = await persistence!.loadStore(userId);
    const account = store.accounts[0]!;
    return { userId, accountId: account.id, feeProfileId: account.feeProfileId };
  }

  async function addOpenPosition(userId: string, accountId: string, ticker: string, lotId: string): Promise<void> {
    const lots: Lot[] = [
      {
        id: lotId,
        accountId,
        ticker,
        openQuantity: 10,
        totalCostAmount: 1000,
        costCurrency: "TWD",
        openedAt: "2026-01-15",
      },
    ];
    await persistence!.bulkUpsertLots(userId, lots);
  }

  async function addTradeEventMarket(
    userId: string,
    accountId: string,
    feeProfileId: string,
    ticker: string,
    marketCode: "TW" | "US",
  ): Promise<void> {
    const snapshotId = `snapshot-${accountId}-${ticker}-${marketCode}`;
    await pool.query(
      `INSERT INTO trade_fee_policy_snapshots (
         id, user_id, profile_id_at_booking, profile_name_at_booking,
         board_commission_rate, commission_discount_percent, minimum_commission_amount,
         commission_currency, commission_rounding_mode, tax_rounding_mode,
         stock_sell_tax_rate_bps, stock_day_trade_tax_rate_bps,
         etf_sell_tax_rate_bps, bond_etf_sell_tax_rate_bps, commission_charge_mode
       ) VALUES (
         $1, $2, $3, 'Default Broker',
         1.425, 28, 20,
         'USD', 'FLOOR', 'FLOOR',
         30, 15,
         10, 0, 'CHARGED_UPFRONT'
       )`,
      [snapshotId, userId, feeProfileId],
    );
    await pool.query(
      `INSERT INTO trade_events (
         id, user_id, account_id, ticker, market_code, instrument_type, trade_type,
         quantity, unit_price, price_currency, trade_date, trade_timestamp,
         booking_sequence, commission_amount, tax_amount, is_day_trade,
         fee_policy_snapshot_id, source, source_reference, booked_at
       ) VALUES (
         $1, $2, $3, $4, $5, 'STOCK', 'BUY',
         1, 100, $6, DATE '2026-02-01', TIMESTAMPTZ '2026-02-01T00:00:00Z',
         1, 0, 0, false,
         $7, 'test', $1, TIMESTAMPTZ '2026-02-01T00:00:00Z'
       )`,
      [`trade-${accountId}-${ticker}-${marketCode}`, userId, accountId, ticker, marketCode, marketCode === "US" ? "USD" : "TWD", snapshotId],
    );
  }

  beforeEach(async () => {
    pool = new Pool({ connectionString: databaseUrl });
    await resetDatabase();
    await applyNumberedMigrations();
    persistence = new PostgresPersistence({
      databaseUrl: databaseUrl!,
      redisUrl: redisUrl!,
    });
    await persistence.init();
    await persistence.upsertInstrumentCatalog(sampleCatalog, []);
  });

  afterEach(async () => {
    if (persistence) await persistence.close();
    await pool.end();
  });

  it("returns the distinct monitored tickers eligible for daily refresh", async () => {
    const realManual = await createUser("real-manual@example.com");
    const realPosition = await createUser("real-position@example.com");
    const demoOnly = await createUser("demo-only@example.com", true);
    const mixedTickerDemo = await createUser("mixed-demo@example.com", true);

    await persistence!.updateBackfillStatus("1101", "TW", "ready");
    await persistence!.updateBackfillStatus("2330", "TW", "ready");
    await persistence!.updateBackfillStatus("2603", "TW", "ready");
    await persistence!.updateBackfillStatus("0050", "TW", "ready");

    // KZO-169: replaceManualSelections accepts `{ ticker, marketCode }[]`.
    await persistence!.replaceManualSelections(realManual.userId, [
      { ticker: "2330", marketCode: "TW" },
      { ticker: "2317", marketCode: "TW" },
    ]);
    await persistence!.replaceManualSelections(realPosition.userId, [
      { ticker: "2603", marketCode: "TW" },
    ]);
    await persistence!.replaceManualSelections(demoOnly.userId, [
      { ticker: "1101", marketCode: "TW" },
    ]);
    await persistence!.replaceManualSelections(mixedTickerDemo.userId, [
      { ticker: "2330", marketCode: "TW" },
    ]);
    await addOpenPosition(realPosition.userId, realPosition.accountId, "0050", "lot-real-0050");
    await addOpenPosition(demoOnly.userId, demoOnly.accountId, "1101", "lot-demo-1101");

    await persistence!.upsertInstrumentCatalog([], [{ ticker: "2603", name: "Evergreen", date: "2026-03-30" }]);

    // KZO-185: getAllMonitoredTickers returns `(ticker, marketCode)` pairs.
    await expect(persistence!.getAllMonitoredTickers()).resolves.toEqual([
      { ticker: "0050", marketCode: "TW" },
      { ticker: "2330", marketCode: "TW" },
    ]);
  });

  it("returns held ticker-market pairs for scheduled close refresh without manual-only selections", async () => {
    const realManual = await createUser("close-refresh-manual@example.com");
    const realPosition = await createUser("close-refresh-position@example.com");
    const demoPosition = await createUser("close-refresh-demo@example.com", true);

    await persistence!.updateBackfillStatus("0050", "TW", "ready");
    await persistence!.updateBackfillStatus("2330", "TW", "ready");
    await persistence!.updateBackfillStatus("2603", "TW", "ready");

    await persistence!.replaceManualSelections(realManual.userId, [
      { ticker: "2330", marketCode: "TW" },
    ]);
    await addOpenPosition(realPosition.userId, realPosition.accountId, "0050", "lot-close-refresh-0050");
    await addOpenPosition(demoPosition.userId, demoPosition.accountId, "2603", "lot-close-refresh-demo-2603");

    await expect(persistence!.listHeldTickerMarketPairs()).resolves.toEqual([
      { ticker: "0050", marketCode: "TW" },
    ]);
  });

  it("returns held ticker-market pairs for quote fallback without primary bar readiness filtering", async () => {
    const realManual = await createUser("quote-fallback-manual@example.com");
    const realPosition = await createUser("quote-fallback-position@example.com");
    const demoPosition = await createUser("quote-fallback-demo@example.com", true);

    await persistence!.updateBackfillStatus("2317", "TW", "failed");
    await persistence!.updateBackfillStatus("2603", "TW", "failed");

    await persistence!.replaceManualSelections(realManual.userId, [
      { ticker: "2330", marketCode: "TW" },
    ]);
    await addOpenPosition(realPosition.userId, realPosition.accountId, "2317", "lot-quote-fallback-2317");
    await addOpenPosition(demoPosition.userId, demoPosition.accountId, "2603", "lot-quote-fallback-demo-2603");

    await expect(persistence!.listHeldTickerMarketPairs()).resolves.toEqual([]);
    await expect(persistence!.listHeldTickerMarketPairsForQuoteFallback()).resolves.toEqual([
      { ticker: "2317", marketCode: "TW" },
    ]);
  });

  it("uses held trade markets for scheduled close refresh when account currency drifts", async () => {
    const realPosition = await createUser("close-refresh-cross-currency@example.com");

    await persistence!.updateBackfillStatus("AAPL", "US", "ready");
    await pool.query(
      "UPDATE accounts SET default_currency = 'USD' WHERE id = $1",
      [realPosition.accountId],
    );
    await addOpenPosition(realPosition.userId, realPosition.accountId, "AAPL", "lot-close-refresh-aapl-us");
    await addTradeEventMarket(
      realPosition.userId,
      realPosition.accountId,
      realPosition.feeProfileId,
      "AAPL",
      "US",
    );
    await pool.query(
      "UPDATE accounts SET default_currency = 'AUD' WHERE id = $1",
      [realPosition.accountId],
    );

    await expect(persistence!.listHeldTickerMarketPairs()).resolves.toEqual([
      { ticker: "AAPL", marketCode: "US" },
    ]);
  });

  it("returns the non-demo users monitoring a ticker via manual selections or open positions", async () => {
    const realManual = await createUser("manual@example.com");
    const realPosition = await createUser("position@example.com");
    const demo = await createUser("demo@example.com", true);

    await persistence!.replaceManualSelections(realManual.userId, [
      { ticker: "2330", marketCode: "TW" },
    ]);
    await persistence!.replaceManualSelections(realPosition.userId, [
      { ticker: "2330", marketCode: "TW" },
    ]);
    await persistence!.replaceManualSelections(demo.userId, [
      { ticker: "2330", marketCode: "TW" },
    ]);
    await addOpenPosition(realPosition.userId, realPosition.accountId, "2330", "lot-real-2330");
    await addOpenPosition(demo.userId, demo.accountId, "2330", "lot-demo-2330");

    const monitoringUsers = await persistence!.getUsersMonitoringTicker("2330");

    expect(monitoringUsers.sort()).toEqual([realManual.userId, realPosition.userId].sort());
    await expect(persistence!.getUsersMonitoringTicker("9999")).resolves.toEqual([]);
  });
});
