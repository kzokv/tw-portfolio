// vi.mock is hoisted before imports by Vitest. Override getDatabaseUrl/getRedisUrl
// so buildApp picks up POSTGRES_TEST_DB_URL / POSTGRES_TEST_REDIS_URL (the vars the
// managed CI stack exports) rather than the frozen Env.DB_URL parsed at module load time.
vi.mock("@vakwen/config", async (importOriginal) => {
  const original = await importOriginal<typeof import("@vakwen/config")>();
  return {
    ...original,
    Env: {
      ...original.Env,
      getDatabaseUrl: () =>
        process.env.POSTGRES_TEST_DB_URL ??
        process.env.DB_URL ??
        original.Env.getDatabaseUrl(),
      getRedisUrl: () =>
        process.env.POSTGRES_TEST_REDIS_URL ??
        process.env.REDIS_URL ??
        original.Env.getRedisUrl(),
    },
  };
});

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../src/app.js";
import { loadMigrationManifest } from "../../src/persistence/migrationManifest.js";

// ── Postgres gate ─────────────────────────────────────────────────────────────

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

// ── Migration setup ───────────────────────────────────────────────────────────

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(currentDir, "../../../../db/migrations");
const migrationManifestPromise = loadMigrationManifest(migrationsDir);

// ── Test suite ────────────────────────────────────────────────────────────────

