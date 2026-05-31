/**
 * KZO-170 (D13) — Pre-provider trade-date truncation.
 *
 * Trade dates predating `historyStartFor(market)` are **accepted** but the
 * effective backfill start is clamped to the provider's earliest available
 * date. The worker emits `log.info({ ticker, requestedStartDate, providerStartDate },
 * "pre_provider_history_truncated")` on every truncation event.
 *
 * For US: a backfill request with `tradeDate=2018-01-01` should clamp to
 * `historyStartFor("US") === "2019-06-01"` and the instrument should still
 * reach `bars_backfill_status='ready'` (not `'failed'`).
 *
 * Per `.claude/rules/integration-test-persistence-direct.md` (full pattern).
 *
 * Reserved US ticker: AAPL (us-backfill-aaa) per scope-todo D8.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import type { JobWithMetadata } from "pg-boss";
import type { MarketCode } from "@vakwen/domain";
import { PostgresPersistence } from "../../src/persistence/postgres.js";
import { loadMigrationManifest } from "../../src/persistence/migrationManifest.js";
import {
  BACKFILL_QUEUE,
  createBackfillHandler,
  type BackfillJobData,
} from "../../src/services/market-data/backfillWorker.js";

const databaseUrl = process.env.POSTGRES_TEST_DB_URL ?? process.env.DB_URL;
const redisUrl = process.env.POSTGRES_TEST_REDIS_URL ?? process.env.REDIS_URL;
const runPostgresIntegration = process.env.RUN_POSTGRES_INTEGRATION === "1";
const managedCiStack = process.env.VAKWEN_MANAGED_CI_STACK === "1";

if (runPostgresIntegration && !managedCiStack) {
  throw new Error(
    "RUN_POSTGRES_INTEGRATION=1 must be executed via npm run test:integration:full:host or npm run test:integration:full:container so the DB/Redis stack is managed automatically.",
  );
}
const shouldRunPostgresSuite =
  runPostgresIntegration && Boolean(databaseUrl) && Boolean(redisUrl);
const describePostgres = shouldRunPostgresSuite ? describe : describe.skip;

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(currentDir, "../../../../db/migrations");
const migrationManifestPromise = loadMigrationManifest(migrationsDir);

async function resetDatabase(pool: Pool): Promise<void> {
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

async function applyNumberedMigrations(pool: Pool): Promise<void> {
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

describePostgres("pre-provider trade-date truncation (KZO-170 D13)", () => {
  let pool: Pool;
  let persistence: PostgresPersistence | null = null;

  beforeEach(async () => {
    pool = new Pool({ connectionString: databaseUrl });
    await resetDatabase(pool);
    await applyNumberedMigrations(pool);
    persistence = new PostgresPersistence({
      databaseUrl: databaseUrl!,
      redisUrl: redisUrl!,
    });
    await persistence.init();
  });

  afterEach(async () => {
    if (persistence) {
      await persistence.close();
      persistence = null;
    }
    await pool.end();
  });

  async function seedUsInstrument(ticker: string): Promise<void> {
    await pool.query(
      `INSERT INTO market_data.instruments (ticker, market_code, name, instrument_type, bars_backfill_status)
       VALUES ($1, 'US', $2, 'STOCK', 'pending')
       ON CONFLICT (ticker, market_code) DO UPDATE
         SET bars_backfill_status = EXCLUDED.bars_backfill_status,
             name = EXCLUDED.name,
             instrument_type = EXCLUDED.instrument_type`,
      [ticker, `${ticker} Corp`],
    );
  }

  it("truncates startDate=2018-01-01 to 2019-06-01 for US, emits pre_provider_history_truncated, backfill still reaches 'ready'", async () => {
    const { MockFinMindUsStockMarketDataProvider } = await import(
      "../../src/services/market-data/providers/index.js"
    );
    // Mock with default fixture start (2024-01-01) — the truncated effective
    // start (2019-06-01) is still BEFORE the fixture start, so the provider
    // returns its full fixture range and the test asserts the truncation
    // happened by inspecting log.info calls + the bars range.
    const provider = new MockFinMindUsStockMarketDataProvider();
    const fetchBarsSpy = vi.spyOn(provider, "fetchBars");
    const fetchDividendsSpy = vi.spyOn(provider, "fetchDividends");

    await seedUsInstrument("AAPL");

    const marketDataRegistry = new Map<MarketCode, typeof provider>();
    marketDataRegistry.set("US", provider);
    // KZO-172: catalog registry — same instance, mock US provider's
    // `fetchInstrumentMetadata` is a no-op.
    const catalogRegistry = new Map<MarketCode, typeof provider>();
    catalogRegistry.set("US", provider);

    const logInfo = vi.fn();
    const handlerDeps = {
      pool,
      marketDataRegistry,
      catalogRegistry,
      persistence: persistence!,
      eventBus: { publishEvent: vi.fn().mockResolvedValue(undefined) },
      boss: { send: vi.fn().mockResolvedValue(undefined) },
      // KZO-189: implementation-coupled stub. trigger="user_selection" →
      // shouldEnrich=true under "conditional", matching pre-KZO-189 behavior.
      getEffectiveMetadataEnrichmentMode: vi.fn().mockResolvedValue("conditional"),
      updateBackfillStatus: async (
        ticker: string,
        marketCode: import("@vakwen/domain").MarketCode,
        status: string,
      ) => {
        await persistence!.updateBackfillStatus(
          ticker,
          marketCode,
          status as "ready" | "backfilling" | "failed" | "pending",
        );
      },
      getUsersMonitoringTicker: vi.fn().mockResolvedValue([]),
      log: { info: logInfo, warn: vi.fn(), error: vi.fn() },
    };

    const handler = createBackfillHandler(handlerDeps as never);

    const jobData: BackfillJobData = {
      ticker: "AAPL",
      marketCode: "US",
      trigger: "user_selection",
      // Pre-2019 trade date — must NOT cause failure; must clamp to 2019-06-01.
      startDate: "2018-01-01",
    };

    const job: JobWithMetadata<BackfillJobData> = {
      id: randomUUID(),
      name: BACKFILL_QUEUE,
      data: jobData,
      retryCount: 0,
      retryLimit: 3,
      priority: 5,
    } as unknown as JobWithMetadata<BackfillJobData>;

    await handler([job as never]);

    // ── Provider was called with the truncated startDate ───────────────────
    expect(fetchBarsSpy).toHaveBeenCalledTimes(1);
    const barsCall = fetchBarsSpy.mock.calls[0]!;
    expect(barsCall[1]).toBe("2019-06-01");
    expect(fetchDividendsSpy).toHaveBeenCalledTimes(1);
    const divCall = fetchDividendsSpy.mock.calls[0]!;
    expect(divCall[1]).toBe("2019-06-01");

    // ── log.info("pre_provider_history_truncated", { ticker, ... }) emitted ─
    const truncationCall = logInfo.mock.calls.find((args) =>
      args.some((arg) => typeof arg === "string" && arg === "pre_provider_history_truncated"),
    );
    expect(truncationCall).toBeDefined();
    // The structured payload includes ticker, requestedStartDate, providerStartDate.
    const payload = truncationCall!.find((a) => typeof a === "object" && a !== null) as Record<string, unknown>;
    expect(payload["ticker"]).toBe("AAPL");
    expect(payload["requestedStartDate"]).toBe("2018-01-01");
    expect(payload["providerStartDate"]).toBe("2019-06-01");

    // ── instruments.bars_backfill_status reaches 'ready' (not 'failed') ────
    const instrRow = await pool.query<{ bars_backfill_status: string }>(
      `SELECT bars_backfill_status FROM market_data.instruments WHERE ticker = 'AAPL' AND market_code = 'US'`,
    );
    expect(instrRow.rows[0]!.bars_backfill_status).toBe("ready");
  });

  it("does NOT emit pre_provider_history_truncated when startDate >= historyStartFor(market)", async () => {
    const { MockFinMindUsStockMarketDataProvider } = await import(
      "../../src/services/market-data/providers/index.js"
    );
    const provider = new MockFinMindUsStockMarketDataProvider();

    await seedUsInstrument("AAPL");

    const marketDataRegistry = new Map<MarketCode, typeof provider>();
    marketDataRegistry.set("US", provider);
    // KZO-172: catalog registry — same instance, mock US provider's
    // `fetchInstrumentMetadata` is a no-op.
    const catalogRegistry = new Map<MarketCode, typeof provider>();
    catalogRegistry.set("US", provider);

    const logInfo = vi.fn();
    const handlerDeps = {
      pool,
      marketDataRegistry,
      catalogRegistry,
      persistence: persistence!,
      eventBus: { publishEvent: vi.fn().mockResolvedValue(undefined) },
      boss: { send: vi.fn().mockResolvedValue(undefined) },
      // KZO-189: implementation-coupled stub. trigger="user_selection" →
      // shouldEnrich=true under "conditional", matching pre-KZO-189 behavior.
      getEffectiveMetadataEnrichmentMode: vi.fn().mockResolvedValue("conditional"),
      updateBackfillStatus: async (
        ticker: string,
        marketCode: import("@vakwen/domain").MarketCode,
        status: string,
      ) => {
        await persistence!.updateBackfillStatus(
          ticker,
          marketCode,
          status as "ready" | "backfilling" | "failed" | "pending",
        );
      },
      getUsersMonitoringTicker: vi.fn().mockResolvedValue([]),
      log: { info: logInfo, warn: vi.fn(), error: vi.fn() },
    };

    const handler = createBackfillHandler(handlerDeps as never);

    const jobData: BackfillJobData = {
      ticker: "AAPL",
      marketCode: "US",
      trigger: "user_selection",
      // Trade date AFTER 2019-06-01 — no truncation needed.
      startDate: "2024-06-01",
    };

    const job: JobWithMetadata<BackfillJobData> = {
      id: randomUUID(),
      name: BACKFILL_QUEUE,
      data: jobData,
      retryCount: 0,
      retryLimit: 3,
      priority: 5,
    } as unknown as JobWithMetadata<BackfillJobData>;

    await handler([job as never]);

    // No truncation log.
    const truncationCall = logInfo.mock.calls.find((args) =>
      args.some((arg) => typeof arg === "string" && arg === "pre_provider_history_truncated"),
    );
    expect(truncationCall).toBeUndefined();
  });
});
