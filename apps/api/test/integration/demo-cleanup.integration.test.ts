import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadMigrationManifest } from "../../src/persistence/migrationManifest.js";
import { cleanupExpiredDemoUsers } from "../../src/services/demoCleanup.js";

const databaseUrl = process.env.POSTGRES_TEST_DB_URL ?? process.env.DB_URL;
const redisUrl = process.env.POSTGRES_TEST_REDIS_URL ?? process.env.REDIS_URL;
const runPostgresIntegration = process.env.RUN_POSTGRES_INTEGRATION === "1";
const managedCiStack = process.env.TWP_MANAGED_CI_STACK === "1";

if (runPostgresIntegration && !managedCiStack) {
  throw new Error(
    "RUN_POSTGRES_INTEGRATION=1 must be executed via npm run test:integration:ci:host or npm run test:integration:ci:container so the DB/Redis stack is managed automatically.",
  );
}
const shouldRunPostgresSuite = runPostgresIntegration && Boolean(databaseUrl) && Boolean(redisUrl);
const describePostgres = shouldRunPostgresSuite ? describe : describe.skip;
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(currentDir, "../../../../db/migrations");
const migrationManifestPromise = loadMigrationManifest(migrationsDir);

describePostgres("cleanupExpiredDemoUsers", () => {
  let pool: Pool;

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

  async function insertUser(id: string, email: string, isDemo: boolean, expiresAt: string | null): Promise<void> {
    await pool.query(
      `INSERT INTO users (id, email, is_demo, demo_expires_at, locale, cost_basis_method, quote_poll_interval_seconds)
       VALUES ($1, $2, $3, $4, 'en', 'WEIGHTED_AVERAGE', 10)`,
      [id, email, isDemo, expiresAt],
    );
  }

  beforeEach(async () => {
    pool = new Pool({ connectionString: databaseUrl });
    await resetDatabase();
    await applyNumberedMigrations();
  });

  afterEach(async () => {
    if (pool) await pool.end();
  });

  it("deletes expired demo users", async () => {
    // Insert a demo user that expired 2 hours ago
    await insertUser("demo-expired-1", "demo1@demo.local", true, "2020-01-01T00:00:00Z");

    const count = await cleanupExpiredDemoUsers(pool);
    expect(count).toBe(1);

    // Verify user is gone
    const { rows } = await pool.query("SELECT id FROM users WHERE id = $1", ["demo-expired-1"]);
    expect(rows).toHaveLength(0);
  });

  it("does NOT delete valid (non-expired) demo users", async () => {
    // Insert a demo user that expires far in the future
    const futureExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await insertUser("demo-active-1", "demo-active@demo.local", true, futureExpiry);

    const count = await cleanupExpiredDemoUsers(pool);
    expect(count).toBe(0);

    const { rows } = await pool.query("SELECT id FROM users WHERE id = $1", ["demo-active-1"]);
    expect(rows).toHaveLength(1);
  });

  it("does NOT delete real users (is_demo=false)", async () => {
    await insertUser("real-user-1", "real@example.com", false, null);

    const count = await cleanupExpiredDemoUsers(pool);
    expect(count).toBe(0);

    const { rows } = await pool.query("SELECT id FROM users WHERE id = $1", ["real-user-1"]);
    expect(rows).toHaveLength(1);
  });
});
