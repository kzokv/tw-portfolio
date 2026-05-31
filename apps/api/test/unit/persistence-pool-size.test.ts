// KZO-199 — Unit tests verifying PostgresPersistence and pgBoss read pool-size
// env vars instead of hardcoded literals.
//
// These tests do NOT spin up a real Postgres connection. They verify that the
// source code references the correct Env symbols by mocking @vakwen/config
// and asserting the pool constructor call receives the mocked value.
//
// `apps/api/src/persistence/postgres.ts` line ~318: `max: 20` → `max: Env.POSTGRES_POOL_MAX`
// `apps/api/src/plugins/pgBoss.ts` line ~44: `max: 2` → `max: Env.BACKFILL_POSTGRES_POOL_MAX`

const mockPoolCalls: Array<{ max?: number; connectionString?: string }> = [];
const mockPgBossPoolCalls: Array<{ max?: number; connectionString?: string }> = [];

vi.mock("pg", async (importOriginal) => {
  const original = await importOriginal<typeof import("pg")>();
  class MockPool {
    constructor(opts: { max?: number; connectionString?: string }) {
      mockPoolCalls.push(opts);
    }
    connect() { return Promise.resolve({ query: () => Promise.resolve({ rows: [] }), release: () => {} }); }
    query() { return Promise.resolve({ rows: [] }); }
    end() { return Promise.resolve(); }
    on() { return this; }
  }
  // pg is a CJS module — both `import { Pool } from "pg"` (named) AND
  // `import pg from "pg"` then `pg.Pool` (default + property) need to
  // resolve to MockPool.
  const exports = { ...original, Pool: MockPool };
  return { ...exports, default: exports };
});

vi.mock("pg-boss", async () => {
  class MockPgBoss {
    constructor(_opts: unknown) {}
    start() { return Promise.resolve(); }
    stop() { return Promise.resolve(); }
    on() { return this; }
    work() { return Promise.resolve(); }
    send() { return Promise.resolve(); }
    schedule() { return Promise.resolve(); }
  }
  // Source uses both `import { PgBoss } from "pg-boss"` (named) AND default
  // imports in different places. Export both shapes.
  return { PgBoss: MockPgBoss, default: MockPgBoss };
});

// Spy on the pg package imported by pgBoss — pgBoss constructs its own pool.
// We intercept at the `pg.Pool` layer already mocked above.
// The pgBoss plugin does: `new pg.Pool({ connectionString, max: 2, ... })`.
// After the fix it should be: `new pg.Pool({ connectionString, max: Env.BACKFILL_POSTGRES_POOL_MAX, ... })`.

import { beforeEach, describe, expect, it, vi } from "vitest";

const CUSTOM_POOL_MAX = 7;
const CUSTOM_BACKFILL_POOL_MAX = 3;

vi.mock("@vakwen/config", async (importOriginal) => {
  const original = await importOriginal<typeof import("@vakwen/config")>();
  return {
    ...original,
    Env: {
      ...original.Env,
      POSTGRES_POOL_MAX: CUSTOM_POOL_MAX,
      BACKFILL_POSTGRES_POOL_MAX: CUSTOM_BACKFILL_POOL_MAX,
      getDatabaseUrl: () => "postgresql://localhost:5432/test",
      getRedisUrl: () => "redis://localhost:6379",
    },
  };
});

describe("PostgresPersistence pool size reads Env.POSTGRES_POOL_MAX", () => {
  beforeEach(() => {
    mockPoolCalls.length = 0;
  });

  it("passes Env.POSTGRES_POOL_MAX to pg.Pool constructor", async () => {
    // Import after mock is active so the module sees the mocked Env.
    const { PostgresPersistence } = await import(
      "../../src/persistence/postgres.js"
    );
    new PostgresPersistence({
      databaseUrl: "postgresql://localhost:5432/test",
      redisUrl: "redis://localhost:6379",
    });

    // Should have constructed at least one Pool with our custom max.
    const mainPool = mockPoolCalls.find((c) => c.max === CUSTOM_POOL_MAX);
    expect(mainPool).toBeDefined();
    expect(mainPool?.max).toBe(CUSTOM_POOL_MAX);
  }, 15_000);
});

describe("pgBoss plugin pool size reads Env.BACKFILL_POSTGRES_POOL_MAX", () => {
  beforeEach(() => {
    mockPoolCalls.length = 0;
    mockPgBossPoolCalls.length = 0;
  });

  it("Env.BACKFILL_POSTGRES_POOL_MAX is a positive integer", async () => {
    const { Env } = await import("@vakwen/config");
    expect(typeof Env.BACKFILL_POSTGRES_POOL_MAX).toBe("number");
    expect(Number.isInteger(Env.BACKFILL_POSTGRES_POOL_MAX)).toBe(true);
    expect(Env.BACKFILL_POSTGRES_POOL_MAX).toBeGreaterThan(0);
  });

  it("registerPgBoss passes Env.BACKFILL_POSTGRES_POOL_MAX to the backfill pool", async () => {
    const { registerPgBoss } = await import("../../src/plugins/pgBoss.js");
    // registerPgBoss is the Fastify plugin. We call it with a minimal mock app.
    const pluginCalled = { done: false };
    const fakeApp = {
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      decorate: vi.fn(),
      addHook: vi.fn(),
    } as unknown as Parameters<typeof registerPgBoss>[0];

    // Fire and forget — we only care about the pool constructor calls,
    // not the full startup. boss.start() is mocked to resolve immediately.
    let lastErr: unknown = null;
    try {
      // Pass "postgres" override so the plugin doesn't short-circuit on
      // PERSISTENCE_BACKEND=memory. Failures further in are acceptable —
      // by that point the backfill pool has already been constructed.
      await registerPgBoss(fakeApp, "postgres");
      pluginCalled.done = true;
    } catch (err) {
      lastErr = err;
    }
    // `lastErr` is expected — fakeApp lacks `marketDataRegistry` etc., so
    // registerPgBoss throws once it tries to construct backfillDeps. By that
    // point the backfill pool has already been constructed (the assertion
    // below is the load-bearing check).
    void lastErr;

    // The backfill pool constructed inside registerPgBoss must use our CUSTOM_BACKFILL_POOL_MAX.
    const backfillPool = mockPoolCalls.find((c) => c.max === CUSTOM_BACKFILL_POOL_MAX);
    expect(backfillPool).toBeDefined();
    expect(backfillPool?.max).toBe(CUSTOM_BACKFILL_POOL_MAX);
  });
});
