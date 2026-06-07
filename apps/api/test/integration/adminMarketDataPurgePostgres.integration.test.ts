import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { loadMigrationManifest } from "../../src/persistence/migrationManifest.js";
import { PostgresPersistence } from "../../src/persistence/postgres.js";

const databaseUrl = process.env.POSTGRES_TEST_DB_URL ?? process.env.DB_URL;
const redisUrl = process.env.POSTGRES_TEST_REDIS_URL ?? process.env.REDIS_URL;
const runPostgresIntegration = process.env.RUN_POSTGRES_INTEGRATION === "1";
const managedCiStack = process.env.VAKWEN_MANAGED_CI_STACK === "1";

if (runPostgresIntegration && !managedCiStack) {
  throw new Error("RUN_POSTGRES_INTEGRATION=1 must be executed via npm run test:integration:full:host");
}

const shouldRunPostgresSuite = runPostgresIntegration && Boolean(databaseUrl) && Boolean(redisUrl);
const describePostgres = shouldRunPostgresSuite ? describe : describe.skip;
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(currentDir, "../../../../db/migrations");
const migrationManifestPromise = loadMigrationManifest(migrationsDir);

describePostgres("admin market-data purge persistence (Postgres)", () => {
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

  beforeEach(async () => {
    pool = new Pool({ connectionString: databaseUrl });
    await resetDatabase();
    await applyNumberedMigrations();
    persistence = new PostgresPersistence({ databaseUrl: databaseUrl!, redisUrl: redisUrl! });
    await persistence.init();
  });

  afterEach(async () => {
    if (persistence) await persistence.close();
    await pool.end();
  });

  it("purges full-history price bars without date bind params", async () => {
    await pool.query(
      `INSERT INTO market_data.instruments (ticker, market_code, name, instrument_type, bars_backfill_status)
       VALUES ('TWPURGEPG', 'TW', 'TW purge Postgres fixture', 'STOCK', 'ready')`,
    );
    await pool.query(
      `INSERT INTO market_data.daily_bars (ticker, market_code, bar_date, open, high, low, close, volume, source)
       VALUES ('TWPURGEPG', 'TW', '2026-01-02', 10, 12, 9, 11, 1000, 'finmind-tw')`,
    );

    const dryRun = await persistence!.purgeAdminMarketData({
      providerId: "finmind-tw",
      marketCode: "TW",
      categories: ["price_bars"],
      targets: [{ ticker: "TWPURGEPG", marketCode: "TW" }],
      fullHistory: true,
      startDate: null,
      endDate: null,
      dryRun: true,
    });
    expect(dryRun.priceBars).toBe(1);
    expect(dryRun.total).toBe(1);

    const deleted = await persistence!.purgeAdminMarketData({
      providerId: "finmind-tw",
      marketCode: "TW",
      categories: ["price_bars"],
      targets: [{ ticker: "TWPURGEPG", marketCode: "TW" }],
      fullHistory: true,
      startDate: null,
      endDate: null,
      dryRun: false,
    });
    expect(deleted.priceBars).toBe(1);
    expect(deleted.total).toBe(1);

    const remaining = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM market_data.daily_bars WHERE ticker = 'TWPURGEPG' AND market_code = 'TW'",
    );
    expect(Number(remaining.rows[0]?.count ?? "0")).toBe(0);
  });
});
