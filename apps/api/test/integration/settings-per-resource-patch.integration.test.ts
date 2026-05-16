import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PostgresPersistence } from "../../src/persistence/postgres.js";

// ui-reshape Phase 3d S7 — Postgres integration test for the extended
// PATCH /profile semantics. Per `.claude/rules/integration-test-persistence-direct.md`,
// this spec uses `PostgresPersistence` directly (no `buildApp`) so the test
// stack can run under the managed `test:integration:full:host` profile that
// only provisions Postgres (no Redis-backed pg-boss).
//
// Storage contract (LOCKED — architect-design §7.1):
//   user_preferences.preferences.userProfile.{displayName, pictureUrl}
//
// Resolver contract:
//   - getProfile returns `userDisplayName` / `userPictureUrl` as the JSONB
//     override value (or null when unset).
//   - Provider-synced `displayName` and `providerPictureUrl` are unchanged
//     by these writes.

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

async function resetDatabase(): Promise<void> {
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
}

describePostgres("PATCH /profile per-resource overrides (postgres integration)", () => {
  let persistence: PostgresPersistence;
  let pool: Pool;
  let userId: string;

  beforeEach(async () => {
    await resetDatabase();
    persistence = new PostgresPersistence({ databaseUrl: databaseUrl!, redisUrl: redisUrl! });
    await persistence.init();
    pool = new Pool({ connectionString: databaseUrl });

    const user = await persistence.resolveOrCreateUser("google", "profile-patch-test-sub", {
      email: "profile-patch@example.com",
      name: "Provider Display Name",
      picture: "https://lh3.googleusercontent.com/a/provider-avatar",
    });
    userId = user.userId;
  });

  afterEach(async () => {
    await persistence.close();
    await pool.end();
  });

  it("returns null for both override fields when nothing has been written", async () => {
    const profile = await persistence.getProfile(userId);
    expect(profile.userDisplayName).toBeNull();
    expect(profile.userPictureUrl).toBeNull();
    // Provider fields stay populated from resolveOrCreateUser.
    expect(profile.providerDisplayName).toBe("Provider Display Name");
    expect(profile.providerPictureUrl).toBe(
      "https://lh3.googleusercontent.com/a/provider-avatar",
    );
  });

  it("persists displayName override into user_preferences.preferences.userProfile.displayName", async () => {
    const updated = await persistence.updateProfileFields(userId, {
      displayName: "User Chosen Name",
    });
    expect(updated.userDisplayName).toBe("User Chosen Name");
    // pictureUrl is independent and remains unset.
    expect(updated.userPictureUrl).toBeNull();

    // Verify the JSONB write by querying directly.
    const row = await pool.query<{ preferences: { userProfile?: { displayName?: string } } }>(
      "SELECT preferences FROM public.user_preferences WHERE user_id = $1",
      [userId],
    );
    expect(row.rows[0]?.preferences.userProfile?.displayName).toBe("User Chosen Name");
  });

  it("persists pictureUrl override into the same JSONB sub-object", async () => {
    const updated = await persistence.updateProfileFields(userId, {
      pictureUrl: "https://cdn.example.com/avatars/me.jpg",
    });
    expect(updated.userPictureUrl).toBe("https://cdn.example.com/avatars/me.jpg");
    expect(updated.userDisplayName).toBeNull();

    const row = await pool.query<{ preferences: { userProfile?: { pictureUrl?: string } } }>(
      "SELECT preferences FROM public.user_preferences WHERE user_id = $1",
      [userId],
    );
    expect(row.rows[0]?.preferences.userProfile?.pictureUrl).toBe(
      "https://cdn.example.com/avatars/me.jpg",
    );
  });

  it("treats null as clear — removes the displayName key without touching pictureUrl", async () => {
    await persistence.updateProfileFields(userId, {
      displayName: "User Chosen Name",
      pictureUrl: "https://cdn.example.com/p1.jpg",
    });
    const cleared = await persistence.updateProfileFields(userId, { displayName: null });
    expect(cleared.userDisplayName).toBeNull();
    // pictureUrl preserved.
    expect(cleared.userPictureUrl).toBe("https://cdn.example.com/p1.jpg");

    const row = await pool.query<{
      preferences: { userProfile?: { displayName?: string; pictureUrl?: string } };
    }>(
      "SELECT preferences FROM public.user_preferences WHERE user_id = $1",
      [userId],
    );
    expect(row.rows[0]?.preferences.userProfile?.displayName).toBeUndefined();
    expect(row.rows[0]?.preferences.userProfile?.pictureUrl).toBe(
      "https://cdn.example.com/p1.jpg",
    );
  });

  it("clears the userProfile sub-object entirely when both keys are nulled", async () => {
    await persistence.updateProfileFields(userId, {
      displayName: "User Chosen Name",
      pictureUrl: "https://cdn.example.com/p1.jpg",
    });
    const cleared = await persistence.updateProfileFields(userId, {
      displayName: null,
      pictureUrl: null,
    });
    expect(cleared.userDisplayName).toBeNull();
    expect(cleared.userPictureUrl).toBeNull();

    const row = await pool.query<{ preferences: Record<string, unknown> }>(
      "SELECT preferences FROM public.user_preferences WHERE user_id = $1",
      [userId],
    );
    // userProfile key removed entirely.
    expect(row.rows[0]?.preferences).not.toHaveProperty("userProfile");
  });

  it("preserves unrelated JSONB keys (e.g. cardOrder, themeAccent) when writing userProfile", async () => {
    // Seed an unrelated preference first.
    await persistence.setUserPreferencePatch(userId, {
      themeAccent: "emerald",
      cardOrder: { dashboard: ["holdings", "performance"] },
    });
    // Now write a profile override.
    await persistence.updateProfileFields(userId, {
      displayName: "User Chosen Name",
    });

    const row = await pool.query<{ preferences: Record<string, unknown> }>(
      "SELECT preferences FROM public.user_preferences WHERE user_id = $1",
      [userId],
    );
    const prefs = row.rows[0]?.preferences ?? {};
    expect(prefs.themeAccent).toBe("emerald");
    expect(prefs.cardOrder).toEqual({ dashboard: ["holdings", "performance"] });
    expect(prefs).toHaveProperty("userProfile");
  });

  it("round-trips overrides through getProfile after multiple sequential PATCHes", async () => {
    await persistence.updateProfileFields(userId, { displayName: "Round Trip 1" });
    await persistence.updateProfileFields(userId, {
      pictureUrl: "https://cdn.example.com/rt.jpg",
    });
    await persistence.updateProfileFields(userId, { displayName: "Round Trip 2" });
    const final = await persistence.getProfile(userId);
    expect(final.userDisplayName).toBe("Round Trip 2");
    expect(final.userPictureUrl).toBe("https://cdn.example.com/rt.jpg");
  });

  it("throws 404 when updating fields for a non-existent user", async () => {
    await expect(
      persistence.updateProfileFields(
        "00000000-0000-0000-0000-000000000000",
        { displayName: "Ghost" },
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("does not overwrite provider-synced fields when writing user overrides", async () => {
    await persistence.updateProfileFields(userId, {
      displayName: "User Override",
      pictureUrl: "https://cdn.example.com/u.jpg",
    });
    const profile = await persistence.getProfile(userId);
    // user overrides set
    expect(profile.userDisplayName).toBe("User Override");
    expect(profile.userPictureUrl).toBe("https://cdn.example.com/u.jpg");
    // provider fields unchanged
    expect(profile.providerDisplayName).toBe("Provider Display Name");
    expect(profile.providerPictureUrl).toBe(
      "https://lh3.googleusercontent.com/a/provider-avatar",
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Sibling memory-backed describe — exercises the same contract on
// MemoryPersistence so unit-test coverage stays symmetric. Per
// `.claude/rules/test-placement-persistence-backend.md`, we don't put
// FK/uniqueness assertions here; only the JSONB round-trip + clear semantics.
// ─────────────────────────────────────────────────────────────────────────

describe("PATCH /profile per-resource overrides (memory persistence)", () => {
  it("round-trips displayName + pictureUrl through MemoryPersistence", async () => {
    const { MemoryPersistence } = await import("../../src/persistence/memory.js");
    const persistence = new MemoryPersistence({});
    await persistence.init();
    try {
      const user = await persistence.resolveOrCreateUser("google", "mem-profile-sub", {
        email: "mem-profile@example.com",
        name: "Mem Provider Name",
        picture: "https://provider.example.com/avatar",
      });
      const u = user.userId;

      // Initially null overrides
      const initial = await persistence.getProfile(u);
      expect(initial.userDisplayName).toBeNull();
      expect(initial.userPictureUrl).toBeNull();

      // Set both
      const after = await persistence.updateProfileFields(u, {
        displayName: "Mem User",
        pictureUrl: "https://cdn.example.com/mem.jpg",
      });
      expect(after.userDisplayName).toBe("Mem User");
      expect(after.userPictureUrl).toBe("https://cdn.example.com/mem.jpg");

      // Clear displayName only
      const cleared = await persistence.updateProfileFields(u, { displayName: null });
      expect(cleared.userDisplayName).toBeNull();
      expect(cleared.userPictureUrl).toBe("https://cdn.example.com/mem.jpg");

      // Clear pictureUrl via empty-trimmed semantics is handled at route layer,
      // not persistence; here we only verify explicit null.
      const allCleared = await persistence.updateProfileFields(u, { pictureUrl: null });
      expect(allCleared.userDisplayName).toBeNull();
      expect(allCleared.userPictureUrl).toBeNull();
    } finally {
      await persistence.close();
    }
  });
});
