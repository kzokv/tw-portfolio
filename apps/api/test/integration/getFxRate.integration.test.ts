/**
 * KZO-166 — Senior QA Phase 1 (Tier 2 parallel).
 *
 * Postgres integration tests for `persistence.getFxRate(base, quote, asOfDate)`.
 *
 * Coverage (§5c of architect-design.md):
 *   - Self-pair shortcut returns 1.0 without a DB query (empty table still returns 1.0)
 *   - Forward-fill: Monday's rate is returned when querying Saturday
 *   - Exact-date match: querying a date that has a row returns that row's rate
 *   - Missing rate (no rows for pair) → null
 *   - Missing rate (all rows after asOfDate) → null
 *   - Numeric precision round-trip: 0.00071 and 31.5 survive NUMERIC(20, 8) storage
 *
 * Tests are TDD-red until the Implementer adds `getFxRate` to the
 * `Persistence` interface and implements it in `PostgresPersistence`.
 *
 * Pattern: full pattern (scoped pool + applyNumberedMigrations + PostgresPersistence direct)
 * per `.claude/rules/integration-test-persistence-direct.md`.
 * Does NOT use buildApp() — no Redis in the managed CI stack for integration tests.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const { PostgresPersistence } = await import("../../src/persistence/postgres.js");
const { loadMigrationManifest } = await import("../../src/persistence/migrationManifest.js");

// ── Postgres integration guard ────────────────────────────────────────────────

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

// ── Test suite ────────────────────────────────────────────────────────────────

describePostgres("getFxRate — Postgres integration (KZO-166)", () => {
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
        const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
        await client.query(sql);
      }
    } finally {
      client.release();
    }
  }

  /** Seed a single FX rate row directly via the persistence upsert. */
  async function seedRate(
    date: string,
    base: string,
    quote: string,
    rate: number,
  ): Promise<void> {
    await persistence!.upsertFxRates([{ date, baseCurrency: base, quoteCurrency: quote, rate, source: "frankfurter" }]);
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

  // ── Self-pair shortcut ───────────────────────────────────────────────────────

  it("self-pair (USD/USD) returns 1.0 even with empty table (no DB query needed)", async () => {
    // §5c self-pair shortcut: base === quote → 1.0 without touching market_data.fx_rates.
    // The table is empty, so any real DB query would return null — this proves the shortcut fires.
    const result = await persistence!.getFxRate("USD", "USD", "2026-04-26");
    expect(result).toBe(1.0);
  });

  it("self-pair (TWD/TWD) returns 1.0 even with empty table", async () => {
    // Self-pair shortcut applies to ANY currency code, not just USD.
    const result = await persistence!.getFxRate("TWD", "TWD", "2026-04-26");
    expect(result).toBe(1.0);
  });

  // ── Forward-fill semantics ────────────────────────────────────────────────────

  it("forward-fill: Monday rate is returned when querying Saturday (§5c)", async () => {
    // Seed rate on Monday 2026-04-20 only. Query Saturday 2026-04-25.
    // Forward-fill: latest rate at or before asOfDate → Monday's rate.
    await seedRate("2026-04-20", "TWD", "USD", 0.031);

    const result = await persistence!.getFxRate("TWD", "USD", "2026-04-25");
    expect(result).not.toBeNull();
    expect(result).toBeCloseTo(0.031, 6);
  });

  it("forward-fill: returns the closest earlier date when multiple prior dates exist", async () => {
    // Three rates seeded; query a date after all of them → should return the most recent.
    await seedRate("2026-04-20", "TWD", "USD", 0.031);
    await seedRate("2026-04-22", "TWD", "USD", 0.0312);
    await seedRate("2026-04-24", "TWD", "USD", 0.0315);

    // Query 2026-04-26 (after all seeded dates)
    const result = await persistence!.getFxRate("TWD", "USD", "2026-04-26");
    expect(result).not.toBeNull();
    expect(result).toBeCloseTo(0.0315, 6);  // latest = 2026-04-24
  });

  // ── Exact-date match ──────────────────────────────────────────────────────────

  it("exact-date match: returns the seeded rate when asOfDate matches exactly (§5c)", async () => {
    // Five consecutive days. Query each — must return that day's rate, not a neighbour.
    const dates = [
      { date: "2026-04-20", rate: 0.0310 },
      { date: "2026-04-21", rate: 0.0311 },
      { date: "2026-04-22", rate: 0.0312 },
      { date: "2026-04-23", rate: 0.0313 },
      { date: "2026-04-24", rate: 0.0314 },
    ];

    for (const { date, rate } of dates) {
      await seedRate(date, "TWD", "USD", rate);
    }

    for (const { date, rate } of dates) {
      const result = await persistence!.getFxRate("TWD", "USD", date);
      expect(result).not.toBeNull();
      expect(result).toBeCloseTo(rate, 6);
    }
  });

  // ── Missing rate cases ────────────────────────────────────────────────────────

  it("returns null when no rows exist for the pair (§5c missing-rate case)", async () => {
    // Table is empty. No rows for TWD/USD.
    const result = await persistence!.getFxRate("TWD", "USD", "2026-04-26");
    expect(result).toBeNull();
  });

  it("returns null when all rows for the pair are after asOfDate (§5c)", async () => {
    // Seed a rate on 2026-04-25. Query 2026-04-20 (before the only row).
    // No row at or before asOfDate → null.
    await seedRate("2026-04-25", "TWD", "USD", 0.031);

    const result = await persistence!.getFxRate("TWD", "USD", "2026-04-20");
    expect(result).toBeNull();
  });

  it("returns null for a pair that has no rows even if other pairs have rows", async () => {
    // Seed USD/AUD but query TWD/USD — different pair, should return null.
    await seedRate("2026-04-24", "USD", "AUD", 1.55);

    const result = await persistence!.getFxRate("TWD", "USD", "2026-04-24");
    expect(result).toBeNull();
  });

  // ── Numeric precision round-trip ─────────────────────────────────────────────

  it("numeric precision: 0.00071 round-trips through NUMERIC(20,8) without float loss (§5c)", async () => {
    // Low TWD/USD-equivalent rate for JPY context — verifies NUMERIC(20,8) precision.
    await seedRate("2026-04-24", "JPY", "TWD", 0.00071);

    const result = await persistence!.getFxRate("JPY", "TWD", "2026-04-24");
    expect(result).not.toBeNull();
    expect(result).toBeCloseTo(0.00071, 5);
  });

  it("numeric precision: 31.5 round-trips through NUMERIC(20,8) (§5c)", async () => {
    await seedRate("2026-04-24", "USD", "TWD", 31.5);

    const result = await persistence!.getFxRate("USD", "TWD", "2026-04-24");
    expect(result).not.toBeNull();
    expect(result).toBeCloseTo(31.5, 6);
  });

  it("result is a JS number, not a string — pg NUMERIC coercion (D12)", async () => {
    // The pg driver returns NUMERIC as a string. The Implementer must parse it.
    // This assertion catches the coercion gap.
    await seedRate("2026-04-24", "USD", "TWD", 31.5);
    const result = await persistence!.getFxRate("USD", "TWD", "2026-04-24");
    expect(typeof result).toBe("number");
    expect(result).toBeCloseTo(31.5, 6);
  });

  it("derives inverse rates when the direct pair is absent", async () => {
    await seedRate("2026-04-24", "USD", "TWD", 31.5);

    const result = await persistence!.getFxRate("TWD", "USD", "2026-04-24");

    expect(result).not.toBeNull();
    expect(result).toBeCloseTo(1 / 31.5, 8);
  });

  it("derives cross-currency rates through TWD when direct and inverse pairs are absent", async () => {
    await seedRate("2026-04-24", "USD", "TWD", 32.5);
    await seedRate("2026-04-24", "KRW", "TWD", 0.025);

    const result = await persistence!.getFxRate("USD", "KRW", "2026-04-24");

    expect(result).not.toBeNull();
    expect(result).toBeCloseTo(1300, 6);
  });
});
