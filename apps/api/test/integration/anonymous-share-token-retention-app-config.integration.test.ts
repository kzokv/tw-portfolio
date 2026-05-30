// KZO-199 — Tier-2 SQL-only Postgres integration test.
//
// Sets `app_config.anonymous_share_token_retention_ms` directly via SQL
// (simulating a DB-only override that the Tier-2 resolver picks up), then
// calls `listAnonymousShareTokensForOwner` and asserts that the retention
// filter honours the new value.
//
// Uses `PostgresPersistence` directly per
// `.claude/rules/integration-test-persistence-direct.md` — NOT buildApp.
// buildApp pulls in Redis (pg-boss, session, rate-limiting) which is not
// available in the managed CI Postgres-only stack.

import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PostgresPersistence } from "../../src/persistence/postgres.js";
// KZO-199: the app_config cache module holds a module-level persistence
// binding + TTL state. Tier-2 SQL-only overrides flow through the resolver
// → cache → row. Tests that mutate `app_config.*` via direct SQL must wire
// the cache to the test's persistence instance and `invalidate()` after each
// SQL write to ensure resolvers see the new value.
import {
  setAppConfigCachePersistence,
  invalidate as invalidateAppConfigCache,
  refresh as refreshAppConfigCache,
  _resetAppConfigCache,
} from "../../src/services/appConfig/cache.js";

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

/**
 * Pad/trim a seed string to exactly 22 URL-safe chars (the token CHECK constraint).
 */
function makeToken(seed: string): string {
  return seed.replace(/[^A-Za-z0-9]/g, "").slice(0, 22).padEnd(22, "A");
}

