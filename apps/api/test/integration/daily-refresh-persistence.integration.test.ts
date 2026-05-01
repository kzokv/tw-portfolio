import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import type { Lot } from "@tw-portfolio/domain";
import type { CatalogInstrument } from "../../src/persistence/types.js";
import { loadMigrationManifest } from "../../src/persistence/migrationManifest.js";
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
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(currentDir, "../../../../db/migrations");
const migrationManifestPromise = loadMigrationManifest(migrationsDir);

const sampleCatalog: CatalogInstrument[] = [
  { ticker: "1101", name: "Taiwan Cement", typeRaw: "twse", industryCategoryRaw: "水泥工業", finmindDate: "2026-03-31", instrumentType: "STOCK" },
  { ticker: "2317", name: "Hon Hai", typeRaw: "twse", industryCategoryRaw: "其他電子業", finmindDate: "2026-03-31", instrumentType: "STOCK" },
  { ticker: "2330", name: "TSMC", typeRaw: "twse", industryCategoryRaw: "半導體業", finmindDate: "2026-03-31", instrumentType: "STOCK" },
  { ticker: "2603", name: "Evergreen", typeRaw: "twse", industryCategoryRaw: "航運業", finmindDate: "2026-03-31", instrumentType: "STOCK" },
  { ticker: "0050", name: "Yuanta Taiwan 50", typeRaw: "twse", industryCategoryRaw: "ETF", finmindDate: "2026-03-31", instrumentType: "ETF" },
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

  async function createUser(email: string, isDemo = false): Promise<{ userId: string; accountId: string }> {
    const { userId } = await persistence!.resolveOrCreateUser("google", `sub:${email}`, {
      email,
      name: email,
      emailVerified: true,
    });
    if (isDemo) {
      await persistence!.markDemoUser(userId, 3600);
    }
    const store = await persistence!.loadStore(userId);
    return { userId, accountId: store.accounts[0]!.id };
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

    await persistence!.updateBackfillStatus("1101", "ready");
    await persistence!.updateBackfillStatus("2330", "ready");
    await persistence!.updateBackfillStatus("2603", "ready");
    await persistence!.updateBackfillStatus("0050", "ready");

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
