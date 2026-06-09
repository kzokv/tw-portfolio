// KZO-159 (158A): Persistence + resolver integration tests for user
// preferences and the 3-tier effective-ranges pipeline.
//
// Scope (per qa-test-plan + Architect Q1):
//   - Postgres persistence semantics (getUserPreferences / setUserPreferencePatch
//     / _setUserPreferences / setDashboardPerformanceRanges / getAppConfig),
//     including lazy-insert, null-delete, atomic single-UPDATE merge,
//     top-level-replace of nested objects/arrays, and ON DELETE CASCADE.
//   - `resolveEffectiveRanges` 3-tier precedence against real persistence
//     (user → admin → default) + edge cases (empty intersection, invalid
//     stored pref, admin-prune).
//   - Sibling memory-backend `describe` block asserting parity on the same
//     semantics where the memory emulation must match (D13).
//
// OUT OF SCOPE (owned elsewhere per Architect [PROCEED]):
//   - Route-level 400/413/auth gating → `apps/api/test/http/user-preferences.http.spec.ts` (suite 8).
//   - Parser + shared zod schema unit tests → `libs/domain/test/performanceRange.test.ts`.
//
// Tests use `PostgresPersistence` directly (not `buildApp`) per the
// integration-test-persistence-direct.md rule — the managed test stack has
// no Redis for pg-boss.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const { PostgresPersistence } = await import("../../src/persistence/postgres.js");
const { MemoryPersistence } = await import("../../src/persistence/memory.js");
const { loadMigrationManifest } = await import("../../src/persistence/migrationManifest.js");
const { resolveEffectiveRanges } = await import("../../src/services/userPreferences.js");
const { DEFAULT_DASHBOARD_PERFORMANCE_RANGES } = await import("@vakwen/shared-types");

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

const shouldRunPostgresSuite = runPostgresIntegration && Boolean(databaseUrl) && Boolean(redisUrl);
const describePostgres = shouldRunPostgresSuite ? describe : describe.skip;

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(currentDir, "../../../../db/migrations");
const migrationManifestPromise = loadMigrationManifest(migrationsDir);

// ── Postgres integration suite ────────────────────────────────────────────────

