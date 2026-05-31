// KZO-198 — Postgres integration tests for the Tier-A app_config layer.
//
// Coverage targets (per scope-todo Phase 5 + design.md §7):
//   1. Migration 047 apply + re-apply idempotency; column types + COMMENTs.
//   2. Persistence layer: setAppConfigPatch round-trips Tier 1 plain fields and
//      Tier 0 secrets; getAppConfig returns the encrypted shape on read.
//   3. Tier 0 rotation — DB column holds ENCRYPTED string (not plaintext),
//      `getEffectiveFinmindApiToken()` resolver decrypts cleanly.
//   4. Decryption fallback — if the DB holds malformed ciphertext, the
//      resolver env-fallbacks and emits `app_config_decrypt_failed` (console.warn
//      per design.md §1; structured emitter is a follow-up).
//
// HTTP-level GET/PATCH round-trips, audit-log shape, and bounds rejection are
// covered by `apps/api/test/http/specs/admin-settings-tier-a-aaa.http.spec.ts`
// (suite 8). This integration test sticks to the persistence + raw SQL layer
// per `.claude/rules/integration-test-persistence-direct.md`.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Override the encryption key resolver. `Env` is parsed once at module load
// and frozen — the only way to drive `Env.APP_CONFIG_ENCRYPTION_KEY` is to
// proxy the mocked `@vakwen/config` module. Pattern matches
// `apps/api/test/unit/appConfig/encryption.test.ts`.
const TEST_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const mockEnv: { APP_CONFIG_ENCRYPTION_KEY?: string } = {
  APP_CONFIG_ENCRYPTION_KEY: TEST_KEY,
};
vi.mock("@vakwen/config", async (importOriginal) => {
  const original = await importOriginal<typeof import("@vakwen/config")>();
  return {
    ...original,
    Env: new Proxy(
      { ...original.Env },
      {
        get(target, prop) {
          if (prop === "APP_CONFIG_ENCRYPTION_KEY") {
            return mockEnv.APP_CONFIG_ENCRYPTION_KEY;
          }
          return (target as Record<string | symbol, unknown>)[prop];
        },
      },
    ),
  };
});

const { PostgresPersistence } = await import("../../src/persistence/postgres.js");
const { loadMigrationManifest } = await import("../../src/persistence/migrationManifest.js");
const {
  _resetAppConfigCache,
  refresh: refreshAppConfigCache,
  setAppConfigCachePersistence,
} = await import("../../src/services/appConfig/cache.js");
const {
  getEffectiveFinmindApiToken,
  getEffectiveTwelveDataApiKey,
} = await import("../../src/services/appConfig/providerKeys.js");
const { encryptSecret, decryptSecret } = await import(
  "../../src/services/appConfig/encryption.js"
);

// ── Postgres integration guard ───────────────────────────────────────────────

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

