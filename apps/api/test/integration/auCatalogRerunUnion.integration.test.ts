/**
 * KZO-197 — Integration test for the AU `yahoo-finance-au` rerun "union" path.
 *
 * Asserts route-level behavior: clicking "Re-run now" for `yahoo-finance-au`
 * triggers BOTH (a) catalog warm-up over `instruments` rows where
 * `barsBackfillStatus IN ('pending','failed') AND marketCode='AU' AND delistedAt IS NULL`
 * AND (b) the existing monitored-AU refresh. Sets are disjoint by definition.
 *
 * Audit metadata shape (yahoo-finance-au only):
 *   {
 *     providerId, marketCode: "AU",
 *     tickerCount: <sum>, jobId: <first non-null>,
 *     catalogBackfill: { tickerCount, jobId },
 *     monitoredRefresh: { tickerCount, jobId }
 *   }
 *
 * Memory backend route-integration: `app.boss === null` so neither helper
 * dispatches actual jobs. The route still stamps cooldown + audit metadata
 * end-to-end with the candidate counts derived from
 * `listAuCatalogBarsBackfillCandidates()` and `getAllMonitoredTickers()`.
 *
 * Per `.claude/rules/integration-test-persistence-direct.md`: route HTTP
 * tests do NOT require Postgres — `buildApp({persistenceBackend:"memory"})`
 * is the canonical pattern (mirrors `admin-management.integration.test.ts`).
 *
 * Reserved tickers per `.claude/rules/e2e-shared-memory-bars-ticker-hygiene.md`:
 *   AUWARM01–AUWARM07 (this file).
 *
 * RED until Backend Implementer ships:
 *   • POST /admin/providers/yahoo-finance-au/rerun branch with union dispatch
 *   • enqueueAuCatalogBarsBackfill helper
 *   • Audit metadata nested-shape append
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Force oauth mode so resolveUserId enforces session cookie (admin role guard).
vi.mock("@vakwen/config", async (importOriginal) => {
  const original = await importOriginal<typeof import("@vakwen/config")>();
  return {
    ...original,
    Env: { ...original.Env, AUTH_MODE: "oauth" as const },
  };
});

const { buildApp } = await import("../../src/app.js");
const { signSessionCookie } = await import("../../src/auth/googleOAuth.js");

type BuiltApp = Awaited<ReturnType<typeof buildApp>>;

const testOAuthConfig = {
  clientId: "test-client-id",
  clientSecret: "test-client-secret",
  redirectUri: "http://localhost:4000/auth/google/callback",
  sessionSecret: "test-session-secret-that-is-long-enough-32chars!!",
};
const SESSION_COOKIE_NAME = "g_auth_session";

async function createAdmin(app: BuiltApp): Promise<{ userId: string; cookie: string }> {
  const { userId } = await app.persistence.resolveOrCreateUser("google", "kzo197-admin-sub", {
    email: "kzo197-admin@example.com",
    name: "KZO-197 Admin",
  });
  await app.persistence.changeUserRole(userId, "admin", { actorUserId: "system" });
  const user = await app.persistence.getAuthUserById(userId);
  const cookie = signSessionCookie(userId, testOAuthConfig.sessionSecret, user!.sessionVersion);
  return { userId, cookie };
}

async function seedCatalogPending(app: BuiltApp, tickers: string[], marketCode = "AU"): Promise<void> {
  // Use the memory test helper to seed market instruments with `barsBackfillStatus="pending"`.
  for (const ticker of tickers) {
    (app.persistence as unknown as {
      _seedInstrument: (i: {
        ticker: string;
        name: string | null;
        instrumentType: string | null;
        marketCode: string;
        barsBackfillStatus: string;
      }) => void;
    })._seedInstrument({
      ticker,
      name: `${ticker} Ltd`,
      instrumentType: "STOCK",
      marketCode,
      barsBackfillStatus: "pending",
    });
  }
}

describe("KZO-197 — AU rerun union (catalog warm-up + monitored refresh)", () => {
  let app: BuiltApp;

  beforeEach(async () => {
    app = await buildApp({ persistenceBackend: "memory", oauthConfig: testOAuthConfig });
    // Provider must exist for the route's 404 gate to pass.
    await app.persistence.upsertProviderHealthStatus({
      providerId: "yahoo-finance-au",
      status: "down",
      lastSuccessfulRun: null,
      lastFailedRun: null,
      lastManualRerunAt: null,
    });
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it("fresh-deploy AU (memory mode): nested keys present, tickerCount=0 (no dispatch)", async () => {
    // Per locked scope-todo line 23 + ARCHITECT:RULING-CONFIRMED:
    // "Memory-backend behavior preserved — `app.boss === null` skips dispatch
    // in both new branches but still stamps cooldown + audit. tickerCount=0,
    // jobId=null." This mirrors TW/US/Frankfurter precedent — tickerCount is
    // "jobs actually dispatched," not "candidates that exist." The fresh-deploy
    // 5-candidate semantics are exercised in Postgres-backed integration
    // (where app.boss !== null).
    const admin = await createAdmin(app);
    await seedCatalogPending(app, [
      "AUWARM01",
      "AUWARM02",
      "AUWARM03",
      "AUWARM04",
      "AUWARM05",
    ]);

    const res = await app.inject({
      method: "POST",
      url: "/admin/providers/yahoo-finance-au/rerun",
      headers: { cookie: `${SESSION_COOKIE_NAME}=${admin.cookie}` },
      payload: {},
    });
    expect(res.statusCode).toBe(202);

    const body = res.json() as { status: string; tickerCount: number };
    expect(body.status).toBe("queued");
    // Memory-backend (boss=null) → no dispatch → 0.
    expect(body.tickerCount).toBe(0);

    const auditResp = await app.persistence.listAuditLog({
      page: 1,
      limit: 10,
      actions: ["provider_health_rerun"],
    });
    const entry = auditResp.items.find(
      (e) => (e.metadata as { providerId?: string }).providerId === "yahoo-finance-au",
    );
    expect(entry).toBeDefined();
    const meta = entry!.metadata as {
      providerId: string;
      marketCode: string;
      tickerCount: number;
      catalogBackfill: { tickerCount: number; jobId: string | null };
      monitoredRefresh: { tickerCount: number; jobId: string | null };
    };
    expect(meta.providerId).toBe("yahoo-finance-au");
    expect(meta.marketCode).toBe("AU");
    // Nested keys must still be present so the schema is consistent across
    // backends; values are 0/null in memory mode.
    expect(meta.catalogBackfill).toBeDefined();
    expect(meta.monitoredRefresh).toBeDefined();
    expect(meta.catalogBackfill.tickerCount).toBe(0);
    expect(meta.catalogBackfill.jobId).toBeNull();
    expect(meta.monitoredRefresh.tickerCount).toBe(0);
    expect(meta.monitoredRefresh.jobId).toBeNull();
    // Top-level = sum (back-compat).
    expect(meta.tickerCount).toBe(0);
  });

  it("post-warm-up AU (memory mode): nested keys present, tickerCount=0 (no dispatch)", async () => {
    const admin = await createAdmin(app);
    // Seed all 5 as pending initially.
    await seedCatalogPending(app, [
      "AUWARM01",
      "AUWARM02",
      "AUWARM03",
      "AUWARM06",
      "AUWARM07",
    ]);

    // Promote AUWARM06 + AUWARM07 to `ready` (memory test-helper re-seed
    // overwrites barsBackfillStatus).
    (app.persistence as unknown as {
      _seedInstrument: (i: {
        ticker: string;
        name: string | null;
        instrumentType: string | null;
        marketCode: string;
        barsBackfillStatus: string;
      }) => void;
    })._seedInstrument({
      ticker: "AUWARM06",
      name: "AUWARM06 Ltd",
      instrumentType: "STOCK",
      marketCode: "AU",
      barsBackfillStatus: "ready",
    });
    (app.persistence as unknown as {
      _seedInstrument: (i: {
        ticker: string;
        name: string | null;
        instrumentType: string | null;
        marketCode: string;
        barsBackfillStatus: string;
      }) => void;
    })._seedInstrument({
      ticker: "AUWARM07",
      name: "AUWARM07 Ltd",
      instrumentType: "STOCK",
      marketCode: "AU",
      barsBackfillStatus: "ready",
    });

    // Add AUWARM06 + AUWARM07 to monitored set for the admin.
    await app.persistence.replaceManualSelections(admin.userId, [
      { ticker: "AUWARM06", marketCode: "AU" },
      { ticker: "AUWARM07", marketCode: "AU" },
    ]);

    const res = await app.inject({
      method: "POST",
      url: "/admin/providers/yahoo-finance-au/rerun",
      headers: { cookie: `${SESSION_COOKIE_NAME}=${admin.cookie}` },
      payload: {},
    });
    expect(res.statusCode).toBe(202);

    const auditResp = await app.persistence.listAuditLog({
      page: 1,
      limit: 10,
      actions: ["provider_health_rerun"],
    });
    const entry = auditResp.items.find(
      (e) => (e.metadata as { providerId?: string }).providerId === "yahoo-finance-au",
    );
    expect(entry).toBeDefined();
    const meta = entry!.metadata as {
      tickerCount: number;
      catalogBackfill: { tickerCount: number };
      monitoredRefresh: { tickerCount: number };
    };
    // Memory mode (boss=null): both branches skip dispatch → 0/0/0 per
    // ARCHITECT:RULING-CONFIRMED + locked scope-todo line 23. The 3-catalog +
    // 2-monitored semantics are exercised in Postgres-backed integration
    // (where app.boss !== null and dispatch actually happens).
    expect(meta.catalogBackfill.tickerCount).toBe(0);
    expect(meta.monitoredRefresh.tickerCount).toBe(0);
    expect(meta.tickerCount).toBe(0);
  });

  it("fresh-deploy JP (memory mode): rerun stays scoped to JP union metadata", async () => {
    const admin = await createAdmin(app);
    await app.persistence.upsertProviderHealthStatus({
      providerId: "yahoo-finance-jp",
      status: "down",
      lastSuccessfulRun: null,
      lastFailedRun: null,
      lastManualRerunAt: null,
    });
    await seedCatalogPending(app, ["JPWARM01", "JPWARM02"], "JP");

    const res = await app.inject({
      method: "POST",
      url: "/admin/providers/yahoo-finance-jp/rerun",
      headers: { cookie: `${SESSION_COOKIE_NAME}=${admin.cookie}` },
      payload: {},
    });
    expect(res.statusCode).toBe(202);

    const body = res.json() as { status: string; tickerCount: number };
    expect(body.status).toBe("queued");
    expect(body.tickerCount).toBe(0);

    const auditResp = await app.persistence.listAuditLog({
      page: 1,
      limit: 10,
      actions: ["provider_health_rerun"],
    });
    const entry = auditResp.items.find(
      (e) => (e.metadata as { providerId?: string }).providerId === "yahoo-finance-jp",
    );
    expect(entry).toBeDefined();
    const meta = entry!.metadata as {
      providerId: string;
      marketCode: string;
      tickerCount: number;
      catalogBackfill: { tickerCount: number; jobId: string | null };
      monitoredRefresh: { tickerCount: number; jobId: string | null };
    };
    expect(meta.providerId).toBe("yahoo-finance-jp");
    expect(meta.marketCode).toBe("JP");
    expect(meta.catalogBackfill).toEqual({ tickerCount: 0, jobId: null });
    expect(meta.monitoredRefresh).toEqual({ tickerCount: 0, jobId: null });
    expect(meta.tickerCount).toBe(0);
  });

  it("non-AU provider audit metadata stays flat (back-compat)", async () => {
    const admin = await createAdmin(app);
    await app.persistence.upsertProviderHealthStatus({
      providerId: "finmind-tw",
      status: "healthy",
      lastSuccessfulRun: new Date().toISOString(),
      lastManualRerunAt: null,
    });

    const res = await app.inject({
      method: "POST",
      url: "/admin/providers/finmind-tw/rerun",
      headers: { cookie: `${SESSION_COOKIE_NAME}=${admin.cookie}` },
      payload: {},
    });
    expect(res.statusCode).toBe(202);

    const auditResp = await app.persistence.listAuditLog({
      page: 1,
      limit: 10,
      actions: ["provider_health_rerun"],
    });
    const entry = auditResp.items.find(
      (e) => (e.metadata as { providerId?: string }).providerId === "finmind-tw",
    );
    expect(entry).toBeDefined();
    const meta = entry!.metadata as Record<string, unknown>;
    // Flat shape preserved — no nested keys for non-AU providers.
    expect(meta.providerId).toBe("finmind-tw");
    expect(meta).not.toHaveProperty("catalogBackfill");
    expect(meta).not.toHaveProperty("monitoredRefresh");
  });
});

// -----------------------------------------------------------------------------
// Postgres-direct coverage of `listAuCatalogBarsBackfillCandidates` SQL filter.
//
// CR MEDIUM-1 (review-202605091615-kzo197.md): the route-level integration
// tests above run via `buildApp({memory})` and never exercise the Postgres
// `WHERE market_code='AU' AND bars_backfill_status IN ('pending','failed')
// AND delisted_at IS NULL` predicate. This block seeds rows via raw SQL with
// schema-qualified `market_data.instruments` + `ON CONFLICT DO UPDATE` per
// `.claude/rules/integration-test-persistence-direct.md`, then calls the
// persistence method directly to verify the filter behaves as specified.
// -----------------------------------------------------------------------------

const databaseUrl = process.env.POSTGRES_TEST_DB_URL ?? process.env.DB_URL;
const redisUrl = process.env.POSTGRES_TEST_REDIS_URL ?? process.env.REDIS_URL;
const runPostgresIntegration = process.env.RUN_POSTGRES_INTEGRATION === "1";
const managedCiStack = process.env.VAKWEN_MANAGED_CI_STACK === "1";

if (runPostgresIntegration && !managedCiStack) {
  throw new Error(
    "RUN_POSTGRES_INTEGRATION=1 must be executed via npm run test:integration:full:host or :container.",
  );
}

const shouldRunPostgresSuite =
  runPostgresIntegration && Boolean(databaseUrl) && Boolean(redisUrl);
const describePostgres = shouldRunPostgresSuite ? describe : describe.skip;

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(currentDir, "../../../../db/migrations");

async function loadMigrationManifestLazy() {
  const { loadMigrationManifest } = await import(
    "../../src/persistence/migrationManifest.js"
  );
  return loadMigrationManifest(migrationsDir);
}

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
  const manifest = await loadMigrationManifestLazy();
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

async function seedInstrument(
  pool: Pool,
  args: {
    ticker: string;
    marketCode: "AU" | "TW" | "US";
    barsBackfillStatus: "pending" | "ready" | "failed";
    delisted?: boolean;
  },
): Promise<void> {
  const { ticker, marketCode, barsBackfillStatus, delisted = false } = args;
  await pool.query(
    `INSERT INTO market_data.instruments
       (ticker, market_code, name, instrument_type, bars_backfill_status, delisted_at)
     VALUES ($1, $2, $3, 'STOCK', $4, ${delisted ? "NOW()" : "NULL"})
     ON CONFLICT (ticker, market_code) DO UPDATE
       SET name                 = EXCLUDED.name,
           instrument_type      = EXCLUDED.instrument_type,
           bars_backfill_status = EXCLUDED.bars_backfill_status,
           delisted_at          = EXCLUDED.delisted_at`,
    [ticker, marketCode, `${ticker} Fixture`, barsBackfillStatus],
  );
}

describePostgres(
  "KZO-197 — listAuCatalogBarsBackfillCandidates SQL filter (Postgres-direct)",
  () => {
    let pool: Pool;
    let persistence: import("../../src/persistence/postgres.js").PostgresPersistence | null = null;

    beforeEach(async () => {
      pool = new Pool({ connectionString: databaseUrl });
      await resetDatabase(pool);
      await applyNumberedMigrations(pool);
      const { PostgresPersistence } = await import(
        "../../src/persistence/postgres.js"
      );
      persistence = new PostgresPersistence({
        databaseUrl: databaseUrl!,
        redisUrl: redisUrl!,
      });
      await persistence.init();

      // Pre-seed an admin actor user so any audit_log path (none in this
      // describe block, but follows the canonical pattern) has a valid FK.
      await persistence.resolveOrCreateUser(
        "google",
        "kzo197-admin-actor-sub",
        { email: "kzo197-admin-actor@example.com", name: "KZO-197 Admin Actor" },
      );
    });

    afterEach(async () => {
      if (persistence) {
        await persistence.close();
        persistence = null;
      }
      await pool.end();
    });

    it("filters AU rows by status IN ('pending','failed') AND delisted_at IS NULL", async () => {
      // 1 AU pending — must appear.
      await seedInstrument(pool, {
        ticker: "AUWARMP01",
        marketCode: "AU",
        barsBackfillStatus: "pending",
      });
      // 1 AU failed — must appear.
      await seedInstrument(pool, {
        ticker: "AUWARMP02",
        marketCode: "AU",
        barsBackfillStatus: "failed",
      });
      // 1 AU ready — must NOT appear (status filter).
      await seedInstrument(pool, {
        ticker: "AUWARMP03",
        marketCode: "AU",
        barsBackfillStatus: "ready",
      });
      // 1 AU pending but delisted — must NOT appear (delisted_at filter).
      await seedInstrument(pool, {
        ticker: "AUWARMP04",
        marketCode: "AU",
        barsBackfillStatus: "pending",
        delisted: true,
      });
      // 1 TW pending — must NOT appear (market_code filter).
      await seedInstrument(pool, {
        ticker: "AUWARMP05",
        marketCode: "TW",
        barsBackfillStatus: "pending",
      });

      const candidates = await persistence!.listAuCatalogBarsBackfillCandidates();

      expect(candidates).toHaveLength(2);
      const tickers = candidates.map((c) => c.ticker).sort();
      expect(tickers).toEqual(["AUWARMP01", "AUWARMP02"]);
      // All returned rows must carry the AU literal.
      expect(candidates.every((c) => c.marketCode === "AU")).toBe(true);
    });
  },
);
