/**
 * KZO-170 — US backfill round-trip (bars only) via createBackfillHandler.
 *
 * **Scope narrowed by Phase-1 G-NC-1 resolution (Option C, 2026-05-02):**
 *   - FinMind v4 has NO `USStockDividend` dataset (HTTP 422); the US provider's
 *     `fetchDividends() => []` is intentional. US dividend ingestion lives in
 *     **KZO-187** (alternate provider).
 *   - This test exercises ONLY bars ingestion + status flip — the dividend
 *     surface is asserted (via the MockFinMindUsStockMarketDataProvider's
 *     empty fetchDividends) to confirm zero dividend rows are written.
 *
 * The companion D1/D1b currency-fix verification (US dividend with
 * `cash_dividend_currency='USD'` through the upsert SQL) lives in:
 *   - apps/api/test/unit/upserts-dividend-currency.test.ts
 *
 * Drives the backfill handler with a real `Pool` + `PostgresPersistence`,
 * mocking only the boss/eventBus/log deps. Asserts:
 *   - `market_data.daily_bars` rows have `market_code='US'` and
 *     `source='finmind-us'`.
 *   - `market_data.dividend_events` has ZERO US rows (FinMind has no US
 *     dividend feed; KZO-170's `fetchDividends() => []` is correct).
 *   - End-to-end wall-clock <30s (per ticket AC and scope-todo).
 *
 * Per `.claude/rules/integration-test-persistence-direct.md` (full pattern).
 *
 * Reserved US ticker: AAPL (us-backfill-aaa) per scope-todo D8.
 *
 * Pattern mirror: apps/api/test/integration/backfill-old-shape-rejection.integration.test.ts.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import type { JobWithMetadata } from "pg-boss";
import type { MarketCode } from "@tw-portfolio/domain";
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
const managedCiStack = process.env.TWP_MANAGED_CI_STACK === "1";

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

describePostgres("US backfill round-trip — bars only (KZO-170 D5 revised)", () => {
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

  /** Seed an AAPL US instrument so updateBackfillStatus has a row to flip. */
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

  it("backfills AAPL/US: daily_bars stamped 'finmind-us' + 'US', NO dividend rows, wall-clock <30s", async () => {
    // Dynamic import — Implementer creates this class in Phase 2.
    const { MockFinMindUsStockMarketDataProvider } = await import(
      "../../src/services/market-data/providers/index.js"
    );
    const provider = new MockFinMindUsStockMarketDataProvider();

    await seedUsInstrument("AAPL");

    const marketDataRegistry = new Map<MarketCode, typeof provider>();
    marketDataRegistry.set("US", provider);
    // KZO-172: catalog registry threaded for the handler's metadata-enrichment
    // step. The mock US provider implements `fetchInstrumentMetadata` as a no-op
    // (returns null), so the enrichment branch is a clean pass-through here.
    const catalogRegistry = new Map<MarketCode, typeof provider>();
    catalogRegistry.set("US", provider);

    const handlerDeps = {
      pool,
      marketDataRegistry,
      catalogRegistry,
      // KZO-172: real persistence delegate so the (no-op) metadata enrichment path
      // doesn't crash if the mock ever starts returning a non-null row.
      persistence: persistence!,
      eventBus: { publishEvent: vi.fn().mockResolvedValue(undefined) },
      boss: { send: vi.fn().mockResolvedValue(undefined) },
      updateBackfillStatus: async (ticker: string, status: string) => {
        await persistence!.updateBackfillStatus(ticker, status as "ready" | "backfilling" | "failed" | "pending");
      },
      getUsersMonitoringTicker: vi.fn().mockResolvedValue([]),
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    };

    const handler = createBackfillHandler(handlerDeps as never);

    const jobData = {
      ticker: "AAPL",
      marketCode: "US",
      trigger: "daily_refresh",
      startDate: "2024-01-01",
      batchId: undefined,
    } satisfies Omit<BackfillJobData, "batchId"> & { batchId?: string };

    const job: JobWithMetadata<BackfillJobData> = {
      id: randomUUID(),
      name: BACKFILL_QUEUE,
      data: jobData as BackfillJobData,
      retryCount: 0,
      retryLimit: 3,
      priority: 10,
    } as unknown as JobWithMetadata<BackfillJobData>;

    const t0 = Date.now();
    await handler([job as never]);
    const elapsedMs = Date.now() - t0;

    // ── Wall-clock assertion ───────────────────────────────────────────────
    expect(elapsedMs).toBeLessThan(30_000);

    // ── Assert daily_bars rows ─────────────────────────────────────────────
    const barsRows = await pool.query<{ ticker: string; market_code: string; source: string }>(
      `SELECT ticker, market_code, source
         FROM market_data.daily_bars
         WHERE ticker = 'AAPL' AND market_code = 'US'`,
    );
    expect(barsRows.rows.length).toBeGreaterThan(0);
    for (const row of barsRows.rows) {
      expect(row.market_code).toBe("US");
      expect(row.source).toBe("finmind-us");
    }

    // ── Assert dividend_events has ZERO US rows (FinMind has no US dividend feed; KZO-187) ─
    const divRows = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM market_data.dividend_events WHERE ticker = 'AAPL' AND market_code = 'US'`,
    );
    expect(Number(divRows.rows[0]!.count)).toBe(0);

    // ── Assert instrument status flipped to 'ready' ────────────────────────
    const instrRow = await pool.query<{ bars_backfill_status: string }>(
      `SELECT bars_backfill_status FROM market_data.instruments WHERE ticker = 'AAPL' AND market_code = 'US'`,
    );
    expect(instrRow.rows[0]!.bars_backfill_status).toBe("ready");
  });

  it("D1/D1b currency-fix regression: a manually-stamped US dividend through upsertDividendEvents lands with cash_dividend_currency='USD'", async () => {
    // **D1/D1b verified-via-TW** is in the unit test surface; this integration
    // test pins the SAME contract end-to-end through the real Postgres SQL.
    // This is the AC replacement for "AAPL captures ≥4 quarterly dividends"
    // (dropped per scope-todo D5 revised). The dividend is INJECTED, not from
    // FinMind — the Implementer's job is to make the upsert correct so KZO-187
    // can ship dividend ingestion without re-touching the upsert path.
    const { upsertDividendEvents } = await import(
      "../../src/services/market-data/upserts.js"
    );

    await seedUsInstrument("AAPL");

    const ev = {
      ticker: "AAPL",
      marketCode: "US" as MarketCode,
      exDividendDate: "2024-08-12",
      paymentDate: "2024-08-15",
      cashDividendPerShare: 0.25,
      stockDividendPerShare: 0,
      sourceId: "finmind-us",
    };
    const inserted = await upsertDividendEvents(pool, [ev]);
    expect(inserted).toBe(1);

    const divRows = await pool.query<{ market_code: string; cash_dividend_currency: string; source: string }>(
      `SELECT market_code, cash_dividend_currency, source
         FROM market_data.dividend_events
         WHERE ticker = 'AAPL' AND market_code = 'US'`,
    );
    expect(divRows.rows).toHaveLength(1);
    expect(divRows.rows[0]!.market_code).toBe("US");
    expect(divRows.rows[0]!.cash_dividend_currency).toBe("USD");
    expect(divRows.rows[0]!.source).toBe("finmind-us");
  });
});
