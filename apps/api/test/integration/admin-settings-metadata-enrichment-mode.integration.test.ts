import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadMigrationManifest } from "../../src/persistence/migrationManifest.js";
import { PostgresPersistence } from "../../src/persistence/postgres.js";

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

// ── Suite ─────────────────────────────────────────────────────────────────────

describePostgres("admin settings — metadataEnrichmentMode (KZO-189)", () => {
  let pool: Pool;
  let persistence: PostgresPersistence | null = null;
  let adminActorId: string;

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
    const { userId } = await persistence.resolveOrCreateUser("google", "admin-settings-meta-sub", {
      email: "admin-settings-meta@example.com",
      name: "Admin Meta",
    });
    adminActorId = userId;
  });

  afterEach(async () => {
    if (persistence) {
      await persistence.close();
      persistence = null;
    }
    await pool.end();
  });

  // ── setMetadataEnrichmentMode / getAppConfig CRUD ─────────────────────────

  it("setMetadataEnrichmentMode('unconditional') → getAppConfig returns unconditional", async () => {
    await persistence!.setMetadataEnrichmentMode("unconditional");

    const cfg = await persistence!.getAppConfig();
    expect(cfg.metadataEnrichmentMode).toBe("unconditional");

    const raw = await pool.query<{ metadata_enrichment_mode: string | null }>(
      "SELECT metadata_enrichment_mode FROM public.app_config WHERE id = 1",
    );
    expect(raw.rows[0]?.metadata_enrichment_mode).toBe("unconditional");
  });

  it("setMetadataEnrichmentMode('conditional') → getAppConfig returns conditional", async () => {
    await persistence!.setMetadataEnrichmentMode("conditional");

    const cfg = await persistence!.getAppConfig();
    expect(cfg.metadataEnrichmentMode).toBe("conditional");
  });

  it("setMetadataEnrichmentMode(null) → getAppConfig returns null", async () => {
    // First set a value, then clear it
    await persistence!.setMetadataEnrichmentMode("unconditional");
    await persistence!.setMetadataEnrichmentMode(null);

    const cfg = await persistence!.getAppConfig();
    expect(cfg.metadataEnrichmentMode).toBeNull();

    const raw = await pool.query<{ metadata_enrichment_mode: string | null }>(
      "SELECT metadata_enrichment_mode FROM public.app_config WHERE id = 1",
    );
    expect(raw.rows[0]?.metadata_enrichment_mode).toBeNull();
  });

  it("getMetadataEnrichmentMode() reads the same value as getAppConfig().metadataEnrichmentMode", async () => {
    await persistence!.setMetadataEnrichmentMode("unconditional");

    const direct = await persistence!.getMetadataEnrichmentMode();
    const viaCfg = (await persistence!.getAppConfig()).metadataEnrichmentMode;

    expect(direct).toBe("unconditional");
    expect(direct).toBe(viaCfg);
  });

  it("overwrite: set unconditional then conditional → getAppConfig returns conditional", async () => {
    await persistence!.setMetadataEnrichmentMode("unconditional");
    await persistence!.setMetadataEnrichmentMode("conditional");

    const cfg = await persistence!.getAppConfig();
    expect(cfg.metadataEnrichmentMode).toBe("conditional");
  });

  // ── appendAuditLog with app_config_updated ────────────────────────────────

  it("appendAuditLog(app_config_updated) writes entry with before/after metadata", async () => {
    await persistence!.setMetadataEnrichmentMode("unconditional");

    await persistence!.appendAuditLog({
      actorUserId: adminActorId,
      action: "app_config_updated",
      metadata: {
        before: { metadataEnrichmentMode: null },
        after: { metadataEnrichmentMode: "unconditional" },
      },
    });

    const rows = await pool.query<{
      action: string;
      actor_user_id: string;
      metadata: Record<string, unknown>;
    }>(
      "SELECT action, actor_user_id, metadata FROM audit_log WHERE action = 'app_config_updated' ORDER BY created_at DESC LIMIT 1",
    );
    expect(rows.rowCount).toBe(1);
    const entry = rows.rows[0];
    expect(entry!.action).toBe("app_config_updated");
    expect(entry!.actor_user_id).toBe(adminActorId);
    expect(entry!.metadata).toMatchObject({
      before: { metadataEnrichmentMode: null },
      after: { metadataEnrichmentMode: "unconditional" },
    });
  });

  it("appendAuditLog(app_config_updated) with null→null: metadata records null in both before and after", async () => {
    await persistence!.appendAuditLog({
      actorUserId: adminActorId,
      action: "app_config_updated",
      metadata: {
        before: { metadataEnrichmentMode: null },
        after: { metadataEnrichmentMode: null },
      },
    });

    const rows = await pool.query<{ metadata: Record<string, unknown> }>(
      "SELECT metadata FROM audit_log WHERE action = 'app_config_updated' ORDER BY created_at DESC LIMIT 1",
    );
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0]!.metadata).toMatchObject({
      before: { metadataEnrichmentMode: null },
      after: { metadataEnrichmentMode: null },
    });
  });
});
