import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LocaleCode } from "@tw-portfolio/shared-types";
import { shareNotificationStrings } from "../../src/persistence/shareNotificationStrings.js";

// ── Postgres integration guard ────────────────────────────────────────────────

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

// ── Helpers ───────────────────────────────────────────────────────────────────

const { PostgresPersistence } = await import("../../src/persistence/postgres.js");

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

function expectedBody(template: string, ownerLabel: string): string {
  return template.replace("{ownerLabel}", ownerLabel);
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describePostgres("sharing notification locale (postgres integration)", () => {
  let persistence: InstanceType<typeof PostgresPersistence>;
  let pool: Pool;
  let ownerUserId: string;

  beforeEach(async () => {
    await resetDatabase();
    persistence = new PostgresPersistence({ databaseUrl: databaseUrl!, redisUrl: redisUrl! });
    await persistence.init();
    pool = new Pool({ connectionString: databaseUrl });

    const owner = await persistence.resolveOrCreateUser("google", "notif-locale-owner-sub", {
      email: "notif-locale-owner@example.com",
      name: "Locale Owner",
    });
    ownerUserId = owner.userId;
  });

  afterEach(async () => {
    await persistence.close();
    await pool.end();
  });

  async function setUserLocale(userId: string, locale: LocaleCode): Promise<void> {
    await pool.query("UPDATE users SET locale = $1 WHERE id = $2", [locale, userId]);
  }

  async function seedGrantee(sub: string, email: string, name: string): Promise<string> {
    const result = await persistence.resolveOrCreateUser("google", sub, { email, name });
    return result.userId;
  }

  // ── createShareGrant ───────────────────────────────────────────────────────

  it("createShareGrant — zh-TW grantee receives zh-TW title and body with detail.kind === share_granted", async () => {
    const strings = shareNotificationStrings["zh-TW"];
    const ownerLabel = "Locale Owner"; // matches resolveOrCreateUser name above

    const granteeId = await seedGrantee(
      "notif-locale-grantee-sub",
      "grantee-zhTW@example.com",
      "ZH Grantee",
    );
    await setUserLocale(granteeId, "zh-TW");

    await persistence.createShareGrant({
      ownerUserId,
      granteeUserId: granteeId,
      auditInput: { actorUserId: ownerUserId },
    });

    const { notifications } = await persistence.getNotificationsForUser(granteeId, {
      page: 1,
      limit: 10,
    });
    expect(notifications).toHaveLength(1);

    const notif = notifications[0]!;
    expect(notif.title).toBe(strings.shareGranted.title);
    expect(notif.body).toBe(expectedBody(strings.shareGranted.body, ownerLabel));
    expect((notif.detail as { kind: string }).kind).toBe("share_granted");
    expect((notif.detail as { ownerUserId: string }).ownerUserId).toBe(ownerUserId);
  });

  it("createShareGrant — en grantee (control) receives en title with detail.kind === share_granted", async () => {
    const strings = shareNotificationStrings.en;
    const ownerLabel = "Locale Owner";

    const granteeId = await seedGrantee(
      "notif-locale-en-grantee-sub",
      "grantee-en@example.com",
      "EN Grantee",
    );
    // locale defaults to 'en' — no update needed

    await persistence.createShareGrant({
      ownerUserId,
      granteeUserId: granteeId,
      auditInput: { actorUserId: ownerUserId },
    });

    const { notifications } = await persistence.getNotificationsForUser(granteeId, {
      page: 1,
      limit: 10,
    });
    expect(notifications).toHaveLength(1);

    const notif = notifications[0]!;
    expect(notif.title).toBe(strings.shareGranted.title);
    expect(notif.body).toBe(expectedBody(strings.shareGranted.body, ownerLabel));
    expect((notif.detail as { kind: string }).kind).toBe("share_granted");
  });

  // ── revokeShareGrant ───────────────────────────────────────────────────────

  it("revokeShareGrant — zh-TW grantee receives zh-TW title with detail.kind === share_revoked", async () => {
    const strings = shareNotificationStrings["zh-TW"];
    const ownerLabel = "Locale Owner";

    const granteeId = await seedGrantee(
      "notif-locale-revoke-sub",
      "grantee-revoke@example.com",
      "Revoke Grantee",
    );
    await setUserLocale(granteeId, "zh-TW");

    const share = await persistence.createShareGrant({
      ownerUserId,
      granteeUserId: granteeId,
      auditInput: { actorUserId: ownerUserId },
    });

    await persistence.revokeShareGrant(share.id, ownerUserId, { actorUserId: ownerUserId });

    const { notifications } = await persistence.getNotificationsForUser(granteeId, {
      page: 1,
      limit: 10,
    });
    // grant notification + revoke notification (newest first)
    expect(notifications.length).toBeGreaterThanOrEqual(2);

    const revokeNotif = notifications.find(
      (n) => (n.detail as { kind?: string }).kind === "share_revoked",
    );
    expect(revokeNotif).toBeDefined();
    expect(revokeNotif!.title).toBe(strings.shareRevoked.title);
    expect(revokeNotif!.body).toBe(expectedBody(strings.shareRevoked.body, ownerLabel));
    expect((revokeNotif!.detail as { kind: string }).kind).toBe("share_revoked");
  });

  // ── invite-materialize flow ────────────────────────────────────────────────

  it("materializePendingSharesForEmail — zh-TW grantee receives zh-TW grant notification via invite path", async () => {
    const strings = shareNotificationStrings["zh-TW"];
    const ownerLabel = "Locale Owner";
    const granteeEmail = "grantee-invite@example.com";

    const granteeId = await seedGrantee(
      "notif-locale-invite-sub",
      granteeEmail,
      "Invite Grantee",
    );
    await setUserLocale(granteeId, "zh-TW");

    // Owner creates a share-coupled invite addressed to the grantee's email
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await persistence.createShareCoupledInvite({
      ownerUserId,
      email: granteeEmail,
      expiresAt,
      issuedByUserId: ownerUserId,
    });

    // Grantee accepts: materialize turns the invite into a share grant + notification
    const materialized = await persistence.materializePendingSharesForEmail({
      userId: granteeId,
      email: granteeEmail,
      auditInput: { actorUserId: granteeId },
    });
    expect(materialized).toHaveLength(1);

    const { notifications } = await persistence.getNotificationsForUser(granteeId, {
      page: 1,
      limit: 10,
    });

    const grantNotif = notifications.find(
      (n) => (n.detail as { kind?: string }).kind === "share_granted",
    );
    expect(grantNotif).toBeDefined();
    expect(grantNotif!.title).toBe(strings.shareGranted.title);
    expect(grantNotif!.body).toBe(expectedBody(strings.shareGranted.body, ownerLabel));
    expect((grantNotif!.detail as { kind: string }).kind).toBe("share_granted");
  });
});
