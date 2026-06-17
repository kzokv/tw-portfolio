import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadMigrationManifest } from "../../src/persistence/migrationManifest.js";
import { PostgresPersistence } from "../../src/persistence/postgres.js";

const databaseUrl = process.env.POSTGRES_TEST_DB_URL ?? process.env.DB_URL;
const redisUrl = process.env.POSTGRES_TEST_REDIS_URL ?? process.env.REDIS_URL;
const runPostgresIntegration = process.env.RUN_POSTGRES_INTEGRATION === "1";
const managedCiStack = process.env.VAKWEN_MANAGED_CI_STACK === "1";

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

describePostgres("app_config — ticker price freshness (Postgres)", () => {
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
    if (persistence) {
      await persistence.close();
      persistence = null;
    }
    await pool.end();
  });

  it("setAppConfigPatch persists ticker price freshness flat fields including booleans, enums, and arrays", async () => {
    await persistence!.setAppConfigPatch({
      tickerPriceCloseRefreshGraceMinutes: 90,
      tickerPriceIntradayEnabled: false,
      tickerPriceIntradayRefreshIntervalMinutes: 10,
      tickerPriceIntradayFreshnessToleranceMinutes: 30,
      tickerPriceYahooChartRequestLimitPerMinute: 200,
      tickerPriceQueueConcurrency: 5,
      tickerPriceMaxTickersPerRefreshCycle: 150,
      tickerPriceSupportedMarkets: ["TW", "US", "KR"],
      tickerPriceRegularSessionOnly: true,
      tickerPriceYahooChartRange: "5d",
      tickerPriceYahooChartInterval: "15m",
      tickerPriceRefreshCloseRateLimitWindowMs: 180_000,
      tickerPriceRefreshCloseRateLimitMax: 9,
      tickerPriceSyncTickerCap: 40,
    });

    const config = await persistence!.getAppConfig();
    expect(config).toMatchObject({
      tickerPriceCloseRefreshGraceMinutes: 90,
      tickerPriceIntradayEnabled: false,
      tickerPriceIntradayRefreshIntervalMinutes: 10,
      tickerPriceIntradayFreshnessToleranceMinutes: 30,
      tickerPriceYahooChartRequestLimitPerMinute: 200,
      tickerPriceQueueConcurrency: 5,
      tickerPriceMaxTickersPerRefreshCycle: 150,
      tickerPriceSupportedMarkets: ["TW", "US", "KR"],
      tickerPriceRegularSessionOnly: true,
      tickerPriceYahooChartRange: "5d",
      tickerPriceYahooChartInterval: "15m",
      tickerPriceRefreshCloseRateLimitWindowMs: 180_000,
      tickerPriceRefreshCloseRateLimitMax: 9,
      tickerPriceSyncTickerCap: 40,
    });

    const raw = await pool.query<{
      ticker_price_intraday_enabled: boolean | null;
      ticker_price_supported_markets: string[] | null;
      ticker_price_yahoo_chart_range: string | null;
      ticker_price_yahoo_chart_interval: string | null;
      ticker_price_sync_ticker_cap: number | null;
    }>(
      `SELECT
         ticker_price_intraday_enabled,
         ticker_price_supported_markets,
         ticker_price_yahoo_chart_range,
         ticker_price_yahoo_chart_interval,
         ticker_price_sync_ticker_cap
       FROM public.app_config
       WHERE id = 1`,
    );

    expect(raw.rows[0]).toMatchObject({
      ticker_price_intraday_enabled: false,
      ticker_price_supported_markets: ["TW", "US", "KR"],
      ticker_price_yahoo_chart_range: "5d",
      ticker_price_yahoo_chart_interval: "15m",
      ticker_price_sync_ticker_cap: 40,
    });
  });
});