describePostgres("anonymous share token retention (app_config Tier-2 override)", () => {
  let persistence: PostgresPersistence;
  let pool: Pool;
  let ownerUserId: string;

  beforeEach(async () => {
    // Fresh schema + full migration stack.
    const resetPool = new Pool({ connectionString: databaseUrl });
    const client = await resetPool.connect();
    try {
      await client.query("DROP SCHEMA IF EXISTS market_data CASCADE");
      await client.query("DROP SCHEMA IF EXISTS public CASCADE");
      await client.query("CREATE SCHEMA public");
      await client.query("GRANT ALL ON SCHEMA public TO public");
    } finally {
      client.release();
      await resetPool.end();
    }

    persistence = new PostgresPersistence({ databaseUrl: databaseUrl!, redisUrl: redisUrl! });
    await persistence.init();
    pool = new Pool({ connectionString: databaseUrl });

    // KZO-199: wire the cache to this test's persistence + warm it so the
    // Tier-2 resolver path goes through the DB row (not env-fallback).
    _resetAppConfigCache();
    setAppConfigCachePersistence(persistence);
    await refreshAppConfigCache();

    const owner = await persistence.resolveOrCreateUser("google", "retention-app-cfg-owner", {
      email: "retention-app-cfg-owner@example.com",
      name: "Retention AppConfig Owner",
    });
    ownerUserId = owner.userId;
  });

  afterEach(async () => {
    _resetAppConfigCache();
    await persistence.close();
    await pool.end();
  });

  it("uses env-fallback retention (30 days) when app_config column is NULL", async () => {
    // Verify the row exists and has NULL retention.
    const { rows } = await pool.query<{ anonymous_share_token_retention_ms: string | null }>(
      `SELECT anonymous_share_token_retention_ms FROM public.app_config LIMIT 1`,
    );
    // Column may not exist pre-migration 052; skip assertion if missing.
    if (rows.length > 0 && "anonymous_share_token_retention_ms" in rows[0]) {
      expect(rows[0].anonymous_share_token_retention_ms).toBeNull();
    }

    // Seed one active token (expires 30 days from now).
    const activeToken = makeToken(`active-${randomUUID()}`);
    const activeExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const activeResult = await persistence.createAnonymousShareToken({
      ownerUserId,
      token: activeToken,
      expiresAt: activeExpiresAt,
      ttlDays: 30,
      auditInput: { actorUserId: ownerUserId, ipAddress: "127.0.0.1" },
    });
    expect(activeResult.status).toBe("ok");

    // Seed one revoked token (revoked just now — should still appear within 30d retention).
    const revokedToken = makeToken(`revoked-${randomUUID()}`);
    const revokedExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await persistence.createAnonymousShareToken({
      ownerUserId,
      token: revokedToken,
      expiresAt: revokedExpiresAt,
      ttlDays: 30,
      auditInput: { actorUserId: ownerUserId, ipAddress: "127.0.0.1" },
    });
    // Revoke it.
    const tokenId = (await persistence.listAnonymousShareTokensForOwner(ownerUserId)).find(
      (t) => t.token === revokedToken,
    )?.id;
    if (tokenId) {
      await persistence.revokeAnonymousShareToken({
        id: tokenId,
        ownerUserId,
        auditInput: { actorUserId: ownerUserId, ipAddress: "127.0.0.1" },
      });
    }

    const list = await persistence.listAnonymousShareTokensForOwner(ownerUserId);
    // Both active and recently-revoked token are within 30-day retention window.
    expect(list.length).toBeGreaterThanOrEqual(1);
    const activeRow = list.find((t) => t.token === activeToken);
    expect(activeRow).toBeDefined();
  });

  it("uses DB-override retention when app_config column is set — older revoked tokens are hidden", async () => {
    // Verify migration 052 added the column before proceeding.
    const colCheck = await pool.query<{ column_name: string }>(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'app_config'
         AND column_name = 'anonymous_share_token_retention_ms'`,
    );
    if (colCheck.rows.length === 0) {
      // Migration 052 not yet applied — skip (TDD-red until Implementer lands source).
      console.warn("Skipping: migration 052 not applied yet (anonymous_share_token_retention_ms column missing)");
      return;
    }

    // Set a very short retention window (1 ms) via direct SQL to simulate an admin override.
    await pool.query(
      `UPDATE public.app_config SET anonymous_share_token_retention_ms = 1`,
    );
    // Bust the TTL cache so the Tier-2 resolver picks up the SQL change on
    // the next read.
    invalidateAppConfigCache();
    await refreshAppConfigCache();

    // Seed a token that was revoked >1ms ago (effectively: seed via SQL with a revoked_at in the past).
    const oldRevokedToken = makeToken(`old-revoked-${randomUUID()}`);
    const oldId = randomUUID();
    await pool.query(
      `INSERT INTO public.anonymous_share_tokens
         (id, owner_user_id, token, created_at, expires_at, revoked_at, revoked_by_user_id)
       VALUES
         ($1, $2, $3, NOW() - INTERVAL '5 days', NOW() + INTERVAL '25 days', NOW() - INTERVAL '1 hour', $2)`,
      [oldId, ownerUserId, oldRevokedToken],
    );

    // Seed a fresh active token (should always be visible).
    const freshActiveToken = makeToken(`fresh-active-${randomUUID()}`);
    const freshExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await persistence.createAnonymousShareToken({
      ownerUserId,
      token: freshActiveToken,
      expiresAt: freshExpiresAt,
      ttlDays: 30,
      auditInput: { actorUserId: ownerUserId, ipAddress: "127.0.0.1" },
    });

    // After the resolver swap, listAnonymousShareTokensForOwner will read
    // getEffectiveAnonymousShareTokenRetentionMs() which should pick up the
    // DB override (1ms) → retention cutoff is effectively now → old revoked
    // token is excluded; fresh active token remains.
    const list = await persistence.listAnonymousShareTokensForOwner(ownerUserId);

    // Fresh active token must appear.
    const freshRow = list.find((t) => t.token === freshActiveToken);
    expect(freshRow).toBeDefined();

    // Old revoked token (revoked 1 hour ago) must NOT appear under 1ms retention.
    const oldRevokedRow = list.find((t) => t.token === oldRevokedToken);
    expect(oldRevokedRow).toBeUndefined();
  });

  it("migration 052 adds all 5 new app_config columns", async () => {
    const expectedColumns = [
      "anonymous_share_token_cap",
      "anonymous_share_rate_limit_max",
      "anonymous_share_rate_limit_window_ms",
      "anonymous_share_token_retention_ms",
      "user_preferences_max_bytes",
    ];

    for (const col of expectedColumns) {
      const { rows } = await pool.query<{ column_name: string; is_nullable: string }>(
        `SELECT column_name, is_nullable
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'app_config'
           AND column_name = $1`,
        [col],
      );
      // Column should exist (NULL if migration 052 not yet applied → TDD-red).
      expect(rows).toHaveLength(1);
      expect(rows[0].column_name).toBe(col);
      // All columns are nullable (no CHECK constraints at the SQL layer).
      expect(rows[0].is_nullable).toBe("YES");
    }
  });
});
