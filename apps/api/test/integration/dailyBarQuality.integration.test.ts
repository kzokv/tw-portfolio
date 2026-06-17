import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { loadMigrationManifest } from "../../src/persistence/migrationManifest.js";
import { upsertDailyBars } from "../../src/services/market-data/upserts.js";

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

describePostgres("daily bar quality upsert semantics (Postgres)", () => {
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
  });

  afterEach(async () => {
    await pool.end();
  });

  it("defaults legacy inserts to full_bar and enforces close_only/full_bar precedence", async () => {
    await pool.query(
      `INSERT INTO market_data.daily_bars (
         ticker, market_code, bar_date, open, high, low, close, volume, source
       ) VALUES (
         '2330', 'TW', '2026-06-17', 1000, 1005, 995, 1002, 100, 'legacy-fixture'
       )`,
    );
    const seeded = await pool.query<{ quality: string }>(
      `SELECT quality FROM market_data.daily_bars
       WHERE ticker = '2330' AND market_code = 'TW' AND bar_date = '2026-06-17'`,
    );
    expect(seeded.rows[0]?.quality).toBe("full_bar");

    const insertCloseOnly = await upsertDailyBars(pool, [{
      ticker: "AAPL",
      marketCode: "US",
      barDate: "2026-06-17",
      open: 210,
      high: 210,
      low: 210,
      close: 210,
      volume: 0,
      quality: "close_only",
      sourceId: "twse-close-fallback-test",
    }]);
    expect(insertCloseOnly).toBe(1);

    const skipCloseOnlyOverwrite = await upsertDailyBars(pool, [{
      ticker: "2330",
      marketCode: "TW",
      barDate: "2026-06-17",
      open: 9999,
      high: 9999,
      low: 9999,
      close: 9999,
      volume: 0,
      quality: "close_only",
      sourceId: "close-only-should-not-win",
    }]);
    expect(skipCloseOnlyOverwrite).toBe(0);

    const preservedFullBar = await pool.query<{
      open: string;
      close: string;
      quality: string;
      source: string;
    }>(
      `SELECT open, close, quality, source
       FROM market_data.daily_bars
       WHERE ticker = '2330' AND market_code = 'TW' AND bar_date = '2026-06-17'`,
    );
    expect(preservedFullBar.rows[0]).toEqual({
      open: "1000.0000",
      close: "1002.0000",
      quality: "full_bar",
      source: "legacy-fixture",
    });

    const promoteToFullBar = await upsertDailyBars(pool, [{
      ticker: "AAPL",
      marketCode: "US",
      barDate: "2026-06-17",
      open: 211.25,
      high: 213.1,
      low: 209.8,
      close: 212.45,
      volume: 1500,
      quality: "full_bar",
      sourceId: "yahoo-daily-provider-test",
    }]);
    expect(promoteToFullBar).toBe(1);

    const promoted = await pool.query<{
      open: string;
      high: string;
      low: string;
      close: string;
      volume: string;
      quality: string;
      source: string;
    }>(
      `SELECT open, high, low, close, volume, quality, source
       FROM market_data.daily_bars
       WHERE ticker = 'AAPL' AND market_code = 'US' AND bar_date = '2026-06-17'`,
    );
    expect(promoted.rows[0]).toEqual({
      open: "211.2500",
      high: "213.1000",
      low: "209.8000",
      close: "212.4500",
      volume: "1500",
      quality: "full_bar",
      source: "yahoo-daily-provider-test",
    });
  });
});
