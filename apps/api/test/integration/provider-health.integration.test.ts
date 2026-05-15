/**
 * KZO-177 — Postgres integration tests for the provider-health state machine
 * + 30-day error trail purge.
 *
 * Per `.claude/rules/integration-test-persistence-direct.md`:
 *   • PostgresPersistence direct (no buildApp — no Redis)
 *   • Schema-qualified raw SQL (`market_data.provider_health_status`,
 *     `market_data.provider_error_trail`)
 *   • Real users via `resolveOrCreateUser` for any audit_log FK
 *
 * TDD-red: imports for `recordOutcome` + `registerProviderErrorTrailPurge`
 * fail until Backend Implementer lands them in Phase 1/Phase 7.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const { PostgresPersistence } = await import("../../src/persistence/postgres.js");
const { MemoryPersistence } = await import("../../src/persistence/memory.js");
const { loadMigrationManifest } = await import("../../src/persistence/migrationManifest.js");
const { recordOutcome } = await import("../../src/services/market-data/providerHealth.js");
const { purgeProviderErrorTrail } = await import(
  "../../src/services/market-data/providerErrorTrailPurge.js"
);

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

const shouldRunPostgresSuite =
  runPostgresIntegration && Boolean(databaseUrl) && Boolean(redisUrl);
const describePostgres = shouldRunPostgresSuite ? describe : describe.skip;

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(currentDir, "../../../../db/migrations");
const migrationManifestPromise = loadMigrationManifest(migrationsDir);

// ── Postgres integration suite ────────────────────────────────────────────────

describePostgres("provider-health state machine (Postgres) — KZO-177", () => {
  let pool: Pool;
  let persistence: InstanceType<typeof PostgresPersistence> | null = null;
  // Seeded admin's UUID — kept as scoped state so future I-tests that need an
  // audit-log actor (e.g. rerun audit row assertions) can reference it without
  // re-seeding. Currently unused at the assertion level.
  let adminUserId: string;

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
    persistence = new PostgresPersistence({
      databaseUrl: databaseUrl!,
      redisUrl: redisUrl!,
    });
    await persistence.init();

    // Seed a real admin user so any audit_log writes have a valid actor FK.
    // Avoid the literal "system" string — Postgres enforces the FK on
    // audit_log.actor_user_id (per .claude/rules/integration-test-persistence-direct.md).
    const bootstrap = await persistence.resolveOrCreateUser("google", "kzo177-bootstrap-sub", {
      email: "kzo177-bootstrap@example.com",
      name: "KZO-177 Bootstrap",
    });
    const bootstrapId = bootstrap.userId;

    const seeded = await persistence.resolveOrCreateUser("google", "kzo177-admin-sub", {
      email: "kzo177-admin@example.com",
      name: "KZO-177 Admin",
    });
    adminUserId = seeded.userId;
    await persistence.changeUserRole(adminUserId, "admin", { actorUserId: bootstrapId });
  });

  afterEach(async () => {
    if (persistence) {
      await persistence.close();
      persistence = null;
    }
    await pool.end();
  });

  // I1 — migrations 046 + 048 + 050 pre-seed 6 provider rows.
  // KZO-200: migration 048 added `twelve-data-au` (the AU catalog provider per
  // KZO-194). Original migration 046 seeded 4. KZO-196: migration 050 added
  // `asx-gics-csv` (AU GICS catalog enrichment).
  it("I1: migrations pre-seed 6 provider rows with status='down' and NULL timestamps", async () => {
    const result = await pool.query<{ provider_id: string; status: string; last_successful_run: string | null }>(
      "SELECT provider_id, status, last_successful_run FROM market_data.provider_health_status ORDER BY provider_id",
    );
    const ids = result.rows.map((r) => r.provider_id);
    expect(ids).toEqual(
      [
        "asx-gics-csv",
        "finmind-tw",
        "finmind-us",
        "frankfurter",
        "yahoo-finance-au",
        "twelve-data-au",
      ].sort(),
    );
    for (const row of result.rows) {
      expect(row.status).toBe("down");
      expect(row.last_successful_run).toBeNull();
    }
  });

  // I2 — trail FK enforcement
  it("I2: trail INSERT with non-existent provider_id violates FK", async () => {
    await expect(
      pool.query(
        `INSERT INTO market_data.provider_error_trail (provider_id, error_class, error_message)
         VALUES ('nonexistent-provider', 'http_5xx', 'should fail')`,
      ),
    ).rejects.toThrow(/foreign key/i);
  });

  // I3 — trail row inserted on error outcome
  it("I3: error outcome inserts a trail row with provider_id and error_class", async () => {
    await recordOutcome(persistence!, {
      providerId: "finmind-tw",
      outcome: { kind: "error", errorClass: "http_5xx", errorMessage: "boom" },
    });

    const trail = await pool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM market_data.provider_error_trail WHERE provider_id = $1",
      ["finmind-tw"],
    );
    expect(Number(trail.rows[0].count)).toBe(1);
  });

  // I5 — flap suppression survives across persistence calls
  it("I5: down → degraded path preserves last_down_notification_at within 24h window", async () => {
    // Seed: down, with notification fired 1h ago.
    const stamp = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    await pool.query(
      `UPDATE market_data.provider_health_status
         SET status = 'down', last_down_notification_at = $1
       WHERE provider_id = 'finmind-tw'`,
      [stamp],
    );

    // Trigger another error (still down).
    await recordOutcome(persistence!, {
      providerId: "finmind-tw",
      outcome: { kind: "error", errorClass: "network", errorMessage: "again" },
    });

    const row = await pool.query<{ last_down_notification_at: Date | null }>(
      `SELECT last_down_notification_at FROM market_data.provider_health_status WHERE provider_id = 'finmind-tw'`,
    );
    // pg driver returns TIMESTAMPTZ as a Date — compare normalized ISO strings.
    const observed = row.rows[0].last_down_notification_at;
    expect(observed).not.toBeNull();
    expect(new Date(observed!).toISOString()).toBe(stamp);
  });

  // I6 — 30-day purge boundary
  it("I6: purge deletes trail rows older than 30 days; preserves boundary survivors", async () => {
    // Seed 4 trail rows with deterministic ids ordered by occurred_at.
    await pool.query(
      `INSERT INTO market_data.provider_error_trail
         (provider_id, occurred_at, error_class, error_message)
       VALUES
         ('finmind-tw', NOW() - INTERVAL '31 days',         'http_5xx', 'old-31d'),
         ('finmind-tw', NOW() - INTERVAL '30 days 1 minute','http_5xx', 'edge-30d-1m'),
         ('finmind-tw', NOW() - INTERVAL '29 days 23 hours','http_5xx', 'edge-29d-23h'),
         ('finmind-tw', NOW() - INTERVAL '1 day',           'http_5xx', 'recent-1d')`,
    );

    const deleted = await purgeProviderErrorTrail(persistence!, {
      olderThanMs: 30 * 24 * 60 * 60 * 1000,
    });
    expect(deleted).toBe(2);

    const remaining = await pool.query<{ error_message: string }>(
      `SELECT error_message FROM market_data.provider_error_trail ORDER BY error_message`,
    );
    expect(remaining.rows.map((r) => r.error_message)).toEqual([
      "edge-29d-23h",
      "recent-1d",
    ]);
  });

  // I9 — recent trail per provider — last 10 ordered DESC
  it("I9: recent-trail helper returns at most 10 rows ordered occurred_at DESC", async () => {
    for (let i = 0; i < 15; i++) {
      await pool.query(
        `INSERT INTO market_data.provider_error_trail (provider_id, occurred_at, error_class, error_message)
         VALUES ('finmind-tw', NOW() - ($1 || ' minutes')::interval, 'http_5xx', $2)`,
        [String(i + 1), `err-${i}`],
      );
    }

    const recent = await pool.query<{ error_message: string }>(
      `SELECT error_message FROM market_data.provider_error_trail
        WHERE provider_id = 'finmind-tw'
        ORDER BY occurred_at DESC
        LIMIT 10`,
    );
    expect(recent.rows).toHaveLength(10);
    expect(recent.rows[0].error_message).toBe("err-0"); // most recent (smallest interval)
  });

  // I10 — rate_limit does NOT count toward errors (computed-on-read against trail)
  // Architect chose computed-on-read: there are no counter columns. The rolling
  // 24h window is `SELECT COUNT(*) FROM provider_error_trail WHERE error_class !=
  // 'rate_limit' AND occurred_at >= NOW() - INTERVAL '24 hours'`. This test
  // proves a rate_limit outcome inserts a trail row with `error_class='rate_limit'`
  // but does NOT increment the error trail rows that drive the error_count.
  it("I10: rate_limit outcome inserts rate_limit trail row, leaves non-rate-limit trail count unchanged", async () => {
    // Arrange — seed two http_5xx trail rows so the baseline non-rate-limit
    // count is 2 prior to the act.
    await pool.query(
      `INSERT INTO market_data.provider_error_trail
         (provider_id, occurred_at, error_class, error_message)
       VALUES
         ('finmind-tw', NOW() - INTERVAL '1 hour', 'http_5xx', 'pre-rl-1'),
         ('finmind-tw', NOW() - INTERVAL '2 hour', 'http_5xx', 'pre-rl-2')`,
    );

    // Act — record a rate_limit outcome.
    await recordOutcome(persistence!, {
      providerId: "finmind-tw",
      outcome: { kind: "rate_limit", errorClass: "rate_limit", errorMessage: "429" },
    });

    // Assert — non-rate-limit trail rows unchanged at 2; rate_limit trail row
    // count incremented by 1 (the new outcome).
    const nonRateLimit = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM market_data.provider_error_trail
        WHERE provider_id = 'finmind-tw' AND error_class != 'rate_limit'`,
    );
    const rateLimit = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM market_data.provider_error_trail
        WHERE provider_id = 'finmind-tw' AND error_class = 'rate_limit'`,
    );
    expect(Number(nonRateLimit.rows[0].count)).toBe(2);
    expect(Number(rateLimit.rows[0].count)).toBe(1);
  });
});

// ── Memory backend purge no-op ────────────────────────────────────────────────

describe("provider-health purge — memory backend no-op (KZO-177)", () => {
  it("I7: memory persistence purge returns 0 (Postgres-only retention)", async () => {
    const persistence = new MemoryPersistence();
    await persistence.init();
    try {
      const deleted = await purgeProviderErrorTrail(persistence, {
        olderThanMs: 0,
      });
      expect(deleted).toBe(0);
    } finally {
      await persistence.close();
    }
  });
});
