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

## Testing retention / purge crons — raw INSERT with SQL interval literals

Retention and purge logic (any DELETE predicate based on `NOW() - interval`) is untestable through the public persistence API alone — `createAnonymousShareToken`, `createAuditEntry`, etc. stamp `created_at` / `expires_at` from `NOW()`, so you cannot produce old rows through them. Seed these rows via raw `pool.query` with SQL interval literals instead:

```ts
await pool.query(
  `INSERT INTO anonymous_share_tokens
     (id, owner_user_id, token_hash, created_at, expires_at, revoked_at)
   VALUES
     ('id-old-revoked',    $1, 'hasholdrevokedAAAAAAAA',  NOW() - INTERVAL '120 days', NOW() + INTERVAL '30 days', NOW() - INTERVAL '100 days'),
     ('id-old-expired',    $1, 'hasholdexpiredAAAAAAAA',  NOW() - INTERVAL '120 days', NOW() - INTERVAL '100 days', NULL),
     ('id-recent-revoked', $1, 'hashrecentrevokedAAAA',   NOW() - INTERVAL '10 days',  NOW() + INTERVAL '20 days',  NOW() - INTERVAL '10 days'),
     ('id-active-old',     $1, 'hashactiveoldAAAAAAAAA',  NOW() - INTERVAL '120 days', NOW() + INTERVAL '30 days', NULL)`,
  [ownerUserId],
);
```

**Mandatory patterns:**
1. **Deterministic ids** (`'id-old-revoked'`, not UUIDs) so `ORDER BY id` assertions are stable.
2. **Terminality regression guard row.** If the SQL filters on "terminality older than N days," include a row with OLD `created_at` but FUTURE `expires_at` and `revoked_at IS NULL` — it must be PRESERVED. This catches any regression that uses `created_at` instead of revocation/expiration as the purge yardstick.
3. **Token-hash shape compliance** — if the column has a CHECK constraint (e.g. `^[A-Za-z0-9]{22}$`), pad literal strings to the exact length.
4. **Seed FK parents first.** Use `persistence.resolveOrCreateUser(...)` (or equivalent) before INSERTing rows that reference `users`, then pass the UUID via parameterized `$1` — never a hardcoded string.

**Sibling memory no-op in the same file.** Retention methods that are Postgres-only (MemoryPersistence returns 0 as documented no-op) need a second `describe` block OUTSIDE `describePostgres` so it always runs. Seed via the public API (since `createAnonymousShareToken` etc. work on MemoryPersistence), call the purge method with `olderThanMs: 0`, assert returns 0 and token count unchanged.

Canonical reference: `apps/api/test/integration/anonymous-share-token-purge.integration.test.ts` (KZO-152).

**Why:** Discovered in KZO-152 for the `anonymous_share_tokens` 90-day purge cron. The regression guard row caught an early draft of the DELETE SQL that used `created_at < NOW() - interval` — it would have deleted active tokens with old creation dates. The pattern generalizes to any retention/purge cron this repo ships (rate-limit bucket eviction, notification archival, audit-log TTL, etc.).

**How to apply:** Any integration test asserting a retention/purge DELETE predicate. Use raw INSERT with SQL interval literals; include the terminality regression guard row; always pair with a memory no-op `it`.

## Schema-qualified table names in raw test SQL — `market_data.` is mandatory

Postgres `search_path` defaults to `"$user", public`. The `market_data` schema is **not** in the default path. Any raw `INSERT/SELECT/UPDATE/DELETE` in test code that targets a `market_data.*` table (`instruments`, `daily_bars`, `dividend_events`, `fx_rates`, etc.) **must** use the fully qualified name. A bare `INSERT INTO instruments` throws `relation "instruments" does not exist` at runtime — invisible to typecheck.

```sql
-- ❌ Wrong — runtime "relation does not exist"
INSERT INTO instruments (ticker, market_code, ...) VALUES (...);
SELECT bars_backfill_status FROM instruments WHERE ticker = $1;

-- ✅ Correct
INSERT INTO market_data.instruments (ticker, market_code, ...) VALUES (...);
SELECT bars_backfill_status FROM market_data.instruments WHERE ticker = $1;
```

**Why:** Caught in KZO-185 iter 1 — `seedInstrument()` and the assertion query in `backfill-old-shape-rejection.integration.test.ts` both omitted the `market_data.` prefix. The bug was obvious only because the sibling `daily_bars` query in the same file *was* schema-qualified — the inconsistency made it visible in CR. Without that contrast it could have shipped past green typecheck.

**How to apply:** Rule of thumb when writing raw SQL in any `apps/api/test/**` integration test against `market_data.*` tables. Pre-PR check: `grep -nE "(INSERT INTO|FROM|UPDATE|DELETE FROM) (instruments|daily_bars|dividend_events|fx_rates)\b"` inside the changed test file — every match must have the `market_data.` prefix.

## Seeding rows pre-populated by `persistence.init()` — use `ON CONFLICT DO UPDATE`

`PostgresPersistence.init()` pre-seeds a small set of rows into `market_data.instruments` (and similar bootstrap tables) with schema defaults — e.g. `(ticker, market_code) = ('2330', 'TW')` with `bars_backfill_status = 'pending'`. Test seed helpers that target the **same** PK with `ON CONFLICT DO NOTHING` become silent no-ops — the row already exists with the default values.

If your test asserts on a specific value of a non-PK column (e.g. `bars_backfill_status='ready'`), the seed **must** `DO UPDATE` so the pre-seeded row is actively overwritten:

```sql
-- ❌ Wrong when asserting on non-PK columns — silently keeps `init()`'s defaults
INSERT INTO market_data.instruments (ticker, market_code, name, instrument_type, bars_backfill_status)
VALUES ($1, $2, $3, 'STOCK', 'ready')
ON CONFLICT (ticker, market_code) DO NOTHING;

-- ✅ Correct
INSERT INTO market_data.instruments (ticker, market_code, name, instrument_type, bars_backfill_status)
VALUES ($1, $2, $3, 'STOCK', 'ready')
ON CONFLICT (ticker, market_code) DO UPDATE
  SET bars_backfill_status = EXCLUDED.bars_backfill_status,
      name                 = EXCLUDED.name,
      instrument_type      = EXCLUDED.instrument_type;
```

**Why:** Caught in KZO-185 iter 2 — `backfill-old-shape-rejection.integration.test.ts` initially used `DO NOTHING`. The test asserted `bars_backfill_status='ready'` after the seed but read `'pending'` because `persistence.init()` had already written the row with the schema default. Cost one full convergence iteration to triage.

**How to apply:** Any new Postgres integration test that seeds a row whose PK could collide with `init()`'s pre-seeded set, AND asserts on a non-PK column. The conservative default is `DO UPDATE` listing every column the test expects to control. `DO NOTHING` is only correct when the test asserts solely on existence by PK.
