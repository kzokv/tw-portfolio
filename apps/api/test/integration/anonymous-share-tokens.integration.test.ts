import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PostgresPersistence } from "../../src/persistence/postgres.js";

const databaseUrl = process.env.POSTGRES_TEST_DB_URL ?? process.env.DB_URL;
const redisUrl = process.env.POSTGRES_TEST_REDIS_URL ?? process.env.REDIS_URL;
const runPostgresIntegration = process.env.RUN_POSTGRES_INTEGRATION === "1";
const managedCiStack = process.env.TWP_MANAGED_CI_STACK === "1";

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

function makeToken(seed: string): string {
  return seed.replace(/[^A-Za-z0-9]/g, "").slice(0, 22).padEnd(22, "A");
}

describePostgres("anonymous share tokens (postgres integration)", () => {
  let persistence: PostgresPersistence;
  let pool: Pool;
  let ownerUserId: string;

  beforeEach(async () => {
    await resetDatabase();
    persistence = new PostgresPersistence({ databaseUrl: databaseUrl!, redisUrl: redisUrl! });
    await persistence.init();
    pool = new Pool({ connectionString: databaseUrl });

    const owner = await persistence.resolveOrCreateUser("google", "anon-share-owner-sub", {
      email: "anon-share-owner@example.com",
      name: "Anon Share Owner",
    });
    ownerUserId = owner.userId;
  });

  afterEach(async () => {
    await persistence.close();
    await pool.end();
  });

  it("allows exactly one winner when two create calls race at 19 active tokens", async () => {
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    for (let index = 0; index < 19; index += 1) {
      const result = await persistence.createAnonymousShareToken({
        ownerUserId,
        token: makeToken(`preseed-${index}-${randomUUID()}`),
        expiresAt,
        ttlDays: 30,
        auditInput: { actorUserId: ownerUserId, ipAddress: "127.0.0.1" },
      });
      expect(result.status).toBe("ok");
    }

    const [first, second] = await Promise.all([
      persistence.createAnonymousShareToken({
        ownerUserId,
        token: makeToken(`race-a-${randomUUID()}`),
        expiresAt,
        ttlDays: 30,
        auditInput: { actorUserId: ownerUserId, ipAddress: "127.0.0.1" },
      }),
      persistence.createAnonymousShareToken({
        ownerUserId,
        token: makeToken(`race-b-${randomUUID()}`),
        expiresAt,
        ttlDays: 30,
        auditInput: { actorUserId: ownerUserId, ipAddress: "127.0.0.1" },
      }),
    ]);

    expect([first.status, second.status].sort()).toEqual(["cap_exceeded", "ok"]);
    expect(await persistence.countActiveAnonymousShareTokensForOwner(ownerUserId)).toBe(20);
  });

  it("cascades anonymous_share_tokens rows when the owner user is deleted", async () => {
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    for (let index = 0; index < 2; index += 1) {
      const result = await persistence.createAnonymousShareToken({
        ownerUserId,
        token: makeToken(`cascade-${index}-${randomUUID()}`),
        expiresAt,
        ttlDays: 30,
        auditInput: { actorUserId: ownerUserId, ipAddress: "127.0.0.1" },
      });
      expect(result.status).toBe("ok");
    }

    // resolveOrCreateUser seeds: user_external_identities, fee_profiles, accounts.
    // None of those have ON DELETE CASCADE on users; remove them first so Postgres
    // allows the DELETE. anonymous_share_tokens does use ON DELETE CASCADE.
    await pool.query(`DELETE FROM accounts WHERE user_id = $1`, [ownerUserId]);
    await pool.query(`DELETE FROM fee_profiles WHERE user_id = $1`, [ownerUserId]);
    await pool.query(`DELETE FROM user_external_identities WHERE user_id = $1`, [ownerUserId]);
    await pool.query(`DELETE FROM users WHERE id = $1`, [ownerUserId]);

    const remaining = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM anonymous_share_tokens
       WHERE owner_user_id = $1`,
      [ownerUserId],
    );

    expect(Number(remaining.rows[0]?.count ?? "0")).toBe(0);
  });
});
