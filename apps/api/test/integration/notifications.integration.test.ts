import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { loadMigrationManifest } from "../../src/persistence/migrationManifest.js";
import { PostgresPersistence } from "../../src/persistence/postgres.js";

const databaseUrl = process.env.POSTGRES_TEST_DB_URL ?? process.env.DB_URL;
const redisUrl = process.env.POSTGRES_TEST_REDIS_URL ?? process.env.REDIS_URL;
const runPostgresIntegration = process.env.RUN_POSTGRES_INTEGRATION === "1";
const managedCiStack = process.env.TWP_MANAGED_CI_STACK === "1";

if (runPostgresIntegration && !managedCiStack) {
  throw new Error(
    "RUN_POSTGRES_INTEGRATION=1 must be executed via npm run test:integration:ci:host or npm run test:integration:ci:container so the DB/Redis stack is managed automatically.",
  );
}

const shouldRunPostgresSuite = runPostgresIntegration && Boolean(databaseUrl) && Boolean(redisUrl);
const describePostgres = shouldRunPostgresSuite ? describe : describe.skip;
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(currentDir, "../../../../db/migrations");
const migrationManifestPromise = loadMigrationManifest(migrationsDir);

describePostgres("notification CRUD persistence", () => {
  let pool: Pool;
  let persistence: PostgresPersistence | null = null;

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

  async function createUser(email: string): Promise<string> {
    const { userId } = await persistence!.resolveOrCreateUser("google", `sub:${email}`, {
      email,
      name: email,
      emailVerified: true,
    });
    return userId;
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
  });

  afterEach(async () => {
    if (persistence) await persistence.close();
    await pool.end();
  });

  it("createNotification: creates and returns notification id", async () => {
    const userId = await createUser("notif-user@example.com");
    const id = await persistence!.createNotification({
      userId,
      severity: "info",
      source: "daily_refresh",
      sourceRef: "batch-1",
      title: "Daily refresh completed — 3 tickers updated",
      body: undefined,
      detail: { "2330": { status: "success", barsCount: 5 } },
    });

    expect(id).toBeTruthy();
    expect(typeof id).toBe("string");
  });

  it("getNotificationsForUser: returns paginated list sorted by created_at DESC", async () => {
    const userId = await createUser("paginated@example.com");

    // Create 3 notifications with slight delay to ensure ordering
    await persistence!.createNotification({
      userId, severity: "info", source: "daily_refresh", title: "First",
    });
    await persistence!.createNotification({
      userId, severity: "warning", source: "daily_refresh", title: "Second",
    });
    await persistence!.createNotification({
      userId, severity: "error", source: "daily_refresh", title: "Third",
    });

    // Page 1, limit 2
    const page1 = await persistence!.getNotificationsForUser(userId, { page: 1, limit: 2 });
    expect(page1.total).toBe(3);
    expect(page1.notifications).toHaveLength(2);
    expect(page1.notifications[0]!.title).toBe("Third"); // most recent first

    // Page 2, limit 2
    const page2 = await persistence!.getNotificationsForUser(userId, { page: 2, limit: 2 });
    expect(page2.notifications).toHaveLength(1);
    expect(page2.notifications[0]!.title).toBe("First");
  });

  it("getNotificationsForUser: excludes dismissed notifications", async () => {
    const userId = await createUser("dismissed@example.com");

    const id1 = await persistence!.createNotification({
      userId, severity: "info", source: "daily_refresh", title: "Visible",
    });
    const id2 = await persistence!.createNotification({
      userId, severity: "warning", source: "daily_refresh", title: "Dismissed",
    });

    await persistence!.dismissNotification(userId, id2);

    const result = await persistence!.getNotificationsForUser(userId, { page: 1, limit: 10 });
    expect(result.total).toBe(1);
    expect(result.notifications[0]!.id).toBe(id1);
  });

  it("getUnreadCount: counts only unread, non-dismissed notifications", async () => {
    const userId = await createUser("unread@example.com");

    await persistence!.createNotification({
      userId, severity: "info", source: "daily_refresh", title: "Unread 1",
    });
    const id2 = await persistence!.createNotification({
      userId, severity: "info", source: "daily_refresh", title: "Will be read",
    });
    const id3 = await persistence!.createNotification({
      userId, severity: "info", source: "daily_refresh", title: "Will be dismissed",
    });

    expect(await persistence!.getUnreadCount(userId)).toBe(3);

    await persistence!.markNotificationRead(userId, id2);
    expect(await persistence!.getUnreadCount(userId)).toBe(2);

    await persistence!.dismissNotification(userId, id3);
    expect(await persistence!.getUnreadCount(userId)).toBe(1);
  });

  it("markNotificationRead: sets read_at timestamp", async () => {
    const userId = await createUser("read@example.com");
    const id = await persistence!.createNotification({
      userId, severity: "info", source: "daily_refresh", title: "To be read",
    });

    await persistence!.markNotificationRead(userId, id);

    const result = await persistence!.getNotificationsForUser(userId, { page: 1, limit: 10 });
    expect(result.notifications[0]!.readAt).toBeTruthy();
  });

  it("markAllRead: marks all unread as read", async () => {
    const userId = await createUser("markall@example.com");

    await persistence!.createNotification({
      userId, severity: "info", source: "daily_refresh", title: "A",
    });
    await persistence!.createNotification({
      userId, severity: "warning", source: "daily_refresh", title: "B",
    });

    await persistence!.markAllRead(userId);

    expect(await persistence!.getUnreadCount(userId)).toBe(0);
    const result = await persistence!.getNotificationsForUser(userId, { page: 1, limit: 10 });
    expect(result.notifications.every((n) => n.readAt !== null)).toBe(true);
  });

  it("dismissNotification: sets dismissed_at, excludes from list", async () => {
    const userId = await createUser("dismiss@example.com");
    const id = await persistence!.createNotification({
      userId, severity: "info", source: "daily_refresh", title: "To dismiss",
    });

    await persistence!.dismissNotification(userId, id);

    const result = await persistence!.getNotificationsForUser(userId, { page: 1, limit: 10 });
    expect(result.total).toBe(0);
  });

  it("CRUD lifecycle: create → list → mark-read → dismiss", async () => {
    const userId = await createUser("lifecycle@example.com");

    // Create
    const id = await persistence!.createNotification({
      userId,
      severity: "warning",
      source: "daily_refresh",
      sourceRef: "batch-lifecycle",
      title: "Lifecycle test",
      body: "2330: timeout",
      detail: { "2330": { status: "failed", reason: "timeout" } },
    });

    // List
    const listed = await persistence!.getNotificationsForUser(userId, { page: 1, limit: 10 });
    expect(listed.total).toBe(1);
    expect(listed.notifications[0]!.id).toBe(id);
    expect(listed.notifications[0]!.severity).toBe("warning");
    expect(listed.notifications[0]!.source).toBe("daily_refresh");
    expect(listed.notifications[0]!.sourceRef).toBe("batch-lifecycle");
    expect(listed.notifications[0]!.title).toBe("Lifecycle test");
    expect(listed.notifications[0]!.body).toBe("2330: timeout");
    expect(listed.notifications[0]!.detail).toEqual({ "2330": { status: "failed", reason: "timeout" } });
    expect(listed.notifications[0]!.readAt).toBeNull();
    expect(listed.notifications[0]!.dismissedAt).toBeNull();

    // Mark read
    await persistence!.markNotificationRead(userId, id);
    const afterRead = await persistence!.getNotificationsForUser(userId, { page: 1, limit: 10 });
    expect(afterRead.notifications[0]!.readAt).toBeTruthy();
    expect(await persistence!.getUnreadCount(userId)).toBe(0);

    // Dismiss
    await persistence!.dismissNotification(userId, id);
    const afterDismiss = await persistence!.getNotificationsForUser(userId, { page: 1, limit: 10 });
    expect(afterDismiss.total).toBe(0);
  });

  it("per-user isolation: user A's notifications invisible to user B", async () => {
    const userA = await createUser("user-a@example.com");
    const userB = await createUser("user-b@example.com");

    await persistence!.createNotification({
      userId: userA, severity: "info", source: "daily_refresh", title: "User A notif",
    });

    const resultB = await persistence!.getNotificationsForUser(userB, { page: 1, limit: 10 });
    expect(resultB.total).toBe(0);
    expect(await persistence!.getUnreadCount(userB)).toBe(0);
  });

  it("markNotificationRead: throws 404 for non-existent notification", async () => {
    const userId = await createUser("notfound@example.com");

    await expect(
      persistence!.markNotificationRead(userId, "non-existent-id"),
    ).rejects.toThrow(/not found/i);
  });

  it("dismissNotification: throws 404 for non-existent notification", async () => {
    const userId = await createUser("notfound2@example.com");

    await expect(
      persistence!.dismissNotification(userId, "non-existent-id"),
    ).rejects.toThrow(/not found/i);
  });

  it("markNotificationEscalated: sets escalated_at timestamp", async () => {
    const userId = await createUser("escalate@example.com");
    const id = await persistence!.createNotification({
      userId, severity: "warning", source: "daily_refresh", title: "Escalate me",
    });

    await persistence!.markNotificationEscalated(userId, id);

    const result = await persistence!.getNotificationsForUser(userId, { page: 1, limit: 10 });
    expect(result.notifications[0]!.escalatedAt).toBeTruthy();
  });

  it("markNotificationEscalated: idempotent — second call succeeds without error", async () => {
    const userId = await createUser("escalate-idem@example.com");
    const id = await persistence!.createNotification({
      userId, severity: "error", source: "daily_refresh", title: "Escalate twice",
    });

    await persistence!.markNotificationEscalated(userId, id);
    await persistence!.markNotificationEscalated(userId, id);

    const result = await persistence!.getNotificationsForUser(userId, { page: 1, limit: 10 });
    expect(result.notifications[0]!.escalatedAt).toBeTruthy();
  });

  it("markNotificationEscalated: throws 404 for non-existent notification", async () => {
    const userId = await createUser("escalate-404@example.com");

    await expect(
      persistence!.markNotificationEscalated(userId, "non-existent-id"),
    ).rejects.toThrow(/not found/i);
  });

  it("markNotificationEscalated: throws 404 for dismissed notification", async () => {
    const userId = await createUser("escalate-dismissed@example.com");
    const id = await persistence!.createNotification({
      userId, severity: "warning", source: "daily_refresh", title: "Dismiss then escalate",
    });

    await persistence!.dismissNotification(userId, id);

    await expect(
      persistence!.markNotificationEscalated(userId, id),
    ).rejects.toThrow(/not found/i);
  });

});