// Columns that migration 047 adds (camelCase ↔ snake_case map).
const TIER_A_COLUMNS: ReadonlyArray<{ camel: string; snake: string; pgType: string }> = [
  { camel: "finmindApiTokenEncrypted",                  snake: "finmind_api_token",                       pgType: "text"   },
  { camel: "twelveDataApiKeyEncrypted",                 snake: "twelve_data_api_key",                     pgType: "text"   },
  { camel: "marketDataPriceWindowMs",                   snake: "market_data_price_window_ms",             pgType: "integer"},
  { camel: "marketDataPriceLimit",                      snake: "market_data_price_limit",                 pgType: "integer"},
  { camel: "marketDataSearchWindowMs",                  snake: "market_data_search_window_ms",            pgType: "integer"},
  { camel: "marketDataSearchLimit",                     snake: "market_data_search_limit",                pgType: "integer"},
  { camel: "inviteStatusWindowMs",                      snake: "invite_status_window_ms",                 pgType: "integer"},
  { camel: "inviteStatusLimit",                         snake: "invite_status_limit",                     pgType: "integer"},
  { camel: "providerDownNotificationSuppressionMs",     snake: "provider_down_notification_suppression_ms", pgType: "bigint" },
  { camel: "providerErrorTrailRetentionDays",           snake: "provider_error_trail_retention_days",     pgType: "integer"},
  { camel: "providerRerunCooldownMs",                   snake: "provider_rerun_cooldown_ms",              pgType: "bigint" },
  { camel: "backfillRetryLimit",                        snake: "backfill_retry_limit",                    pgType: "integer"},
  { camel: "backfillRetryDelaySeconds",                 snake: "backfill_retry_delay_seconds",            pgType: "integer"},
  { camel: "backfillFinmind402RetryMs",                 snake: "backfill_finmind_402_retry_ms",           pgType: "bigint" },
  { camel: "dailyRefreshLookbackDays",                  snake: "daily_refresh_lookback_days",             pgType: "integer"},
  { camel: "dailyRefreshPriority",                      snake: "daily_refresh_priority",                  pgType: "integer"},
  { camel: "sseHeartbeatIntervalMs",                    snake: "sse_heartbeat_interval_ms",               pgType: "integer"},
  { camel: "sseMaxConnectionsPerUser",                  snake: "sse_max_connections_per_user",            pgType: "integer"},
  { camel: "sseBufferDefaultTtlMs",                     snake: "sse_buffer_default_ttl_ms",               pgType: "bigint" },
];

