/**
 * KZO-185 (D3 / integration): Old-shape job rejection via Zod validation.
 *
 * Verifies that `createBackfillHandler` throws `ZodError` when `job.data` is
 * missing `marketCode` (pre-KZO-169 in-flight jobs) and that NO side effects
 * occur — no rows written to `market_data.daily_bars`, `instruments.bars_backfill_status`
 * unchanged, no SSE events published, no reschedule boss.send fired.
 *
 * Per `.claude/rules/integration-test-persistence-direct.md`:
 *   Uses `PostgresPersistence` directly — NOT `buildApp` (which eagerly connects
 *   to Redis for pg-boss, the session store, and rate limiting, causing
 *   ECONNREFUSED when the managed test stack has no Redis).
 *
 * Pattern: full pattern with explicit pool, resetDatabase, applyNumberedMigrations.
 * Reference: `apps/api/test/integration/catalogSync.integration.test.ts`.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
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

// ── Postgres integration gate ─────────────────────────────────────────────────
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

describePostgres("backfill handler — old-shape job rejection (KZO-185)", () => {
  let pool: Pool;
  let persistence: PostgresPersistence | null = null;
  let userId: string;

  beforeEach(async () => {
    pool = new Pool({ connectionString: databaseUrl });
    await resetDatabase(pool);
    await applyNumberedMigrations(pool);

    persistence = new PostgresPersistence({
      databaseUrl: databaseUrl!,
      redisUrl: redisUrl!,
    });
    await persistence.init();

    // Resolve the seeded user ID from the default persistence state.
    const store = await persistence.loadStore("user-1");
    userId = store.userId;
  });

  afterEach(async () => {
    if (persistence) {
      await persistence.close();
      persistence = null;
    }
    await pool.end();
  });

  /** Seed a minimal instrument row so we can verify bars_backfill_status later. */
  async function seedInstrument(ticker: string, marketCode: string): Promise<void> {
    await pool.query(
      `INSERT INTO market_data.instruments (ticker, market_code, name, instrument_type, bars_backfill_status)
       VALUES ($1, $2, $3, 'STOCK', 'ready')
       ON CONFLICT (ticker, market_code) DO UPDATE
         SET bars_backfill_status = EXCLUDED.bars_backfill_status,
             name = EXCLUDED.name,
             instrument_type = EXCLUDED.instrument_type`,
      [ticker, marketCode, `${ticker} Corp`],
    );
  }

  /**
   * Build minimal mock deps for createBackfillHandler (real pool, mocked everything else).
   *
   * Intentionally uses narrower shapes than `BackfillWorkerDeps` requires:
   * - `eventBus` exposes only `publishEvent` (not full `BufferedEventBus`)
   * - `boss` exposes only `send` (not full `PgBoss`)
   * - `provider` is an extra field (not in the interface) for spy assertions
   *
   * This is acceptable because ALL tests in this suite exercise ONLY the Zod parse
   * rejection path — the `BackfillJobDataSchema.parse` fires BEFORE the `try` block,
   * so no side-effect dep (`eventBus`, `boss`, `pool.query`, `updateBackfillStatus`,
   * provider methods) is ever reached. The `as never` casts at each call site silence
   * TypeScript for this intentional narrowing.
   */
  function buildHandlerDeps(handlerPool: Pool) {
    const provider = {
      reserveCapacity: vi.fn(),
      fetchBars: vi.fn().mockResolvedValue([]),
      fetchDividends: vi.fn().mockResolvedValue([]),
    };
    const marketDataRegistry = new Map<MarketCode, typeof provider>();
    marketDataRegistry.set("TW", provider);

    return {
      pool: handlerPool,
      provider,
      marketDataRegistry,
      eventBus: { publishEvent: vi.fn().mockResolvedValue(undefined) },
      boss: { send: vi.fn().mockResolvedValue(undefined) },
      updateBackfillStatus: vi.fn().mockResolvedValue(undefined),
      getUsersMonitoringTicker: vi.fn().mockResolvedValue([]),
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    };
  }

  it("throws ZodError for old-shape job.data missing marketCode (no side effects)", async () => {
    const ticker = "2330";
    const marketCode = "TW";

    // Seed an instrument so we can assert bars_backfill_status is not mutated.
    await seedInstrument(ticker, marketCode);

    const handlerDeps = buildHandlerDeps(pool);
    const handler = createBackfillHandler(handlerDeps as never);

    // Old-shape job: `trigger` and `ticker` present, `marketCode` absent.
    // This mirrors a pre-KZO-169 in-flight pg-boss job where the producer
    // hadn't started stamping `marketCode` yet.
    const oldShapeJob: JobWithMetadata<Record<string, unknown>> = {
      id: randomUUID(),
      name: BACKFILL_QUEUE,
      data: { ticker, userId: userId, trigger: "daily_refresh" },  // no marketCode
      retryCount: 0,
      retryLimit: 3,
      priority: 10,
    } as unknown as JobWithMetadata<Record<string, unknown>>;

    // Handler must throw ZodError — the parse is BEFORE the try block so
    // pg-boss sees the error and applies its retry policy.
    await expect(handler([oldShapeJob as never])).rejects.toThrow(ZodError);

    // ── No rows written to market_data.daily_bars ─────────────────────────
    const barsRow = await pool.query<{ cnt: string }>(
      `SELECT COUNT(*) AS cnt FROM market_data.daily_bars WHERE ticker = $1`,
      [ticker],
    );
    expect(Number(barsRow.rows[0]!.cnt)).toBe(0);

    // ── instruments.bars_backfill_status unchanged ('ready') ──────────────
    const instrRow = await pool.query<{ bars_backfill_status: string }>(
      `SELECT bars_backfill_status FROM market_data.instruments WHERE ticker = $1 AND market_code = $2`,
      [ticker, marketCode],
    );
    expect(instrRow.rows).toHaveLength(1);
    expect(instrRow.rows[0]!.bars_backfill_status).toBe("ready");

    // ── No SSE events published ───────────────────────────────────────────
    expect(handlerDeps.eventBus.publishEvent).not.toHaveBeenCalled();

    // ── No updateBackfillStatus calls (the status write is inside the try) ─
    expect(handlerDeps.updateBackfillStatus).not.toHaveBeenCalled();

    // ── No reschedule boss.send (rate-limit path never reached) ──────────
    expect(handlerDeps.boss.send).not.toHaveBeenCalled();

    // ── Provider never called (parse fails before provider lookup) ────────
    expect(handlerDeps.provider.fetchBars).not.toHaveBeenCalled();
    expect(handlerDeps.provider.fetchDividends).not.toHaveBeenCalled();
  });

  it("throws ZodError for old-shape job.data with invalid marketCode value", async () => {
    const handlerDeps = buildHandlerDeps(pool);
    const handler = createBackfillHandler(handlerDeps as never);

    // Hypothetical future producer that stamps a wrong/unsupported market code.
    const badMarketJob: JobWithMetadata<Record<string, unknown>> = {
      id: randomUUID(),
      name: BACKFILL_QUEUE,
      data: { ticker: "2330", marketCode: "JP", trigger: "daily_refresh" } satisfies Omit<BackfillJobData, "marketCode"> & { marketCode: string },
      retryCount: 0,
      retryLimit: 3,
      priority: 5,
    } as unknown as JobWithMetadata<Record<string, unknown>>;

    await expect(handler([badMarketJob as never])).rejects.toThrow(ZodError);

    // No side effects
    expect(handlerDeps.eventBus.publishEvent).not.toHaveBeenCalled();
    expect(handlerDeps.updateBackfillStatus).not.toHaveBeenCalled();
    expect(handlerDeps.boss.send).not.toHaveBeenCalled();
  });
});
