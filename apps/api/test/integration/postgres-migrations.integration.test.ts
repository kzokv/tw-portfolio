import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { PostgresPersistence } from "../../src/persistence/postgres.js";

const databaseUrl = process.env.POSTGRES_TEST_DB_URL ?? process.env.DB_URL;
const redisUrl = process.env.POSTGRES_TEST_REDIS_URL ?? process.env.REDIS_URL;
const shouldRunPostgresSuite =
  process.env.RUN_POSTGRES_INTEGRATION === "1" && Boolean(databaseUrl) && Boolean(redisUrl);

const describePostgres = shouldRunPostgresSuite ? describe : describe.skip;
const legacyUserIds = ["legacy-fifo", "legacy-lifo", "legacy-custom"];

describePostgres("postgres migrations", () => {
  let pool: Pool;
  let persistence: PostgresPersistence | null = null;

  beforeEach(async () => {
    pool = new Pool({ connectionString: databaseUrl });
    const client = await pool.connect();
    try {
      await client.query("DROP SCHEMA IF EXISTS public CASCADE");
      await client.query("CREATE SCHEMA public");
      await client.query("GRANT ALL ON SCHEMA public TO public");

      const currentDir = path.dirname(fileURLToPath(import.meta.url));
      const initMigrationPath = path.resolve(currentDir, "../../../../db/migrations/001_init.sql");
      const initMigration = await fs.readFile(initMigrationPath, "utf8");
      await client.query(initMigration);

      await client.query(
        `INSERT INTO users (id, email, locale, cost_basis_method, quote_poll_interval_seconds)
         VALUES
           ('legacy-fifo', 'legacy-fifo@example.com', 'en', 'FIFO', 10),
           ('legacy-lifo', 'legacy-lifo@example.com', 'en', 'LIFO', 10),
           ('legacy-custom', 'legacy-custom@example.com', 'en', 'LEGACY', 10)`,
      );
    } finally {
      client.release();
    }
  });

  afterEach(async () => {
    if (persistence) {
      await persistence.close();
      persistence = null;
    }
    await pool.end();
  });

  it("normalizes legacy cost basis values to WEIGHTED_AVERAGE on init", async () => {
    persistence = new PostgresPersistence({
      databaseUrl: databaseUrl!,
      redisUrl: redisUrl!,
    });
    await persistence.init();

    const users = await pool.query<{ id: string; cost_basis_method: string }>(
      `SELECT id, cost_basis_method
       FROM users
       WHERE id = ANY($1)
       ORDER BY id`,
      [legacyUserIds],
    );
    expect(users.rows).toHaveLength(3);
    for (const user of users.rows) {
      expect(user.cost_basis_method).toBe("WEIGHTED_AVERAGE");
    }
  });

  it("records applied migrations and avoids replaying them on subsequent init", async () => {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const migrationsDir = path.resolve(currentDir, "../../../../db/migrations");
    const migrationFiles = (await fs.readdir(migrationsDir))
      .filter((file) => /^\d+_.*\.sql$/.test(file))
      .sort((a, b) => a.localeCompare(b));

    persistence = new PostgresPersistence({
      databaseUrl: databaseUrl!,
      redisUrl: redisUrl!,
    });
    await persistence.init();
    await persistence.close();
    persistence = null;

    const firstPass = await pool.query<{ name: string }>(
      "SELECT name FROM schema_migrations ORDER BY name",
    );
    expect(firstPass.rows.map((row) => row.name)).toEqual(migrationFiles);

    persistence = new PostgresPersistence({
      databaseUrl: databaseUrl!,
      redisUrl: redisUrl!,
    });
    await persistence.init();

    const secondPass = await pool.query<{ name: string }>(
      "SELECT name FROM schema_migrations ORDER BY name",
    );
    expect(secondPass.rows.map((row) => row.name)).toEqual(migrationFiles);
  });
});
