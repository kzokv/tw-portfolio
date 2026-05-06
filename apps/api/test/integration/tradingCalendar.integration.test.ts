import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MarketCode } from "@tw-portfolio/domain";
import { TradingCalendarCache, TTL_MS } from "../../src/services/market-data/tradingCalendar.js";

const { PostgresPersistence } = await import("../../src/persistence/postgres.js");
const { loadMigrationManifest } = await import("../../src/persistence/migrationManifest.js");

const databaseUrl = process.env.POSTGRES_TEST_DB_URL ?? process.env.DB_URL;
const redisUrl = process.env.POSTGRES_TEST_REDIS_URL ?? process.env.REDIS_URL;
const runPostgresIntegration = process.env.RUN_POSTGRES_INTEGRATION === "1";
const managedCiStack = process.env.TWP_MANAGED_CI_STACK === "1";

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

describePostgres("trading calendar persistence (Postgres)", () => {
  let pool: Pool;
  let persistence: InstanceType<typeof PostgresPersistence> | null = null;

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

  async function seedBar(ticker: string, marketCode: MarketCode, barDate: string): Promise<void> {
    await pool.query(
      `INSERT INTO market_data.daily_bars
         (ticker, market_code, bar_date, open, high, low, close, volume, source)
       VALUES ($1, $2, $3::date, 1, 1, 1, 1, 1, 'kzo173-test')
       ON CONFLICT (ticker, market_code, bar_date) DO UPDATE
         SET source = EXCLUDED.source`,
      [ticker, marketCode, barDate],
    );
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

  it("getDistinctBarDates returns ascending DISTINCT dates", async () => {
    await seedBar("KZO173-TEST-001", "TW", "2026-05-03");
    await seedBar("KZO173-TEST-002", "TW", "2026-05-01");
    await seedBar("KZO173-TEST-003", "TW", "2026-05-03");

    await expect(persistence!.getDistinctBarDates("TW", "2026-05-01")).resolves.toEqual([
      "2026-05-01",
      "2026-05-03",
    ]);
  });

  it("getDistinctBarDates honors market filter", async () => {
    await seedBar("KZO173-TEST-004", "TW", "2026-05-04");
    await seedBar("KZO173-TEST-004", "US", "2026-05-05");

    await expect(persistence!.getDistinctBarDates("US", "2026-05-01")).resolves.toEqual([
      "2026-05-05",
    ]);
  });

  it("getDistinctBarDates treats fromDate as inclusive", async () => {
    await seedBar("KZO173-TEST-005", "TW", "2026-05-01");
    await seedBar("KZO173-TEST-006", "TW", "2026-05-02");

    await expect(persistence!.getDistinctBarDates("TW", "2026-05-02")).resolves.toEqual([
      "2026-05-02",
    ]);
  });

  it("TradingCalendarCache refresh populates from real DB", async () => {
    await seedBar("KZO173-TEST-007", "TW", "2026-05-04");
    const cache = new TradingCalendarCache({ persistence: persistence! });

    await expect(cache.isTradingDay("TW", "2026-05-04")).resolves.toBe(true);
  });
});

describe("TradingCalendarCache behavior", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-06T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("notifyBarsUpserted adds cached dates without triggering a DB refresh", async () => {
    const getDistinctBarDates = vi.fn().mockResolvedValue(["2026-05-04"]);
    const cache = new TradingCalendarCache({ persistence: { getDistinctBarDates } });

    await expect(cache.getTradingDates("TW" as MarketCode)).resolves.toEqual(new Set(["2026-05-04"]));
    cache.notifyBarsUpserted("TW" as MarketCode, ["2026-05-05"]);

    await expect(cache.getTradingDates("TW" as MarketCode)).resolves.toEqual(new Set([
      "2026-05-04",
      "2026-05-05",
    ]));
    expect(getDistinctBarDates).toHaveBeenCalledTimes(1);
  });

  it("notifyBarsUpserted drops dates outside the cache horizon", async () => {
    const cache = new TradingCalendarCache({
      persistence: { getDistinctBarDates: vi.fn().mockResolvedValue(["2026-05-04"]) },
    });

    await cache.getTradingDates("TW" as MarketCode);
    cache.notifyBarsUpserted("TW" as MarketCode, ["2024-01-01", "2026-05-05"]);

    await expect(cache.getTradingDates("TW" as MarketCode)).resolves.toEqual(new Set([
      "2026-05-04",
      "2026-05-05",
    ]));
  });

  it("refreshes after TTL expires", async () => {
    const getDistinctBarDates = vi
      .fn()
      .mockResolvedValueOnce(["2026-05-04"])
      .mockResolvedValueOnce(["2026-05-05"]);
    const cache = new TradingCalendarCache({ persistence: { getDistinctBarDates } });

    await expect(cache.getTradingDates("TW" as MarketCode)).resolves.toEqual(new Set(["2026-05-04"]));
    vi.advanceTimersByTime(TTL_MS + 1);

    await expect(cache.getTradingDates("TW" as MarketCode)).resolves.toEqual(new Set(["2026-05-05"]));
    expect(getDistinctBarDates).toHaveBeenCalledTimes(2);
  });

  it("deduplicates concurrent refreshes per market", async () => {
    let resolveDates: (dates: string[]) => void = () => {};
    const pendingDates = new Promise<string[]>((resolve) => {
      resolveDates = resolve;
    });
    const getDistinctBarDates = vi.fn().mockReturnValue(pendingDates);
    const cache = new TradingCalendarCache({ persistence: { getDistinctBarDates } });

    const first = cache.getTradingDates("TW" as MarketCode);
    const second = cache.getTradingDates("TW" as MarketCode);
    resolveDates(["2026-05-04"]);

    await expect(Promise.all([first, second])).resolves.toEqual([
      new Set(["2026-05-04"]),
      new Set(["2026-05-04"]),
    ]);
    expect(getDistinctBarDates).toHaveBeenCalledTimes(1);
  });

  it("logs and returns an empty set when refresh fails", async () => {
    const log = { error: vi.fn(), warn: vi.fn() };
    const cache = new TradingCalendarCache({
      persistence: { getDistinctBarDates: vi.fn().mockRejectedValue(new Error("db unavailable")) },
      log,
    });

    await expect(cache.getTradingDates("TW" as MarketCode)).resolves.toEqual(new Set());
    expect(log.error).toHaveBeenCalledWith(
      { err: expect.any(Error), market: "TW" },
      "trading_calendar_refresh_failed",
    );
  });
});