describePostgres("user_preferences + effective-ranges (Postgres)", () => {
  let pool: Pool;
  let persistence: InstanceType<typeof PostgresPersistence> | null = null;
  let userId: string;
  let otherUserId: string;

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

    // Seed two users so we can assert per-user isolation.
    const primary = await persistence.resolveOrCreateUser("google", "kzo-159-primary-sub", {
      email: "kzo159-primary@example.com",
      name: "KZO-159 Primary",
    });
    userId = primary.userId;
    const secondary = await persistence.resolveOrCreateUser("google", "kzo-159-secondary-sub", {
      email: "kzo159-secondary@example.com",
      name: "KZO-159 Secondary",
    });
    otherUserId = secondary.userId;
  });

  afterEach(async () => {
    if (persistence) {
      await persistence.close();
      persistence = null;
    }
    await pool.end();
  });

  // ── Persistence semantics: getUserPreferences / setUserPreferencePatch ──

  describe("getUserPreferences — lazy read", () => {
    it("returns empty object when no row exists (no insert side effect)", async () => {
      const prefs = await persistence!.getUserPreferences(userId);
      expect(prefs).toEqual({});

      const { rowCount } = await pool.query(
        "SELECT 1 FROM public.user_preferences WHERE user_id = $1",
        [userId],
      );
      expect(rowCount).toBe(0);
    });
  });

  describe("setUserPreferencePatch — create + merge + null-delete", () => {
    it("creates a row on first call and persists the patch (lazy-insert)", async () => {
      const returned = await persistence!.setUserPreferencePatch(userId, {
        dashboardPerformanceRanges: ["1M", "YTD"],
      });
      expect(returned).toEqual({ dashboardPerformanceRanges: ["1M", "YTD"] });

      const read = await persistence!.getUserPreferences(userId);
      expect(read).toEqual({ dashboardPerformanceRanges: ["1M", "YTD"] });
    });

    it("merges non-null keys into existing preferences (top-level `||`)", async () => {
      await persistence!.setUserPreferencePatch(userId, {
        dashboardPerformanceRanges: ["1M", "YTD"],
      });

      const merged = await persistence!.setUserPreferencePatch(userId, {
        theme: "dark",
      });
      expect(merged).toEqual({
        dashboardPerformanceRanges: ["1M", "YTD"],
        theme: "dark",
      });
    });

    it("replaces an existing key when the patch provides a new value (top-level replace, no deep merge)", async () => {
      await persistence!.setUserPreferencePatch(userId, {
        nested: { a: 1, b: 2 },
      });
      const replaced = await persistence!.setUserPreferencePatch(userId, {
        nested: { c: 3 },
      });
      // Top-level `||` replaces the whole object — NOT a deep merge.
      expect(replaced).toEqual({ nested: { c: 3 } });
    });

    it("persists dashboardHoldingFocus as a top-level full-object preference", async () => {
      const initial = {
        presetOrder: ["stale-quotes", "largest", "worst-pnl", "best-pnl", "fx-exposure"],
        hiddenPresets: ["worst-pnl"],
        selectedPreset: "stale-quotes",
      };
      const replacement = {
        presetOrder: ["largest", "best-pnl", "worst-pnl", "fx-exposure", "stale-quotes"],
        hiddenPresets: ["fx-exposure"],
        selectedPreset: "largest",
      };

      await persistence!.setUserPreferencePatch(userId, { dashboardHoldingFocus: initial });
      const replaced = await persistence!.setUserPreferencePatch(userId, {
        dashboardHoldingFocus: replacement,
      });
      expect(replaced.dashboardHoldingFocus).toEqual(replacement);

      const cleared = await persistence!.setUserPreferencePatch(userId, {
        dashboardHoldingFocus: null,
      });
      expect(cleared).not.toHaveProperty("dashboardHoldingFocus");
    });

    it("deletes a key when the patch value is null", async () => {
      await persistence!.setUserPreferencePatch(userId, {
        dashboardPerformanceRanges: ["1M", "YTD"],
        theme: "dark",
      });
      const afterDelete = await persistence!.setUserPreferencePatch(userId, {
        dashboardPerformanceRanges: null,
      });
      expect(afterDelete).toEqual({ theme: "dark" });
      expect(afterDelete).not.toHaveProperty("dashboardPerformanceRanges");
    });

    it("deletes multiple keys in a single call", async () => {
      await persistence!.setUserPreferencePatch(userId, {
        a: 1,
        b: 2,
        c: 3,
      });
      const afterDelete = await persistence!.setUserPreferencePatch(userId, {
        a: null,
        c: null,
      });
      expect(afterDelete).toEqual({ b: 2 });
    });

    it("handles mixed patch (some keys merged, others deleted) atomically in a single UPDATE", async () => {
      await persistence!.setUserPreferencePatch(userId, {
        keep: "original",
        replace: "old",
        drop: "goodbye",
      });
      const result = await persistence!.setUserPreferencePatch(userId, {
        replace: "new",
        drop: null,
        add: "hello",
      });
      expect(result).toEqual({
        keep: "original",
        replace: "new",
        add: "hello",
      });
    });

    it("is a no-op when all keys in the patch are null and no prior row exists (empty object persisted)", async () => {
      const returned = await persistence!.setUserPreferencePatch(userId, {
        missing: null,
      });
      expect(returned).toEqual({});

      const read = await persistence!.getUserPreferences(userId);
      expect(read).toEqual({});
    });

    it("isolates preferences per user (no cross-user bleed)", async () => {
      await persistence!.setUserPreferencePatch(userId, {
        dashboardPerformanceRanges: ["1M"],
      });
      await persistence!.setUserPreferencePatch(otherUserId, {
        dashboardPerformanceRanges: ["5Y"],
      });

      const first = await persistence!.getUserPreferences(userId);
      const second = await persistence!.getUserPreferences(otherUserId);
      expect(first).toEqual({ dashboardPerformanceRanges: ["1M"] });
      expect(second).toEqual({ dashboardPerformanceRanges: ["5Y"] });
    });
  });

  // KZO-162 — cardOrder sub-key clear semantics. A partial PATCH like
  // `{cardOrder:{transactions:[...]}}` must NOT wipe `cardOrder.dashboard`,
  // and `{cardOrder:{dashboard:null}}` must remove only that sub-key.
  describe("setUserPreferencePatch — cardOrder sub-key merge (KZO-162)", () => {
    it("merges a partial cardOrder patch without wiping other sub-keys", async () => {
      await persistence!.setUserPreferencePatch(userId, {
        cardOrder: {
          dashboard: ["holdings-table", "portfolio-trend"],
          portfolio: ["holdings-table", "dividends-section"],
        },
      });
      const merged = await persistence!.setUserPreferencePatch(userId, {
        cardOrder: { transactions: ["transactions-recent", "transactions-status"] },
      });
      expect(merged).toEqual({
        cardOrder: {
          dashboard: ["holdings-table", "portfolio-trend"],
          portfolio: ["holdings-table", "dividends-section"],
          transactions: ["transactions-recent", "transactions-status"],
        },
      });
    });

    it("clears a single cardOrder sub-key when its value is null (sibling sub-keys preserved)", async () => {
      await persistence!.setUserPreferencePatch(userId, {
        cardOrder: {
          dashboard: ["a", "b"],
          transactions: ["c", "d"],
          portfolio: ["e", "f"],
        },
      });
      const cleared = await persistence!.setUserPreferencePatch(userId, {
        cardOrder: { dashboard: null },
      });
      expect(cleared.cardOrder).toEqual({
        transactions: ["c", "d"],
        portfolio: ["e", "f"],
      });
      // The dashboard key must be ABSENT (not null) — round-trip regression
      // guard against null-storage drift.
      expect(cleared.cardOrder).not.toHaveProperty("dashboard");

      // GET sees the same shape.
      const read = await persistence!.getUserPreferences(userId);
      expect((read.cardOrder as Record<string, unknown>)).not.toHaveProperty("dashboard");
    });

    it("clears the entire cardOrder when the top-level value is null", async () => {
      await persistence!.setUserPreferencePatch(userId, {
        cardOrder: { dashboard: ["x"], transactions: ["y"] },
        dashboardPerformanceRanges: ["1M"],
      });
      const cleared = await persistence!.setUserPreferencePatch(userId, {
        cardOrder: null,
      });
      expect(cleared).not.toHaveProperty("cardOrder");
      expect(cleared.dashboardPerformanceRanges).toEqual(["1M"]);
    });

    it("supports mixed-op cardOrder patch (one sub-key set, another cleared)", async () => {
      await persistence!.setUserPreferencePatch(userId, {
        cardOrder: { dashboard: ["a"], transactions: ["b"] },
      });
      const result = await persistence!.setUserPreferencePatch(userId, {
        cardOrder: { dashboard: ["x", "y"], transactions: null },
      });
      expect(result.cardOrder).toEqual({ dashboard: ["x", "y"] });
    });
  });

  describe("_setUserPreferences — shallow merge (test-only seed helper)", () => {
    // KZO-177: switched from full-replace to shallow merge at top-level keys.
    // Reason: parallel E2E specs seeding `{ cardOrder: ... }` on the shared
    // default OAuth user were wiping `reportingCurrency`, causing flakes in
    // `dashboard-reporting-currency-aaa.spec.ts`. Merge semantics keep the
    // unmentioned keys intact while still letting tests overwrite specific
    // top-level fields.
    it("merges new top-level keys with existing preferences", async () => {
      await persistence!.setUserPreferencePatch(userId, { a: 1, b: 2 });
      await persistence!._setUserPreferences(userId, { only: "this" });

      const read = await persistence!.getUserPreferences(userId);
      expect(read).toEqual({ a: 1, b: 2, only: "this" });
    });

    it("overwrites a top-level key when seeded with the same key", async () => {
      await persistence!.setUserPreferencePatch(userId, { a: 1, b: 2 });
      await persistence!._setUserPreferences(userId, { a: 99 });

      const read = await persistence!.getUserPreferences(userId);
      expect(read).toEqual({ a: 99, b: 2 });
    });

    it("inserts when no row exists", async () => {
      await persistence!._setUserPreferences(userId, { seeded: true });
      const read = await persistence!.getUserPreferences(userId);
      expect(read).toEqual({ seeded: true });
    });
  });

  // ── ON DELETE CASCADE (migration 036 FK) ────────────────────────────────

  describe("user_preferences FK ON DELETE CASCADE", () => {
    it("removes the preferences row automatically when the parent user is deleted", async () => {
      // The focus of this test is the `user_preferences(user_id) REFERENCES
      // users(id) ON DELETE CASCADE` FK added in migration 036. Isolate it
      // from `resolveOrCreateUser`'s ancillary seeds (fee_profiles, accounts,
      // user_external_identities — FKs that don't cascade and would block a
      // raw `DELETE FROM users` regardless of the 036 FK under test) by
      // inserting a minimal user row directly via SQL and asserting the
      // cascade drops the preferences row once that user is deleted.
      const isolatedUserId = "kzo-159-cascade-isolated";
      await pool.query(
        `INSERT INTO public.users (id, email, display_name, role)
         VALUES ($1, 'kzo159-cascade@example.com', 'KZO-159 Cascade', 'viewer')`,
        [isolatedUserId],
      );
      await persistence!.setUserPreferencePatch(isolatedUserId, {
        dashboardPerformanceRanges: ["1M", "YTD"],
      });

      // Sanity — row exists before user deletion.
      const before = await pool.query(
        "SELECT 1 FROM public.user_preferences WHERE user_id = $1",
        [isolatedUserId],
      );
      expect(before.rowCount).toBe(1);

      await pool.query("DELETE FROM public.users WHERE id = $1", [isolatedUserId]);

      const after = await pool.query(
        "SELECT 1 FROM public.user_preferences WHERE user_id = $1",
        [isolatedUserId],
      );
      expect(after.rowCount).toBe(0);
    });
  });

  // ── App config (admin override column) ─────────────────────────────────

  describe("setDashboardPerformanceRanges / getAppConfig", () => {
    it("initial state — dashboardPerformanceRanges is null when unset", async () => {
      const config = await persistence!.getAppConfig();
      expect(config.dashboardPerformanceRanges).toBeNull();
    });

    it("persists and retrieves an admin override list", async () => {
      await persistence!.setDashboardPerformanceRanges(["1M", "6M", "YTD", "ALL"]);
      const config = await persistence!.getAppConfig();
      expect(config.dashboardPerformanceRanges).toEqual(["1M", "6M", "YTD", "ALL"]);
    });

    it("clears the admin override when set to null", async () => {
      await persistence!.setDashboardPerformanceRanges(["YTD"]);
      await persistence!.setDashboardPerformanceRanges(null);
      const config = await persistence!.getAppConfig();
      expect(config.dashboardPerformanceRanges).toBeNull();
    });

    it("bumps updated_at on each change", async () => {
      const first = await persistence!.getAppConfig();
      await new Promise((r) => setTimeout(r, 5));
      await persistence!.setDashboardPerformanceRanges(["1M"]);
      const second = await persistence!.getAppConfig();
      expect(Date.parse(second.updatedAt)).toBeGreaterThan(Date.parse(first.updatedAt));
    });
  });

  // ── resolveEffectiveRanges — 3-tier precedence ─────────────────────────

  describe("resolveEffectiveRanges — 3-tier precedence", () => {
    it("returns DEFAULT with source=default when neither user nor admin is set", async () => {
      const result = await resolveEffectiveRanges(persistence!, userId);
      expect(result.ranges).toEqual([...DEFAULT_DASHBOARD_PERFORMANCE_RANGES]);
      expect(result.source).toBe("default");
    });

    it("returns admin list with source=admin when only admin is set", async () => {
      await persistence!.setDashboardPerformanceRanges(["1M", "6M", "YTD"]);
      const result = await resolveEffectiveRanges(persistence!, userId);
      expect(result.ranges).toEqual(["1M", "6M", "YTD"]);
      expect(result.source).toBe("admin");
    });

    it("returns user list with source=user when only user pref is set (no admin)", async () => {
      await persistence!.setUserPreferencePatch(userId, {
        dashboardPerformanceRanges: ["3M", "1Y"],
      });
      const result = await resolveEffectiveRanges(persistence!, userId);
      expect(result.ranges).toEqual(["3M", "1Y"]);
      expect(result.source).toBe("user");
    });

    it("returns user list (pruned to admin-allowed) with source=user when both are set and they intersect", async () => {
      await persistence!.setDashboardPerformanceRanges(["1M", "6M", "YTD"]);
      await persistence!.setUserPreferencePatch(userId, {
        dashboardPerformanceRanges: ["1M", "YTD", "5Y"], // 5Y not in admin list → pruned
      });
      const result = await resolveEffectiveRanges(persistence!, userId);
      expect(result.ranges).toEqual(["1M", "YTD"]);
      expect(result.source).toBe("user");
    });

    it("falls back to admin list when user pref intersection with admin is empty", async () => {
      await persistence!.setDashboardPerformanceRanges(["1M", "6M"]);
      await persistence!.setUserPreferencePatch(userId, {
        dashboardPerformanceRanges: ["5Y", "10Y"], // no overlap with admin
      });
      const result = await resolveEffectiveRanges(persistence!, userId);
      expect(result.ranges).toEqual(["1M", "6M"]);
      expect(result.source).toBe("admin");
    });

    it("falls back to default when admin list is null and user stored pref is invalid", async () => {
      // Seed an invalid stored preference via the test-only helper.
      await persistence!._setUserPreferences(userId, {
        dashboardPerformanceRanges: ["not-a-range", 123],
      });
      const result = await resolveEffectiveRanges(persistence!, userId);
      expect(result.ranges).toEqual([...DEFAULT_DASHBOARD_PERFORMANCE_RANGES]);
      expect(result.source).toBe("default");
    });

    it("falls back to admin list when user stored pref is invalid but admin is set", async () => {
      await persistence!.setDashboardPerformanceRanges(["3M", "YTD"]);
      await persistence!._setUserPreferences(userId, {
        dashboardPerformanceRanges: ["bogus"],
      });
      const result = await resolveEffectiveRanges(persistence!, userId);
      expect(result.ranges).toEqual(["3M", "YTD"]);
      expect(result.source).toBe("admin");
    });

    it("returns user list untouched when no admin override exists", async () => {
      await persistence!.setUserPreferencePatch(userId, {
        dashboardPerformanceRanges: ["ALL", "5Y", "YTD"],
      });
      const result = await resolveEffectiveRanges(persistence!, userId);
      expect(result.ranges).toEqual(["ALL", "5Y", "YTD"]);
      expect(result.source).toBe("user");
    });

    it("preserves order of the user list (not sorted)", async () => {
      await persistence!.setUserPreferencePatch(userId, {
        dashboardPerformanceRanges: ["ALL", "1M", "YTD"],
      });
      const result = await resolveEffectiveRanges(persistence!, userId);
      expect(result.ranges).toEqual(["ALL", "1M", "YTD"]);
    });

    it("isolates resolution per user", async () => {
      await persistence!.setUserPreferencePatch(userId, {
        dashboardPerformanceRanges: ["1M"],
      });
      await persistence!.setUserPreferencePatch(otherUserId, {
        dashboardPerformanceRanges: ["10Y"],
      });
      const first = await resolveEffectiveRanges(persistence!, userId);
      const second = await resolveEffectiveRanges(persistence!, otherUserId);
      expect(first.ranges).toEqual(["1M"]);
      expect(second.ranges).toEqual(["10Y"]);
    });
  });
});