describePostgres("KZO-198 — app_config Tier A (Postgres)", () => {
  let pool: Pool;
  let persistence: InstanceType<typeof PostgresPersistence> | null = null;

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

  beforeEach(async () => {
    pool = new Pool({ connectionString: databaseUrl });
    await resetDatabase();
    await applyNumberedMigrations();
    persistence = new PostgresPersistence({
      databaseUrl: databaseUrl!,
      redisUrl: redisUrl!,
    });
    await persistence.init();
    _resetAppConfigCache();
    setAppConfigCachePersistence(persistence);
    mockEnv.APP_CONFIG_ENCRYPTION_KEY = TEST_KEY;
  });

  afterEach(async () => {
    _resetAppConfigCache();
    if (persistence) {
      await persistence.close();
      persistence = null;
    }
    await pool.end();
  });

  // ── 1. Migration 047 apply + re-apply idempotency ─────────────────────────

  describe("migration 047 — schema", () => {
    it("adds all 19 columns to public.app_config with the correct pg type", async () => {
      const r = await pool.query<{ column_name: string; data_type: string; is_nullable: string }>(
        `SELECT column_name, data_type, is_nullable
         FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'app_config'`,
      );
      const byName = new Map(r.rows.map((row) => [row.column_name, row]));
      for (const c of TIER_A_COLUMNS) {
        const row = byName.get(c.snake);
        expect(row, `column ${c.snake} exists`).toBeDefined();
        // text or integer or bigint per the migration spec.
        expect(row?.data_type).toBe(c.pgType);
        expect(row?.is_nullable).toBe("YES");
      }
    });

    it("attaches a COMMENT to every Tier-A column (operator runbook hint)", async () => {
      const r = await pool.query<{ column_name: string; comment: string | null }>(
        `SELECT a.attname AS column_name, pgd.description AS comment
         FROM pg_catalog.pg_class c
         JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0
         LEFT JOIN pg_catalog.pg_description pgd
                ON pgd.objoid = c.oid AND pgd.objsubid = a.attnum
         WHERE c.relname = 'app_config' AND a.attisdropped = false`,
      );
      const byName = new Map(r.rows.map((row) => [row.column_name, row.comment]));
      for (const c of TIER_A_COLUMNS) {
        expect(
          byName.get(c.snake),
          `column ${c.snake} has a COMMENT`,
        ).toBeTruthy();
      }
    });

    it("re-applying migration 047 is idempotent (no error, no schema drift)", async () => {
      const sql = await fs.readFile(
        path.join(migrationsDir, "047_kzo198_app_config_tier_a_constants.sql"),
        "utf8",
      );
      // Re-run the migration; ADD COLUMN IF NOT EXISTS makes it a no-op.
      await expect(pool.query(sql)).resolves.toBeDefined();

      const r = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'app_config'
           AND column_name IN (${TIER_A_COLUMNS.map((_, i) => `$${i + 1}`).join(", ")})`,
        TIER_A_COLUMNS.map((c) => c.snake),
      );
      expect(Number(r.rows[0]?.count ?? 0)).toBe(TIER_A_COLUMNS.length);
    });
  });

  // ── 2. Persistence layer round-trip ─────────────────────────────────────

  describe("PostgresPersistence — Tier A round-trip", () => {
    it("setAppConfigPatch({marketDataPriceWindowMs:30_000}) persists; getAppConfig returns it", async () => {
      await persistence!.setAppConfigPatch({ marketDataPriceWindowMs: 30_000 });
      const row = await persistence!.getAppConfig();
      expect(row.marketDataPriceWindowMs).toBe(30_000);
    });

    it("setAppConfigPatch({backfillFinmind402RetryMs:7_200_000}) persists as bigint", async () => {
      await persistence!.setAppConfigPatch({ backfillFinmind402RetryMs: 7_200_000 });
      const raw = await pool.query<{ backfill_finmind_402_retry_ms: number | string }>(
        `SELECT backfill_finmind_402_retry_ms FROM public.app_config WHERE id = 1`,
      );
      expect(Number(raw.rows[0]?.backfill_finmind_402_retry_ms)).toBe(7_200_000);
      const row = await persistence!.getAppConfig();
      expect(Number(row.backfillFinmind402RetryMs)).toBe(7_200_000);
    });

    it("setAppConfigPatch({finmindApiToken:plaintext}) writes ENCRYPTED ciphertext to DB", async () => {
      const PLAINTEXT = "tier-a-int-test-finmind-token-xx";
      await persistence!.setAppConfigPatch({ finmindApiToken: PLAINTEXT });

      const raw = await pool.query<{ finmind_api_token: string | null }>(
        `SELECT finmind_api_token FROM public.app_config WHERE id = 1`,
      );
      const stored = raw.rows[0]?.finmind_api_token;
      expect(stored, "finmind_api_token populated").toBeTruthy();
      // The stored shape is `nonce_b64:ct+tag_b64` — NOT the plaintext.
      expect(stored).not.toBe(PLAINTEXT);
      expect(stored).not.toContain(PLAINTEXT);
      expect(stored?.split(":").length).toBe(2);

      // And it round-trips through the decryptor under the live key.
      expect(decryptSecret(stored!)).toBe(PLAINTEXT);
    });

    it("setAppConfigPatch({finmindApiToken:null}) clears the encrypted column to NULL", async () => {
      await persistence!.setAppConfigPatch({
        finmindApiToken: "tier-a-int-test-finmind-token-xx",
      });
      const seeded = await pool.query<{ finmind_api_token: string | null }>(
        `SELECT finmind_api_token FROM public.app_config WHERE id = 1`,
      );
      expect(seeded.rows[0]?.finmind_api_token).toBeTruthy();

      await persistence!.setAppConfigPatch({ finmindApiToken: null });
      const cleared = await pool.query<{ finmind_api_token: string | null }>(
        `SELECT finmind_api_token FROM public.app_config WHERE id = 1`,
      );
      expect(cleared.rows[0]?.finmind_api_token).toBeNull();
    });

    it("setAppConfigPatch bumps updated_at on each successful write", async () => {
      await persistence!.setAppConfigPatch({ marketDataPriceWindowMs: 30_000 });
      const t0 = (await persistence!.getAppConfig()).updatedAt;
      // Different value -> different write.
      await persistence!.setAppConfigPatch({ marketDataPriceWindowMs: 45_000 });
      const t1 = (await persistence!.getAppConfig()).updatedAt;
      expect(Date.parse(t1)).toBeGreaterThanOrEqual(Date.parse(t0));
    });
  });

  // ── 3. Resolver decrypts cleanly + cache invalidate flow ────────────────

  describe("getEffectiveFinmindApiToken — resolver via cache", () => {
    it("after setAppConfigPatch + cache.refresh(), the resolver returns the decrypted plaintext", async () => {
      const PLAINTEXT = "resolver-decrypt-finmind-token-x";
      await persistence!.setAppConfigPatch({ finmindApiToken: PLAINTEXT });
      await refreshAppConfigCache();

      expect(getEffectiveFinmindApiToken()).toBe(PLAINTEXT);
    });

    it("getEffectiveTwelveDataApiKey returns plaintext after the analogous flow", async () => {
      const PLAINTEXT = "resolver-decrypt-twelve-data-key-yyy";
      await persistence!.setAppConfigPatch({ twelveDataApiKey: PLAINTEXT });
      await refreshAppConfigCache();

      expect(getEffectiveTwelveDataApiKey()).toBe(PLAINTEXT);
    });
  });

  // ── 4. Decryption fallback — bad ciphertext → env fallback + warn ──────

  describe("decryption fallback", () => {
    it("malformed ciphertext written directly to DB → resolver env-fallbacks; console.warn captures app_config_decrypt_failed", async () => {
      // Bypass setAppConfigPatch and write a malformed value directly.
      await pool.query(
        `INSERT INTO public.app_config (id, finmind_api_token, updated_at)
         VALUES (1, 'totally-malformed-not-base64-no-colon', NOW())
         ON CONFLICT (id) DO UPDATE SET finmind_api_token = EXCLUDED.finmind_api_token, updated_at = NOW()`,
      );
      await refreshAppConfigCache();

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const result = getEffectiveFinmindApiToken();

      // env fallback — APP_CONFIG_ENCRYPTION_KEY is the test fixture, no
      // FINMIND_API_TOKEN env override → undefined.
      // (We do NOT assert a specific value; only that no exception escapes
      // and the resolver did not return the malformed string.)
      expect(result).not.toBe("totally-malformed-not-base64-no-colon");

      expect(warnSpy).toHaveBeenCalledWith(
        "app_config_decrypt_failed",
        expect.objectContaining({
          field: "finmind_api_token",
          reason: "malformed_input",
        }),
      );
      warnSpy.mockRestore();
    });

    it("rotated-key ciphertext (encrypted under one key, decrypted under another) → tag_mismatch fallback", async () => {
      const PLAINTEXT = "rotated-key-finmind-token-xxxxxxxx";
      // Encrypt under TEST_KEY then rotate.
      const ciphertext = encryptSecret(PLAINTEXT);
      await pool.query(
        `INSERT INTO public.app_config (id, finmind_api_token, updated_at)
         VALUES (1, $1, NOW())
         ON CONFLICT (id) DO UPDATE SET finmind_api_token = EXCLUDED.finmind_api_token, updated_at = NOW()`,
        [ciphertext],
      );
      await refreshAppConfigCache();

      // Rotate the in-mem key — stored ciphertext no longer authenticates.
      mockEnv.APP_CONFIG_ENCRYPTION_KEY =
        "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const result = getEffectiveFinmindApiToken();
      // Resolver env-fallback (no env token configured → undefined).
      expect(result).not.toBe(PLAINTEXT);
      expect(warnSpy).toHaveBeenCalledWith(
        "app_config_decrypt_failed",
        expect.objectContaining({
          field: "finmind_api_token",
          reason: expect.stringMatching(/tag_mismatch|bad_key/),
        }),
      );
      warnSpy.mockRestore();
    });
  });
});