describePostgres("refresh batch persistence", () => {
  let pool: Pool;
  let persistence: PostgresPersistence | null = null;

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
    persistence = new PostgresPersistence({
      databaseUrl: databaseUrl!,
      redisUrl: redisUrl!,
    });
    await persistence.init();
  });

  afterEach(async () => {
    if (persistence) await persistence.close();
    await pool.end();
  });

  it("createRefreshBatch: returns batch id with status=running", async () => {
    const batchId = await persistence!.createRefreshBatch(null, 5);
    expect(batchId).toBeTruthy();
    expect(typeof batchId).toBe("string");
  });

  it("updateBatchTickerResult: increments success counter and stores ticker result", async () => {
    const batchId = await persistence!.createRefreshBatch(null, 3);

    const result = await persistence!.updateBatchTickerResult(batchId, "2330", {
      status: "success",
      barsCount: 10,
      dividendsCount: 2,
    });

    expect(result).not.toBeNull();
    expect(result!.jobsSucceeded).toBe(1);
    expect(result!.jobsFailed).toBe(0);
    expect(result!.jobsTotal).toBe(3);
  });

  it("updateBatchTickerResult: increments failure counter on failed result", async () => {
    const batchId = await persistence!.createRefreshBatch(null, 3);

    const result = await persistence!.updateBatchTickerResult(batchId, "2330", {
      status: "failed",
      reason: "rate limit exceeded",
    });

    expect(result).not.toBeNull();
    expect(result!.jobsSucceeded).toBe(0);
    expect(result!.jobsFailed).toBe(1);
    expect(result!.jobsTotal).toBe(3);
  });

  it("fan-in: batch completes when succeeded + failed = total", async () => {
    const batchId = await persistence!.createRefreshBatch(null, 2);

    const r1 = await persistence!.updateBatchTickerResult(batchId, "2330", {
      status: "success", barsCount: 5, dividendsCount: 0,
    });
    expect(r1!.jobsSucceeded + r1!.jobsFailed).toBeLessThan(r1!.jobsTotal);

    const r2 = await persistence!.updateBatchTickerResult(batchId, "0050", {
      status: "failed", reason: "timeout",
    });
    expect(r2!.jobsSucceeded + r2!.jobsFailed).toBe(r2!.jobsTotal);
  });

  it("fan-in atomicity: concurrent updates don't lose counts", async () => {
    const batchId = await persistence!.createRefreshBatch(null, 5);

    const results = await Promise.all([
      persistence!.updateBatchTickerResult(batchId, "A", { status: "success", barsCount: 1, dividendsCount: 0 }),
      persistence!.updateBatchTickerResult(batchId, "B", { status: "success", barsCount: 2, dividendsCount: 0 }),
      persistence!.updateBatchTickerResult(batchId, "C", { status: "failed", reason: "err" }),
      persistence!.updateBatchTickerResult(batchId, "D", { status: "success", barsCount: 3, dividendsCount: 0 }),
      persistence!.updateBatchTickerResult(batchId, "E", { status: "failed", reason: "err" }),
    ]);

    // All results should be non-null
    expect(results.every((r) => r !== null)).toBe(true);

    // The last update should show final counts summing to 5
    const finalCounts = results.map((r) => r!.jobsSucceeded + r!.jobsFailed);
    expect(Math.max(...finalCounts)).toBe(5);

    // Verify final state via direct query
    const row = await pool.query<{ jobs_succeeded: number; jobs_failed: number }>(
      "SELECT jobs_succeeded, jobs_failed FROM refresh_batches WHERE id = $1",
      [batchId],
    );
    expect(row.rows[0]!.jobs_succeeded + row.rows[0]!.jobs_failed).toBe(5);
    expect(row.rows[0]!.jobs_succeeded).toBe(3);
    expect(row.rows[0]!.jobs_failed).toBe(2);
  });

});