describePostgres("app_config — repair cooldown + DTO field (Postgres)", () => {
  let pool: Pool;
  let app: Awaited<ReturnType<typeof buildApp>>;

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

  /** Seed the test user that dev_bypass auth uses ("user-1"). */
  async function seedUser(userId = "user-1"): Promise<void> {
    await pool.query(
      `INSERT INTO users (id, email, locale, cost_basis_method, quote_poll_interval_seconds)
       VALUES ($1, $2, 'en', 'WEIGHTED_AVERAGE', 10)
       ON CONFLICT (id) DO NOTHING`,
      [userId, `${userId}@test.example`],
    );
  }

  /** Seed a minimal instrument row. */
  async function seedInstrument(params: {
    ticker: string;
    marketCode?: string;
    name?: string;
    lastRepairAt?: string | null;
    barsBackfillStatus?: string;
  }): Promise<void> {
    await pool.query(
      `INSERT INTO market_data.instruments
         (ticker, name, market_code, bars_backfill_status, last_repair_at)
       VALUES ($1, $2, $3, $4, $5::timestamptz)
       ON CONFLICT (ticker, market_code) DO UPDATE
         SET name = EXCLUDED.name,
             bars_backfill_status = EXCLUDED.bars_backfill_status,
             last_repair_at = EXCLUDED.last_repair_at`,
      [
        params.ticker,
        params.name ?? params.ticker,
        params.marketCode ?? "TW",
        params.barsBackfillStatus ?? "ready",
        params.lastRepairAt ?? null,
      ],
    );
  }

  /** Seed a manual monitored-ticker entry for user-1. */
  async function seedMonitoredTicker(ticker: string, userId = "user-1", marketCode = "TW"): Promise<void> {
    await pool.query(
      `INSERT INTO user_monitored_tickers (user_id, ticker, market_code)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, ticker, market_code) DO NOTHING`,
      [userId, ticker, marketCode],
    );
  }

  beforeEach(async () => {
    pool = new Pool({ connectionString: databaseUrl });
    await resetDatabase();
    await applyNumberedMigrations();
    // Build against the real Postgres backend using managed CI stack env vars.
    // AUTH_MODE=dev_bypass (set by vitest config) so routes use userId="user-1" without cookies.
    app = await buildApp({ persistenceBackend: "postgres", registerWorkers: false });
    // seedDefaults() (called inside buildApp init) upserts 4 default instruments.
    // Clear them so each test starts from a known-empty instruments table.
    await pool.query("DELETE FROM market_data.instruments");
  });

  afterEach(async () => {
    if (app) await app.close();
    await pool.end();
  });

  // ── POST /backfill/repair — effective cooldown source ─────────────────────

  describe("POST /backfill/repair — effective cooldown source", () => {
    it("honors DB value when app_config.repair_cooldown_minutes is set: queues ticker outside DB window", async () => {
      // DB cooldown = 5 min; last repair = 10 min ago → cooldown expired → QUEUED
      // If env (60 min) were used, 10 < 60 and it would be REJECTED
      await pool.query("UPDATE public.app_config SET repair_cooldown_minutes = 5 WHERE id = 1");
      await seedInstrument({
        ticker: "2330",
        barsBackfillStatus: "ready",
        lastRepairAt: new Date(Date.now() - 10 * 60_000).toISOString(),
      });

      const send = vi.fn().mockResolvedValue(undefined);
      (app as unknown as { boss: { send: (...args: unknown[]) => Promise<void> } }).boss = { send };

      const response = await app.inject({
        method: "POST",
        url: "/backfill/repair",
        payload: { tickers: ["2330"] },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ queued: string[]; rejected: unknown[] }>();
      expect(body.queued).toContain("2330");
      expect(body.rejected).toHaveLength(0);
      expect(send).toHaveBeenCalledTimes(1);
    });

    it("honors DB value when app_config.repair_cooldown_minutes is set: blocks ticker within DB window", async () => {
      // DB cooldown = 15 min; last repair = 10 min ago → 5 min remaining → REJECTED
      await pool.query("UPDATE public.app_config SET repair_cooldown_minutes = 15 WHERE id = 1");
      await seedInstrument({
        ticker: "2330",
        barsBackfillStatus: "ready",
        lastRepairAt: new Date(Date.now() - 10 * 60_000).toISOString(),
      });

      const send = vi.fn().mockResolvedValue(undefined);
      (app as unknown as { boss: { send: (...args: unknown[]) => Promise<void> } }).boss = { send };

      const response = await app.inject({
        method: "POST",
        url: "/backfill/repair",
        payload: { tickers: ["2330"] },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ queued: string[]; rejected: Array<{ ticker: string; reason: string }> }>();
      expect(body.queued).toHaveLength(0);
      expect(body.rejected[0]).toMatchObject({
        ticker: "2330",
        reason: expect.stringMatching(/^cooldown_active:/),
      });
      expect(send).not.toHaveBeenCalled();
    });

    it("falls back to env (60 min) when app_config.repair_cooldown_minutes is NULL — blocks ticker at 10 min elapsed", async () => {
      // NULL → env fallback = 60 min; 10 min elapsed → 50 min remaining → REJECTED
      await pool.query("UPDATE public.app_config SET repair_cooldown_minutes = NULL WHERE id = 1");
      await seedInstrument({
        ticker: "2317",
        barsBackfillStatus: "ready",
        lastRepairAt: new Date(Date.now() - 10 * 60_000).toISOString(),
      });

      const send = vi.fn().mockResolvedValue(undefined);
      (app as unknown as { boss: { send: (...args: unknown[]) => Promise<void> } }).boss = { send };

      const response = await app.inject({
        method: "POST",
        url: "/backfill/repair",
        payload: { tickers: ["2317"] },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ queued: string[]; rejected: Array<{ ticker: string; reason: string }> }>();
      expect(body.queued).toHaveLength(0);
      expect(body.rejected[0]).toMatchObject({
        ticker: "2317",
        reason: expect.stringMatching(/^cooldown_active:/),
      });
    });

    it("falls back to env when app_config row is missing — emits a warning and blocks normally", async () => {
      // Remove the config row; persistence should warn and return null → env fallback
      await pool.query("DELETE FROM public.app_config WHERE id = 1");
      await seedInstrument({
        ticker: "0050",
        barsBackfillStatus: "ready",
        lastRepairAt: new Date(Date.now() - 10 * 60_000).toISOString(),
      });

      const warnSpy = vi.spyOn(console, "warn");
      const send = vi.fn().mockResolvedValue(undefined);
      (app as unknown as { boss: { send: (...args: unknown[]) => Promise<void> } }).boss = { send };

      const response = await app.inject({
        method: "POST",
        url: "/backfill/repair",
        payload: { tickers: ["0050"] },
      });

      expect(response.statusCode).toBe(200);
      // With env fallback (60 min), 10 min elapsed → still blocked
      const body = response.json<{ queued: string[]; rejected: Array<{ ticker: string; reason: string }> }>();
      expect(body.rejected[0]).toMatchObject({
        ticker: "0050",
        reason: expect.stringMatching(/^cooldown_active:/),
      });
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringMatching(/app_config.*missing.*falling back/i),
      );

      warnSpy.mockRestore();
    });
  });

  // ── GET /instruments — repairAvailableAt field ────────────────────────────

  describe("GET /instruments — repairAvailableAt field", () => {
    it("returns repairAvailableAt: null when last_repair_at is NULL", async () => {
      await seedInstrument({ ticker: "2330", lastRepairAt: null });

      const response = await app.inject({ method: "GET", url: "/instruments" });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ instruments: Array<{ ticker: string; repairAvailableAt: string | null }> }>();
      const item = body.instruments.find((i) => i.ticker === "2330");
      expect(item).toBeDefined();
      expect(item!.repairAvailableAt).toBeNull();
    });

    it("returns repairAvailableAt as ISO string = last_repair_at + effectiveCooldown when last_repair_at is set", async () => {
      // Use a fixed timestamp so we can assert the exact result
      const fixedRepairAt = "2026-01-15T08:00:00.000Z";
      await pool.query("UPDATE public.app_config SET repair_cooldown_minutes = 30 WHERE id = 1");
      await seedInstrument({ ticker: "2330", lastRepairAt: fixedRepairAt });

      const response = await app.inject({ method: "GET", url: "/instruments" });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ instruments: Array<{ ticker: string; repairAvailableAt: string | null }> }>();
      const item = body.instruments.find((i) => i.ticker === "2330");
      expect(item).toBeDefined();
      expect(item!.repairAvailableAt).not.toBeNull();
      // 2026-01-15T08:00:00Z + 30 min = 2026-01-15T08:30:00Z
      const availableAt = new Date(item!.repairAvailableAt!);
      const expectedAt = new Date("2026-01-15T08:30:00.000Z");
      expect(availableAt.getTime()).toBe(expectedAt.getTime());
    });

    it("includes repairAvailableAt on every item in a multi-instrument response", async () => {
      await seedInstrument({ ticker: "2330", lastRepairAt: null });
      await seedInstrument({ ticker: "2317", lastRepairAt: "2026-01-15T08:00:00.000Z" });

      const response = await app.inject({ method: "GET", url: "/instruments" });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ instruments: Array<{ ticker: string; repairAvailableAt: string | null }> }>();
      // KZO-194: `persistence.init()` plus the post-deploy catalog-sync startup-tick
      // pre-populate `instruments` beyond just the 2 explicitly seeded here. The
      // behavior under test is "every item carries the repairAvailableAt key" — the
      // exact count is incidental. Assert both seeded tickers are present and the
      // field invariant holds for ALL returned rows.
      expect(body.instruments.length).toBeGreaterThanOrEqual(2);
      const tickers = body.instruments.map((i) => i.ticker);
      expect(tickers).toContain("2330");
      expect(tickers).toContain("2317");
      // Every item should have the repairAvailableAt key (even if null)
      for (const item of body.instruments) {
        expect(item).toHaveProperty("repairAvailableAt");
      }
    });
  });

  // ── GET /monitored-tickers — repairAvailableAt field ─────────────────────

  describe("GET /monitored-tickers — repairAvailableAt field", () => {
    it("returns repairAvailableAt: null when last_repair_at is NULL", async () => {
      await seedUser();
      await seedInstrument({ ticker: "2330", lastRepairAt: null });
      await seedMonitoredTicker("2330");

      const response = await app.inject({ method: "GET", url: "/monitored-tickers" });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ tickers: Array<{ ticker: string; repairAvailableAt: string | null }> }>();
      const item = body.tickers.find((t) => t.ticker === "2330");
      expect(item).toBeDefined();
      expect(item!.repairAvailableAt).toBeNull();
    });

    it("returns repairAvailableAt as ISO string = last_repair_at + effectiveCooldown when last_repair_at is set", async () => {
      const fixedRepairAt = "2026-01-15T08:00:00.000Z";
      await pool.query("UPDATE public.app_config SET repair_cooldown_minutes = 30 WHERE id = 1");
      await seedUser();
      await seedInstrument({ ticker: "2330", lastRepairAt: fixedRepairAt });
      await seedMonitoredTicker("2330");

      const response = await app.inject({ method: "GET", url: "/monitored-tickers" });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ tickers: Array<{ ticker: string; repairAvailableAt: string | null }> }>();
      const item = body.tickers.find((t) => t.ticker === "2330");
      expect(item).toBeDefined();
      expect(item!.repairAvailableAt).not.toBeNull();
      const availableAt = new Date(item!.repairAvailableAt!);
      const expectedAt = new Date("2026-01-15T08:30:00.000Z");
      expect(availableAt.getTime()).toBe(expectedAt.getTime());
    });
  });
});
