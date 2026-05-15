/**
 * ui-enhancement — Integration tests for restoreAccount name-collision
 * auto-rename behaviour against the partial-unique-index introduced in
 * migration 053.
 *
 * Per architect-design.md §4:
 *  - Single collision → "{name} (restored)"
 *  - Second collision → "{name} (restored 2)"
 *  - Up to N=20 attempts; N=21st collision throws
 *    routeError(409, "account_restore_name_unresolvable", ...).
 *
 * Postgres-side validation: the partial unique index
 * `ux_accounts_user_id_name_active` only constrains `deleted_at IS NULL` rows,
 * so a soft-deleted account is allowed to share `name` with an active row at
 * the row level — but restore must auto-rename to keep both visible.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const { PostgresPersistence } = await import("../../src/persistence/postgres.js");
const { loadMigrationManifest } = await import("../../src/persistence/migrationManifest.js");
const { createDefaultFeeProfile } = await import("../../src/services/store.js");

const databaseUrl = process.env.POSTGRES_TEST_DB_URL ?? process.env.DB_URL;
const redisUrl = process.env.POSTGRES_TEST_REDIS_URL ?? process.env.REDIS_URL;
const runPostgresIntegration = process.env.RUN_POSTGRES_INTEGRATION === "1";
const managedCiStack = process.env.VAKWEN_MANAGED_CI_STACK === "1";
if (runPostgresIntegration && !managedCiStack) {
  throw new Error(
    "RUN_POSTGRES_INTEGRATION=1 must be executed via npm run test:integration:full:host",
  );
}
const shouldRunPostgresSuite = runPostgresIntegration && Boolean(databaseUrl) && Boolean(redisUrl);
const describePostgres = shouldRunPostgresSuite ? describe : describe.skip;

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(currentDir, "../../../../db/migrations");
const migrationManifestPromise = loadMigrationManifest(migrationsDir);

describePostgres("restoreAccount name-collision (Postgres)", () => {
  let pool: Pool;
  let persistence: InstanceType<typeof PostgresPersistence> | null = null;
  let ownerUserId: string;

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

  /**
   * Seed a new active account + its own matching FeeProfile (composite FK
   * per migration 042: accounts.(fee_profile_id, id) → fee_profiles(id,
   * account_id)). Reusing acc-1's profile id for another account would
   * violate the FK.
   */
  async function pushAccount(id: string, name: string): Promise<void> {
    const store = await persistence!.loadStore(ownerUserId);
    const feeProfileId = `fp-${id}`;
    store.feeProfiles.push(createDefaultFeeProfile(id, "TWD", feeProfileId));
    store.accounts.push({
      id,
      userId: ownerUserId,
      name,
      feeProfileId,
      defaultCurrency: "TWD",
      accountType: "broker",
    });
    await persistence!.saveStore(store);
  }

  beforeEach(async () => {
    pool = new Pool({ connectionString: databaseUrl });
    await resetDatabase();
    await applyNumberedMigrations();
    persistence = new PostgresPersistence({ databaseUrl: databaseUrl!, redisUrl: redisUrl! });
    await persistence.init();
    const seeded = await persistence.resolveOrCreateUser(
      "google",
      "ui-enhancement-restore-coll-sub",
      { email: "uie-restore-coll@example.com", name: "Coll Owner" },
    );
    ownerUserId = seeded.userId;
  });

  afterEach(async () => {
    if (persistence) {
      await persistence.close();
      persistence = null;
    }
    await pool.end();
  });

  it("auto-renames to '{name} (restored)' on single collision", async () => {
    await pushAccount("acc-r-1", "Echo");
    await persistence!.softDeleteAccount("acc-r-1", ownerUserId, { actorUserId: ownerUserId, ipAddress: null, metadata: {} });
    await pushAccount("acc-r-2", "Echo");

    const result = await persistence!.restoreAccount("acc-r-1", ownerUserId, {
      actorUserId: ownerUserId,
      ipAddress: null,
      metadata: {},
    });

    expect(result.finalName).toBe("Echo (restored)");

    // DB-side: both rows visible with distinct names.
    const { rows } = await pool.query(
      "SELECT id, name FROM accounts WHERE user_id = $1 AND deleted_at IS NULL ORDER BY id",
      [ownerUserId],
    );
    const names = rows.map((r) => r.name as string);
    expect(names).toContain("Echo");
    expect(names).toContain("Echo (restored)");
  });

  it("recurses to '{name} (restored 2)' when single suffix also collides", async () => {
    await pushAccount("acc-r-1", "Foxtrot");
    await persistence!.softDeleteAccount("acc-r-1", ownerUserId, { actorUserId: ownerUserId, ipAddress: null, metadata: {} });
    await pushAccount("acc-r-2", "Foxtrot");
    await pushAccount("acc-r-3", "Foxtrot (restored)");

    const result = await persistence!.restoreAccount("acc-r-1", ownerUserId, {
      actorUserId: ownerUserId,
      ipAddress: null,
      metadata: {},
    });
    expect(result.finalName).toBe("Foxtrot (restored 2)");
  });

  it("throws 409 account_restore_name_unresolvable after N=20 attempts", async () => {
    await pushAccount("acc-r-1", "Golf");
    await persistence!.softDeleteAccount("acc-r-1", ownerUserId, { actorUserId: ownerUserId, ipAddress: null, metadata: {} });
    // Pre-seed the original name AND every "(restored N)" slot 1..20.
    await pushAccount("acc-r-base", "Golf");
    await pushAccount("acc-r-suffix-1", "Golf (restored)");
    for (let n = 2; n <= 20; n += 1) {
      await pushAccount(`acc-r-suffix-${n}`, `Golf (restored ${n})`);
    }

    await expect(
      persistence!.restoreAccount("acc-r-1", ownerUserId, {
        actorUserId: ownerUserId,
        ipAddress: null,
        metadata: {},
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });
});