// ── Memory sibling — semantic parity suite (always runs) ──────────────────────

describe("user_preferences + effective-ranges (Memory parity)", () => {
  let persistence: InstanceType<typeof MemoryPersistence>;
  let userId: string;
  let otherUserId: string;

  beforeEach(async () => {
    persistence = new MemoryPersistence();
    await persistence.init();

    const primary = await persistence.resolveOrCreateUser("google", "mem-primary-sub", {
      email: "mem-primary@example.com",
      name: "Mem Primary",
    });
    userId = primary.userId;

    const secondary = await persistence.resolveOrCreateUser("google", "mem-secondary-sub", {
      email: "mem-secondary@example.com",
      name: "Mem Secondary",
    });
    otherUserId = secondary.userId;
  });

  afterEach(async () => {
    await persistence.close();
  });

  it("M1 — getUserPreferences returns empty object when no row exists (lazy read)", async () => {
    const prefs = await persistence.getUserPreferences(userId);
    expect(prefs).toEqual({});
  });

  it("M2 — setUserPreferencePatch creates + merges + null-deletes (top-level replace)", async () => {
    await persistence.setUserPreferencePatch(userId, {
      dashboardPerformanceRanges: ["1M", "YTD"],
    });
    const merged = await persistence.setUserPreferencePatch(userId, {
      theme: "dark",
    });
    expect(merged).toEqual({
      dashboardPerformanceRanges: ["1M", "YTD"],
      theme: "dark",
    });

    // Top-level replace for nested objects (no deep merge) — matches Postgres.
    await persistence.setUserPreferencePatch(userId, { nested: { a: 1, b: 2 } });
    const afterReplace = await persistence.setUserPreferencePatch(userId, {
      nested: { c: 3 },
    });
    expect(afterReplace.nested).toEqual({ c: 3 });

    // Null-delete semantics.
    const afterDelete = await persistence.setUserPreferencePatch(userId, {
      dashboardPerformanceRanges: null,
    });
    expect(afterDelete).not.toHaveProperty("dashboardPerformanceRanges");
  });

  it("M3 — per-user isolation", async () => {
    await persistence.setUserPreferencePatch(userId, {
      dashboardPerformanceRanges: ["1M"],
    });
    await persistence.setUserPreferencePatch(otherUserId, {
      dashboardPerformanceRanges: ["5Y"],
    });
    expect(await persistence.getUserPreferences(userId)).toEqual({
      dashboardPerformanceRanges: ["1M"],
    });
    expect(await persistence.getUserPreferences(otherUserId)).toEqual({
      dashboardPerformanceRanges: ["5Y"],
    });
  });

  it("M4 — _setUserPreferences shallow-merges with prior patch-merged state (KZO-177)", async () => {
    await persistence.setUserPreferencePatch(userId, { a: 1, b: 2 });
    await persistence._setUserPreferences(userId, { only: "this" });
    expect(await persistence.getUserPreferences(userId)).toEqual({ a: 1, b: 2, only: "this" });
  });

  it("M5 — resolveEffectiveRanges default tier (no user, no admin)", async () => {
    const result = await resolveEffectiveRanges(persistence, userId);
    expect(result.source).toBe("default");
    expect(result.ranges).toEqual([...DEFAULT_DASHBOARD_PERFORMANCE_RANGES]);
  });

  it("M6 — resolveEffectiveRanges admin tier (no user, admin set)", async () => {
    await persistence.setDashboardPerformanceRanges(["1M", "6M", "YTD"]);
    const result = await resolveEffectiveRanges(persistence, userId);
    expect(result.source).toBe("admin");
    expect(result.ranges).toEqual(["1M", "6M", "YTD"]);
  });

  it("M7 — resolveEffectiveRanges user tier with admin-prune (intersection preserves order)", async () => {
    await persistence.setDashboardPerformanceRanges(["1M", "6M", "YTD"]);
    await persistence.setUserPreferencePatch(userId, {
      dashboardPerformanceRanges: ["YTD", "1M", "5Y"], // 5Y pruned; order preserved
    });
    const result = await resolveEffectiveRanges(persistence, userId);
    expect(result.source).toBe("user");
    expect(result.ranges).toEqual(["YTD", "1M"]);
  });

  it("M8 — resolveEffectiveRanges falls back when user pref is invalid and admin is unset", async () => {
    await persistence._setUserPreferences(userId, {
      dashboardPerformanceRanges: ["not-a-range"],
    });
    const result = await resolveEffectiveRanges(persistence, userId);
    expect(result.source).toBe("default");
    expect(result.ranges).toEqual([...DEFAULT_DASHBOARD_PERFORMANCE_RANGES]);
  });

  // KZO-162 — cardOrder sub-key merge parity with Postgres.
  it("M9 — cardOrder patch merges partial sub-keys without wiping siblings", async () => {
    await persistence.setUserPreferencePatch(userId, {
      cardOrder: { dashboard: ["a"], portfolio: ["b"] },
    });
    const merged = await persistence.setUserPreferencePatch(userId, {
      cardOrder: { transactions: ["c"] },
    });
    expect(merged.cardOrder).toEqual({
      dashboard: ["a"],
      portfolio: ["b"],
      transactions: ["c"],
    });
  });

  it("M10 — cardOrder sub-key null clears just that sub-key (siblings preserved, key absent)", async () => {
    await persistence.setUserPreferencePatch(userId, {
      cardOrder: { dashboard: ["a"], transactions: ["b"], portfolio: ["c"] },
    });
    const cleared = await persistence.setUserPreferencePatch(userId, {
      cardOrder: { dashboard: null },
    });
    expect(cleared.cardOrder).toEqual({ transactions: ["b"], portfolio: ["c"] });
    expect(cleared.cardOrder).not.toHaveProperty("dashboard");

    const read = await persistence.getUserPreferences(userId);
    expect((read.cardOrder as Record<string, unknown>)).not.toHaveProperty("dashboard");
  });

  it("M11 — top-level cardOrder null clears the entire key", async () => {
    await persistence.setUserPreferencePatch(userId, {
      cardOrder: { dashboard: ["a"], transactions: ["b"] },
      dashboardPerformanceRanges: ["1M"],
    });
    const cleared = await persistence.setUserPreferencePatch(userId, { cardOrder: null });
    expect(cleared).not.toHaveProperty("cardOrder");
    expect(cleared.dashboardPerformanceRanges).toEqual(["1M"]);
  });

  it("M12 — mixed cardOrder patch (set one sub-key, null another)", async () => {
    await persistence.setUserPreferencePatch(userId, {
      cardOrder: { dashboard: ["a"], transactions: ["b"] },
    });
    const result = await persistence.setUserPreferencePatch(userId, {
      cardOrder: { dashboard: ["x", "y"], transactions: null },
    });
    expect(result.cardOrder).toEqual({ dashboard: ["x", "y"] });
  });

  it("M13 — dashboardHoldingFocus persists as top-level full-object preference", async () => {
    const initial = {
      presetOrder: ["stale-quotes", "largest", "worst-pnl", "best-pnl", "fx-exposure"],
      hiddenPresets: ["worst-pnl"],
      selectedPreset: "stale-quotes",
    };
    const replacement = {
      presetOrder: ["largest", "best-pnl", "worst-pnl", "fx-exposure", "stale-quotes"],
      hiddenPresets: ["fx-exposure"],
      selectedPreset: "largest",
    };

    await persistence.setUserPreferencePatch(userId, { dashboardHoldingFocus: initial });
    const replaced = await persistence.setUserPreferencePatch(userId, {
      dashboardHoldingFocus: replacement,
    });
    expect(replaced.dashboardHoldingFocus).toEqual(replacement);

    const cleared = await persistence.setUserPreferencePatch(userId, {
      dashboardHoldingFocus: null,
    });
    expect(cleared).not.toHaveProperty("dashboardHoldingFocus");
  });
});
