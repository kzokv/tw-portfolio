import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadMigrationManifest } from "../../src/persistence/migrationManifest.js";

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

describePostgres("user identity schema", () => {
  let pool: Pool;

  async function resetPublicSchema(): Promise<void> {
    const client = await pool.connect();
    try {
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
    await resetPublicSchema();
    await applyNumberedMigrations();
  });

  afterEach(async () => {
    await pool.end();
  });

  it("user can be inserted with NULL email", async () => {
    await pool.query(
      `INSERT INTO users (id, email, locale, cost_basis_method, quote_poll_interval_seconds)
       VALUES ($1, $2, 'en', 'WEIGHTED_AVERAGE', 10)`,
      ["user-null-email", null],
    );

    const result = await pool.query("SELECT id, email FROM users WHERE id = $1", ["user-null-email"]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].id).toBe("user-null-email");
    expect(result.rows[0].email).toBeNull();
  });

  it("user gets default timestamps on insert", async () => {
    const { rows: [{ now: before }] } = await pool.query<{ now: Date }>(
      "SELECT NOW()::timestamp AS now",
    );

    await pool.query(
      `INSERT INTO users (id, email, locale, cost_basis_method, quote_poll_interval_seconds)
       VALUES ($1, $2, 'en', 'WEIGHTED_AVERAGE', 10)`,
      ["user-timestamps", "ts@example.com"],
    );

    const { rows: [{ now: after }] } = await pool.query<{ now: Date }>(
      "SELECT NOW()::timestamp AS now",
    );

    const result = await pool.query("SELECT created_at, updated_at FROM users WHERE id = $1", [
      "user-timestamps",
    ]);
    expect(result.rows).toHaveLength(1);

    const createdAt = new Date(result.rows[0].created_at);
    const updatedAt = new Date(result.rows[0].updated_at);

    expect(createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
    expect(updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
    expect(createdAt.getTime()).toBeLessThanOrEqual(after.getTime() + 1000);
    expect(updatedAt.getTime()).toBeLessThanOrEqual(after.getTime() + 1000);
  });

  it("user can have display_name", async () => {
    await pool.query(
      `INSERT INTO users (id, email, display_name, locale, cost_basis_method, quote_poll_interval_seconds)
       VALUES ($1, $2, $3, 'en', 'WEIGHTED_AVERAGE', 10)`,
      ["user-display", "display@example.com", "Alice Chen"],
    );

    const result = await pool.query("SELECT display_name FROM users WHERE id = $1", ["user-display"]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].display_name).toBe("Alice Chen");
  });

  it("external identity can be linked to a user", async () => {
    await pool.query(
      `INSERT INTO users (id, email, locale, cost_basis_method, quote_poll_interval_seconds)
       VALUES ($1, $2, 'en', 'WEIGHTED_AVERAGE', 10)`,
      ["user-ext", "ext@example.com"],
    );

    await pool.query(
      `INSERT INTO user_external_identities (id, user_id, provider, provider_subject, provider_email, provider_display_name, provider_picture_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        "ext-id-1",
        "user-ext",
        "google",
        "google-sub-123",
        "ext@gmail.com",
        "Ext User",
        "https://lh3.googleusercontent.com/photo.jpg",
      ],
    );

    const result = await pool.query(
      "SELECT * FROM user_external_identities WHERE user_id = $1",
      ["user-ext"],
    );
    expect(result.rows).toHaveLength(1);

    const row = result.rows[0];
    expect(row.id).toBe("ext-id-1");
    expect(row.user_id).toBe("user-ext");
    expect(row.provider).toBe("google");
    expect(row.provider_subject).toBe("google-sub-123");
    expect(row.provider_email).toBe("ext@gmail.com");
    expect(row.provider_display_name).toBe("Ext User");
    expect(row.provider_picture_url).toBe("https://lh3.googleusercontent.com/photo.jpg");

    const linkedAt = new Date(row.linked_at);
    const lastSeenAt = new Date(row.last_seen_at);
    expect(linkedAt.getTime()).toBeGreaterThan(0);
    expect(lastSeenAt.getTime()).toBeGreaterThan(0);
  });

  it("unique constraint on (provider, provider_subject) prevents duplicates", async () => {
    await pool.query(
      `INSERT INTO users (id, email, locale, cost_basis_method, quote_poll_interval_seconds)
       VALUES ($1, $2, 'en', 'WEIGHTED_AVERAGE', 10)`,
      ["user-dup-a", "dup-a@example.com"],
    );
    await pool.query(
      `INSERT INTO users (id, email, locale, cost_basis_method, quote_poll_interval_seconds)
       VALUES ($1, $2, 'en', 'WEIGHTED_AVERAGE', 10)`,
      ["user-dup-b", "dup-b@example.com"],
    );

    await pool.query(
      `INSERT INTO user_external_identities (id, user_id, provider, provider_subject, provider_email, provider_display_name, provider_picture_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      ["ext-dup-1", "user-dup-a", "google", "same-subject", null, null, null],
    );

    await expect(
      pool.query(
        `INSERT INTO user_external_identities (id, user_id, provider, provider_subject, provider_email, provider_display_name, provider_picture_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        ["ext-dup-2", "user-dup-b", "google", "same-subject", null, null, null],
      ),
    ).rejects.toThrow(/unique/i);
  });

  it("user can exist without any external identity", async () => {
    await pool.query(
      `INSERT INTO users (id, email, locale, cost_basis_method, quote_poll_interval_seconds)
       VALUES ($1, $2, 'en', 'WEIGHTED_AVERAGE', 10)`,
      ["user-no-ext", "noext@example.com"],
    );

    const result = await pool.query(
      "SELECT * FROM user_external_identities WHERE user_id = $1",
      ["user-no-ext"],
    );
    expect(result.rows).toHaveLength(0);
  });

  it("UNIQUE constraint on users.email prevents duplicate non-NULL emails", async () => {
    await pool.query(
      `INSERT INTO users (id, email, locale, cost_basis_method, quote_poll_interval_seconds)
       VALUES ($1, $2, 'en', 'WEIGHTED_AVERAGE', 10)`,
      ["user-email-a", "same@example.com"],
    );

    await expect(
      pool.query(
        `INSERT INTO users (id, email, locale, cost_basis_method, quote_poll_interval_seconds)
         VALUES ($1, $2, 'en', 'WEIGHTED_AVERAGE', 10)`,
        ["user-email-b", "same@example.com"],
      ),
    ).rejects.toThrow(/unique/i);
  });

  it("UNIQUE constraint allows multiple NULL emails (partial index)", async () => {
    await pool.query(
      `INSERT INTO users (id, email, locale, cost_basis_method, quote_poll_interval_seconds)
       VALUES ($1, $2, 'en', 'WEIGHTED_AVERAGE', 10)`,
      ["user-null-a", null],
    );
    await pool.query(
      `INSERT INTO users (id, email, locale, cost_basis_method, quote_poll_interval_seconds)
       VALUES ($1, $2, 'en', 'WEIGHTED_AVERAGE', 10)`,
      ["user-null-b", null],
    );

    const result = await pool.query("SELECT COUNT(*) AS cnt FROM users WHERE email IS NULL");
    expect(Number(result.rows[0].cnt)).toBeGreaterThanOrEqual(2);
  });

  it("multiple providers can be linked to the same user", async () => {
    await pool.query(
      `INSERT INTO users (id, email, locale, cost_basis_method, quote_poll_interval_seconds)
       VALUES ($1, $2, 'en', 'WEIGHTED_AVERAGE', 10)`,
      ["user-multi", "multi@example.com"],
    );

    await pool.query(
      `INSERT INTO user_external_identities (id, user_id, provider, provider_subject, provider_email, provider_display_name, provider_picture_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      ["ext-google", "user-multi", "google", "google-sub-456", "multi@gmail.com", "Multi User", null],
    );

    await pool.query(
      `INSERT INTO user_external_identities (id, user_id, provider, provider_subject, provider_email, provider_display_name, provider_picture_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        "ext-github",
        "user-multi",
        "github",
        "github-sub-789",
        "multi@github.com",
        "Multi User GH",
        "https://avatars.githubusercontent.com/u/123",
      ],
    );

    const result = await pool.query(
      "SELECT * FROM user_external_identities WHERE user_id = $1 ORDER BY provider",
      ["user-multi"],
    );
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].provider).toBe("github");
    expect(result.rows[0].provider_subject).toBe("github-sub-789");
    expect(result.rows[1].provider).toBe("google");
    expect(result.rows[1].provider_subject).toBe("google-sub-456");
  });
});
