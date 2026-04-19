# Integration Tests: Use PostgresPersistence Directly, Not buildApp

Integration tests that need the Postgres backend (`describePostgres`) must instantiate `PostgresPersistence` directly. Do **not** use `buildApp({ persistenceBackend: "postgres" })`.

`buildApp` eagerly connects to Redis for pg-boss, the session store, and rate limiting. The managed `test:integration:full:host` stack only provisions Postgres — there is no Redis available — so any test that calls `buildApp` with the Postgres backend fails with `ECONNREFUSED 127.0.0.1:6379` before the test body runs.

## Canonical patterns

Two established patterns; both are valid. Pick based on whether you need explicit migration control.

**Light pattern — rely on `persistence.init()` for migrations:**
Reference: `apps/api/test/integration/anonymous-share-tokens.integration.test.ts`
```ts
const { PostgresPersistence } = await import("../../src/persistence/postgres.js");
let persistence: PostgresPersistence | null = null;

beforeEach(async () => {
  // reset DB via a temporary pool
  persistence = new PostgresPersistence({ databaseUrl, redisUrl });
  await persistence.init(); // runs migrations internally
});
afterEach(async () => { if (persistence) { await persistence.close(); persistence = null; } });
```

**Full pattern — scoped pool + explicit `applyNumberedMigrations`:**
Reference: `apps/api/test/integration/catalogSync.integration.test.ts` and `apps/api/test/integration/admin-management.integration.test.ts` (added in KZO-149)
```ts
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const { PostgresPersistence } = await import("../../src/persistence/postgres.js");
const { loadMigrationManifest } = await import("../../src/persistence/migrationManifest.js");

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(currentDir, "../../../../db/migrations");
const migrationManifestPromise = loadMigrationManifest(migrationsDir);

describePostgres("...", () => {
  let pool: Pool;
  let persistence: PostgresPersistence | null = null;

  async function resetDatabase() {
    const client = await pool.connect();
    try {
      await client.query("DROP SCHEMA IF EXISTS market_data CASCADE");
      await client.query("DROP SCHEMA IF EXISTS public CASCADE");
      await client.query("CREATE SCHEMA public");
      await client.query("GRANT ALL ON SCHEMA public TO public");
    } finally { client.release(); }
  }
  async function applyNumberedMigrations() {
    const manifest = await migrationManifestPromise;
    const client = await pool.connect();
    try {
      for (const file of manifest.numberedMigrations) {
        const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
        await client.query(sql);
      }
    } finally { client.release(); }
  }

  beforeEach(async () => {
    pool = new Pool({ connectionString: databaseUrl });
    await resetDatabase();
    await applyNumberedMigrations();
    persistence = new PostgresPersistence({ databaseUrl, redisUrl });
    await persistence.init();
  });
  afterEach(async () => { if (persistence) { await persistence.close(); persistence = null; } await pool.end(); });
});
```

## Seed real users for any path that writes to audit_log

Postgres enforces the `audit_log_actor_user_id_fkey` FK; memory backend does not. Do **not** pass hardcoded strings like `"admin-actor"` as `actorUserId` in Postgres tests — seed a real user first:

```ts
let adminActorId: string;
beforeEach(async () => {
  // ... setup persistence
  const { userId } = await persistence!.resolveOrCreateUser(
    "google", "admin-actor-sub", { email: "admin@example.com", name: "Admin" }
  );
  adminActorId = userId;
});

// In tests:
await persistence!.hardPurgeUser(targetId, { actorUserId: adminActorId });
```

Memory-backed unit tests in sibling `describe` blocks can continue to use hardcoded strings — the FK gap is a documented `MemoryPersistence` difference (`test-placement-persistence-backend.md`).

**Why:** Discovered in KZO-149.
- Iter 1 failure: used `buildApp` → Redis ECONNREFUSED.
- Iter 2 failure: after switching to `PostgresPersistence`, the tests hit `audit_log_actor_user_id_fkey` violations because `actorUserId: "admin-actor"` was a hardcoded string, not a seeded UUID.
- Companion rule: `test-placement-persistence-backend.md` documents the memory-vs-Postgres FK enforcement gap.

**How to apply:** Any new integration test that needs `describePostgres`. Always pick the patterns above — do not invent a new init path. Also applies when adding new Postgres-only describe blocks to existing test files that currently use memory-backed `buildApp`.
