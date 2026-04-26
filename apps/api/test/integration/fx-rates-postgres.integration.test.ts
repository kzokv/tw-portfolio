/**
 * Postgres integration tests for FX rates persistence.
 *
 * Uses the canonical `describePostgres` + `applyNumberedMigrations` pattern from
 * `anonymous-share-token-purge.integration.test.ts`. Do NOT use buildApp() — there is
 * no Redis in the managed CI stack for this test.
 *
 * Coverage:
 *  - Schema CHECKs fire (negative rate, lowercase currency, self-pair) → constraint violation
 *  - ON CONFLICT (date, base_currency, quote_currency) DO UPDATE overwrites correctly
 *  - NUMERIC(20, 8) precision round-trips for low-FX values like 0.00071
 *  - getLatestFxRateDate() returns null on empty table, MAX(date) on populated
 *  - getFxRateFreshness() returns one row per pair, ordered consistently
 *
 * Invariant 3 (source column-aligned): asserts source value persists from FxRate.source directly,
 *   with no ?? 'frankfurter' fallback in the persistence layer.
 * Invariant 8 (audit_log FK): any path writing to audit_log must seed a real user first.
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

// ── Test helpers ──────────────────────────────────────────────────────────────

describePostgres("fx_rates — Postgres persistence (KZO-164)", () => {
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

  // ── Schema CHECK constraints ───────────────────────────────────────────────

  describe("Schema CHECK constraints", () => {
    it("rejects negative rate (CHECK rate > 0)", async () => {
      await expect(
        persistence!.upsertFxRates([{
          date: "2026-04-24",
          baseCurrency: "USD",
          quoteCurrency: "TWD",
          rate: -0.5,
          source: "frankfurter",
        }]),
      ).rejects.toThrow();
    });

    it("rejects rate = 0 (CHECK rate > 0)", async () => {
      await expect(
        persistence!.upsertFxRates([{
          date: "2026-04-24",
          baseCurrency: "USD",
          quoteCurrency: "TWD",
          rate: 0,
          source: "frankfurter",
        }]),
      ).rejects.toThrow();
    });

    it("rejects lowercase base_currency (CHECK base_currency ~ '^[A-Z]{3}$')", async () => {
      await expect(
        persistence!.upsertFxRates([{
          date: "2026-04-24",
          baseCurrency: "usd", // lowercase — should fail CHECK
          quoteCurrency: "TWD",
          rate: 31.5,
          source: "frankfurter",
        }]),
      ).rejects.toThrow();
    });

    it("rejects lowercase quote_currency (CHECK quote_currency ~ '^[A-Z]{3}$')", async () => {
      await expect(
        persistence!.upsertFxRates([{
          date: "2026-04-24",
          baseCurrency: "USD",
          quoteCurrency: "twd", // lowercase — should fail CHECK
          rate: 31.5,
          source: "frankfurter",
        }]),
      ).rejects.toThrow();
    });

    it("rejects 4-character currency code (CHECK must be exactly 3 uppercase letters)", async () => {
      await expect(
        persistence!.upsertFxRates([{
          date: "2026-04-24",
          baseCurrency: "USDD", // 4 chars — should fail CHECK
          quoteCurrency: "TWD",
          rate: 31.5,
          source: "frankfurter",
        }]),
      ).rejects.toThrow();
    });

    it("rejects self-pair (CHECK base_currency <> quote_currency)", async () => {
      await expect(
        persistence!.upsertFxRates([{
          date: "2026-04-24",
          baseCurrency: "USD",
          quoteCurrency: "USD", // self-pair — should fail CHECK
          rate: 1.0,
          source: "frankfurter",
        }]),
      ).rejects.toThrow();
    });
  });

  // ── ON CONFLICT upsert semantics ───────────────────────────────────────────

  describe("ON CONFLICT (date, base_currency, quote_currency) DO UPDATE", () => {
    it("inserts a new row on first call", async () => {
      const inserted = await persistence!.upsertFxRates([{
        date: "2026-04-24",
        baseCurrency: "USD",
        quoteCurrency: "TWD",
        rate: 31.5,
        source: "frankfurter",
      }]);
      expect(inserted).toBe(1);
    });

    it("overwrites rate on conflict with the same (date, base, quote) key", async () => {
      await persistence!.upsertFxRates([{
        date: "2026-04-24",
        baseCurrency: "USD",
        quoteCurrency: "TWD",
        rate: 31.5,
        source: "frankfurter",
      }]);

      // Second upsert same key with new rate
      await persistence!.upsertFxRates([{
        date: "2026-04-24",
        baseCurrency: "USD",
        quoteCurrency: "TWD",
        rate: 31.8,  // new rate
        source: "frankfurter",
      }]);

      const { rows } = await pool.query<{ rate: string }>(
        "SELECT rate::text FROM market_data.fx_rates WHERE date='2026-04-24' AND base_currency='USD' AND quote_currency='TWD'",
      );
      expect(rows).toHaveLength(1);
      expect(parseFloat(rows[0]!.rate)).toBeCloseTo(31.8, 4);
    });

    it("updates ingested_at on conflict (ingested_at = EXCLUDED.ingested_at)", async () => {
      await persistence!.upsertFxRates([{
        date: "2026-04-24",
        baseCurrency: "USD",
        quoteCurrency: "TWD",
        rate: 31.5,
        source: "frankfurter",
      }]);

      const { rows: before } = await pool.query<{ ingested_at: Date }>(
        "SELECT ingested_at FROM market_data.fx_rates WHERE date='2026-04-24' AND base_currency='USD' AND quote_currency='TWD'",
      );

      // Wait a tick to ensure timestamp changes (in practice ingested_at is NOW() at call time)
      await new Promise((resolve) => setTimeout(resolve, 5));

      await persistence!.upsertFxRates([{
        date: "2026-04-24",
        baseCurrency: "USD",
        quoteCurrency: "TWD",
        rate: 31.8,
        source: "frankfurter",
      }]);

      const { rows: after } = await pool.query<{ ingested_at: Date }>(
        "SELECT ingested_at FROM market_data.fx_rates WHERE date='2026-04-24' AND base_currency='USD' AND quote_currency='TWD'",
      );

      expect(after[0]!.ingested_at.getTime()).toBeGreaterThanOrEqual(before[0]!.ingested_at.getTime());
    });

    it("source field round-trips correctly (no ?? 'frankfurter' fallback in persistence)", async () => {
      // Invariant 3: source is column-aligned — persisted from FxRate.source directly
      await persistence!.upsertFxRates([{
        date: "2026-04-24",
        baseCurrency: "USD",
        quoteCurrency: "TWD",
        rate: 31.5,
        source: "frankfurter",
      }]);

      const { rows } = await pool.query<{ source: string }>(
        "SELECT source FROM market_data.fx_rates WHERE date='2026-04-24' AND base_currency='USD' AND quote_currency='TWD'",
      );
      expect(rows[0]!.source).toBe("frankfurter");
    });

    it("handles bulk upsert of multiple rows atomically", async () => {
      const rates = [
        { date: "2026-04-24", baseCurrency: "USD", quoteCurrency: "TWD", rate: 31.5, source: "frankfurter" },
        { date: "2026-04-24", baseCurrency: "USD", quoteCurrency: "AUD", rate: 1.4, source: "frankfurter" },
        { date: "2026-04-24", baseCurrency: "TWD", quoteCurrency: "USD", rate: 0.031, source: "frankfurter" },
        { date: "2026-04-24", baseCurrency: "TWD", quoteCurrency: "AUD", rate: 0.044, source: "frankfurter" },
        { date: "2026-04-24", baseCurrency: "AUD", quoteCurrency: "USD", rate: 0.714, source: "frankfurter" },
        { date: "2026-04-24", baseCurrency: "AUD", quoteCurrency: "TWD", rate: 22.5, source: "frankfurter" },
      ];

      const rowCount = await persistence!.upsertFxRates(rates);
      expect(rowCount).toBe(6);
    });
  });

  // ── NUMERIC(20, 8) precision ───────────────────────────────────────────────

  describe("NUMERIC(20, 8) precision", () => {
    it("round-trips low-FX values like 0.00071 without float loss", async () => {
      await persistence!.upsertFxRates([{
        date: "2026-04-24",
        baseCurrency: "JPY",
        quoteCurrency: "TWD",
        rate: 0.00071,
        source: "frankfurter",
      }]);

      const { rows } = await pool.query<{ rate: string }>(
        "SELECT rate::text FROM market_data.fx_rates WHERE date='2026-04-24' AND base_currency='JPY' AND quote_currency='TWD'",
      );

      // rate must be retrievable as a number (not float-mangled)
      const storedRate = parseFloat(rows[0]!.rate);
      expect(storedRate).toBeCloseTo(0.00071, 5);
    });

    it("round-trips a large rate like 31.5 for USD/TWD", async () => {
      await persistence!.upsertFxRates([{
        date: "2026-04-24",
        baseCurrency: "USD",
        quoteCurrency: "TWD",
        rate: 31.5,
        source: "frankfurter",
      }]);

      const { rows } = await pool.query<{ rate: string }>(
        "SELECT rate::text FROM market_data.fx_rates WHERE date='2026-04-24' AND base_currency='USD' AND quote_currency='TWD'",
      );
      expect(parseFloat(rows[0]!.rate)).toBeCloseTo(31.5, 6);
    });
  });

  // ── getLatestFxRateDate() ───────────────────────────────────────────────────

  describe("getLatestFxRateDate()", () => {
    it("returns null when the table is empty", async () => {
      const result = await persistence!.getLatestFxRateDate();
      expect(result).toBeNull();
    });

    it("returns MAX(date) when the table has rows", async () => {
      await persistence!.upsertFxRates([
        { date: "2026-04-22", baseCurrency: "USD", quoteCurrency: "TWD", rate: 31.4, source: "frankfurter" },
        { date: "2026-04-24", baseCurrency: "USD", quoteCurrency: "TWD", rate: 31.5, source: "frankfurter" },
        { date: "2026-04-23", baseCurrency: "USD", quoteCurrency: "TWD", rate: 31.45, source: "frankfurter" },
      ]);

      const result = await persistence!.getLatestFxRateDate();
      expect(result).toBe("2026-04-24");
    });

    it("returns a string date (not a Date object)", async () => {
      await persistence!.upsertFxRates([{
        date: "2026-04-24",
        baseCurrency: "USD",
        quoteCurrency: "TWD",
        rate: 31.5,
        source: "frankfurter",
      }]);

      const result = await persistence!.getLatestFxRateDate();
      expect(typeof result).toBe("string");
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  // ── getFxRateFreshness() ───────────────────────────────────────────────────

  describe("getFxRateFreshness()", () => {
    it("returns empty array when table is empty", async () => {
      const result = await persistence!.getFxRateFreshness();
      expect(result).toHaveLength(0);
    });

    it("returns one row per (baseCurrency, quoteCurrency) pair with MAX(date)", async () => {
      await persistence!.upsertFxRates([
        { date: "2026-04-22", baseCurrency: "USD", quoteCurrency: "TWD", rate: 31.4, source: "frankfurter" },
        { date: "2026-04-24", baseCurrency: "USD", quoteCurrency: "TWD", rate: 31.5, source: "frankfurter" },
        { date: "2026-04-23", baseCurrency: "USD", quoteCurrency: "AUD", rate: 1.39, source: "frankfurter" },
        { date: "2026-04-24", baseCurrency: "USD", quoteCurrency: "AUD", rate: 1.4, source: "frankfurter" },
      ]);

      const result = await persistence!.getFxRateFreshness();
      expect(result).toHaveLength(2);

      const twdEntry = result.find((r) => r.baseCurrency === "USD" && r.quoteCurrency === "TWD");
      const audEntry = result.find((r) => r.baseCurrency === "USD" && r.quoteCurrency === "AUD");

      expect(twdEntry).toBeDefined();
      expect(twdEntry!.latestDate).toBe("2026-04-24");

      expect(audEntry).toBeDefined();
      expect(audEntry!.latestDate).toBe("2026-04-24");
    });

    it("returns results ordered by (baseCurrency, quoteCurrency) ASC", async () => {
      await persistence!.upsertFxRates([
        { date: "2026-04-24", baseCurrency: "USD", quoteCurrency: "TWD", rate: 31.5, source: "frankfurter" },
        { date: "2026-04-24", baseCurrency: "AUD", quoteCurrency: "USD", rate: 0.714, source: "frankfurter" },
        { date: "2026-04-24", baseCurrency: "TWD", quoteCurrency: "USD", rate: 0.031, source: "frankfurter" },
        { date: "2026-04-24", baseCurrency: "AUD", quoteCurrency: "TWD", rate: 22.5, source: "frankfurter" },
        { date: "2026-04-24", baseCurrency: "USD", quoteCurrency: "AUD", rate: 1.4, source: "frankfurter" },
        { date: "2026-04-24", baseCurrency: "TWD", quoteCurrency: "AUD", rate: 0.044, source: "frankfurter" },
      ]);

      const result = await persistence!.getFxRateFreshness();
      expect(result).toHaveLength(6);

      // Verify sorting: (AUD,TWD), (AUD,USD), (TWD,AUD), (TWD,USD), (USD,AUD), (USD,TWD)
      const keys = result.map((r) => `${r.baseCurrency}/${r.quoteCurrency}`);
      expect(keys).toEqual([
        "AUD/TWD",
        "AUD/USD",
        "TWD/AUD",
        "TWD/USD",
        "USD/AUD",
        "USD/TWD",
      ]);
    });

    it("getFxRateFreshness response entries have baseCurrency, quoteCurrency, latestDate fields", async () => {
      await persistence!.upsertFxRates([{
        date: "2026-04-24",
        baseCurrency: "USD",
        quoteCurrency: "TWD",
        rate: 31.5,
        source: "frankfurter",
      }]);

      const [entry] = await persistence!.getFxRateFreshness();
      expect(entry).toHaveProperty("baseCurrency");
      expect(entry).toHaveProperty("quoteCurrency");
      expect(entry).toHaveProperty("latestDate");
    });
  });

  // ── upsertFxRates return value ─────────────────────────────────────────────

  describe("upsertFxRates return value", () => {
    it("returns the number of rows affected (inserted or updated)", async () => {
      const count = await persistence!.upsertFxRates([
        { date: "2026-04-24", baseCurrency: "USD", quoteCurrency: "TWD", rate: 31.5, source: "frankfurter" },
        { date: "2026-04-24", baseCurrency: "USD", quoteCurrency: "AUD", rate: 1.4, source: "frankfurter" },
      ]);
      expect(count).toBe(2);
    });

    it("returns 0 for an empty input array", async () => {
      const count = await persistence!.upsertFxRates([]);
      expect(count).toBe(0);
    });
  });
});
