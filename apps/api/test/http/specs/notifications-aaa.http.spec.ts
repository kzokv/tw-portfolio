import { test } from "../fixtures.js";

test.describe("notifications", () => {
  test("GET /notifications: returns empty list for fresh user", async ({
    notificationsApi,
  }) => {
    const response = await notificationsApi.actions.listNotifications();
    await notificationsApi.assert.statusIs(response, 200);
    const body = await notificationsApi.arrange.notificationListBody(response);
    await notificationsApi.assert.notificationCountIs(body, 0);
    await notificationsApi.assert.totalIs(body, 0);
    await notificationsApi.assert.fieldEquals(body as Record<string, unknown>, "page", 1);
    await notificationsApi.assert.fieldEquals(body as Record<string, unknown>, "limit", 20);
  });

  test("GET /notifications: pagination params are respected", async ({
    notificationsApi,
  }) => {
    const response = await notificationsApi.actions.listNotifications({ page: 2, limit: 5 });
    await notificationsApi.assert.statusIs(response, 200);
    const body = await notificationsApi.arrange.notificationListBody(response);
    await notificationsApi.assert.fieldEquals(body as Record<string, unknown>, "page", 2);
    await notificationsApi.assert.fieldEquals(body as Record<string, unknown>, "limit", 5);
  });

  test("GET /notifications/unread-count: returns 0 for fresh user", async ({
    notificationsApi,
  }) => {
    const response = await notificationsApi.actions.getUnreadCount();
    await notificationsApi.assert.statusIs(response, 200);
    const body = await notificationsApi.arrange.unreadCountBody(response);
    await notificationsApi.assert.unreadCountIs(body, 0);
  });

  test("CRUD lifecycle: seed → list → mark-read → mark-all-read → dismiss", async ({
    notificationsApi,
  }) => {
    // Seed two notifications
    const seed1Res = await notificationsApi.actions.seedNotification({
      severity: "info",
      source: "daily_refresh",
      title: "Daily refresh completed — 3 tickers updated",
    });
    await notificationsApi.assert.statusIs(seed1Res, 200);
    const seed1 = await notificationsApi.arrange.seedBody(seed1Res);
    const id1 = seed1.id as string;

    const seed2Res = await notificationsApi.actions.seedNotification({
      severity: "warning",
      source: "daily_refresh",
      title: "Daily refresh: 1 of 3 failed",
      body: "2330: timeout",
    });
    await notificationsApi.assert.statusIs(seed2Res, 200);
    const seed2 = await notificationsApi.arrange.seedBody(seed2Res);
    const id2 = seed2.id as string;

    // List — should have 2 notifications
    const listRes = await notificationsApi.actions.listNotifications();
    await notificationsApi.assert.statusIs(listRes, 200);
    const listBody = await notificationsApi.arrange.notificationListBody(listRes);
    await notificationsApi.assert.totalIs(listBody, 2);
    await notificationsApi.assert.notificationCountIs(listBody, 2);

    // Unread count should be 2
    const unreadRes = await notificationsApi.actions.getUnreadCount();
    const unreadBody = await notificationsApi.arrange.unreadCountBody(unreadRes);
    await notificationsApi.assert.unreadCountIs(unreadBody, 2);

    // Mark first notification as read
    const markReadRes = await notificationsApi.actions.markRead(id1);
    await notificationsApi.assert.statusIs(markReadRes, 200);

    // Unread count should be 1
    const unreadAfterRead = await notificationsApi.arrange.unreadCountBody(
      await notificationsApi.actions.getUnreadCount(),
    );
    await notificationsApi.assert.unreadCountIs(unreadAfterRead, 1);

    // Mark all read
    const markAllRes = await notificationsApi.actions.markAllRead();
    await notificationsApi.assert.statusIs(markAllRes, 200);

    // Unread count should be 0
    const unreadAfterAll = await notificationsApi.arrange.unreadCountBody(
      await notificationsApi.actions.getUnreadCount(),
    );
    await notificationsApi.assert.unreadCountIs(unreadAfterAll, 0);

    // Dismiss second notification
    const dismissRes = await notificationsApi.actions.dismiss(id2);
    await notificationsApi.assert.statusIs(dismissRes, 200);

    // List should have 1 notification (dismissed excluded)
    const listAfterDismiss = await notificationsApi.arrange.notificationListBody(
      await notificationsApi.actions.listNotifications(),
    );
    await notificationsApi.assert.totalIs(listAfterDismiss, 1);
    await notificationsApi.assert.notificationCountIs(listAfterDismiss, 1);
  });

  test("PATCH /notifications/:id/read: marks single notification as read", async ({
    notificationsApi,
  }) => {
    const seedRes = await notificationsApi.actions.seedNotification({
      severity: "error",
      source: "daily_refresh",
      title: "All tickers failed",
    });
    const seed = await notificationsApi.arrange.seedBody(seedRes);
    const id = seed.id as string;

    const markRes = await notificationsApi.actions.markRead(id);
    await notificationsApi.assert.statusIs(markRes, 200);

    // Verify the notification now has readAt set
    const listBody = await notificationsApi.arrange.notificationListBody(
      await notificationsApi.actions.listNotifications(),
    );
    const notification = listBody.notifications[0]!;
    await notificationsApi.assert.fieldEquals(notification, "id", id);
    // readAt should be populated (non-null)
    await notificationsApi.assert.fieldIsTruthy(notification, "readAt");
  });

  test("DELETE /notifications/:id: soft-dismisses notification from list", async ({
    notificationsApi,
  }) => {
    const seedRes = await notificationsApi.actions.seedNotification({
      severity: "info",
      source: "daily_refresh",
      title: "Will be dismissed",
    });
    const seed = await notificationsApi.arrange.seedBody(seedRes);
    const id = seed.id as string;

    // Dismiss
    const dismissRes = await notificationsApi.actions.dismiss(id);
    await notificationsApi.assert.statusIs(dismissRes, 200);

    // List should be empty
    const listBody = await notificationsApi.arrange.notificationListBody(
      await notificationsApi.actions.listNotifications(),
    );
    await notificationsApi.assert.totalIs(listBody, 0);
  });

  test("PATCH /notifications/read-all: marks all unread as read", async ({
    notificationsApi,
  }) => {
    // Seed 3 notifications
    await notificationsApi.actions.seedNotification({
      severity: "info", source: "daily_refresh", title: "A",
    });
    await notificationsApi.actions.seedNotification({
      severity: "warning", source: "daily_refresh", title: "B",
    });
    await notificationsApi.actions.seedNotification({
      severity: "error", source: "daily_refresh", title: "C",
    });

    // Unread count = 3
    const before = await notificationsApi.arrange.unreadCountBody(
      await notificationsApi.actions.getUnreadCount(),
    );
    await notificationsApi.assert.unreadCountIs(before, 3);

    // Mark all read
    await notificationsApi.actions.markAllRead();

    // Unread count = 0
    const after = await notificationsApi.arrange.unreadCountBody(
      await notificationsApi.actions.getUnreadCount(),
    );
    await notificationsApi.assert.unreadCountIs(after, 0);
  });

  test("PATCH /notifications/:id/read: returns 404 for non-existent notification", async ({
    notificationsApi,
  }) => {
    const response = await notificationsApi.actions.markRead("non-existent-id");
    await notificationsApi.assert.statusIs(response, 404);
  });

  test("DELETE /notifications/:id: returns 404 for non-existent notification", async ({
    notificationsApi,
  }) => {
    const response = await notificationsApi.actions.dismiss("non-existent-id");
    await notificationsApi.assert.statusIs(response, 404);
  });

  test("PATCH /notifications/:id/escalate: escalates a notification", async ({
    notificationsApi,
  }) => {
    const seedRes = await notificationsApi.actions.seedNotification({
      severity: "warning",
      source: "daily_refresh",
      title: "Needs escalation",
    });
    const seed = await notificationsApi.arrange.seedBody(seedRes);
    const id = seed.id as string;

    const escalateRes = await notificationsApi.actions.escalate(id);
    await notificationsApi.assert.statusIs(escalateRes, 200);

    // Verify the notification now has escalatedAt set
    const listBody = await notificationsApi.arrange.notificationListBody(
      await notificationsApi.actions.listNotifications(),
    );
    const notification = listBody.notifications[0]!;
    await notificationsApi.assert.fieldEquals(notification, "id", id);
    await notificationsApi.assert.fieldIsTruthy(notification, "escalatedAt");
  });

  test("PATCH /notifications/:id/escalate: idempotent — re-escalate succeeds", async ({
    notificationsApi,
  }) => {
    const seedRes = await notificationsApi.actions.seedNotification({
      severity: "error",
      source: "daily_refresh",
      title: "Escalate twice",
    });
    const seed = await notificationsApi.arrange.seedBody(seedRes);
    const id = seed.id as string;

    await notificationsApi.actions.escalate(id);
    const secondRes = await notificationsApi.actions.escalate(id);
    await notificationsApi.assert.statusIs(secondRes, 200);
  });

  test("PATCH /notifications/:id/escalate: returns 404 for non-existent notification", async ({
    notificationsApi,
  }) => {
    const response = await notificationsApi.actions.escalate("non-existent-id");
    await notificationsApi.assert.statusIs(response, 404);
  });
});
