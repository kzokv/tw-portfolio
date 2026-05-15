import { test } from "@vakwen/test-e2e/fixtures/authPages";

const FAKE_NOTIFICATION_ID = "fake-id";

test.describe("notification authentication", () => {
  test("notification auth: GET /notifications without session → returns 401", async ({ session }) => {
    const response = await session.actions.requestNotifications();
    await session.assert.responseStatusIs(response, 401);
  });

  test("notification auth: GET /notifications/unread-count without session → returns 401", async ({ session }) => {
    const response = await session.actions.requestNotificationUnreadCount();
    await session.assert.responseStatusIs(response, 401);
  });

  test("notification auth: PATCH /notifications/:id/read without session → returns 401", async ({ session }) => {
    const response = await session.actions.requestNotificationMarkRead(FAKE_NOTIFICATION_ID);
    await session.assert.responseStatusIs(response, 401);
  });

  test("notification auth: PATCH /notifications/read-all without session → returns 401", async ({ session }) => {
    const response = await session.actions.requestNotificationsMarkAllRead();
    await session.assert.responseStatusIs(response, 401);
  });

  test("notification auth: DELETE /notifications/:id without session → returns 401", async ({ session }) => {
    const response = await session.actions.requestNotificationDelete(FAKE_NOTIFICATION_ID);
    await session.assert.responseStatusIs(response, 401);
  });

  test("notification auth: PATCH /notifications/:id/escalate without session → returns 401", async ({ session }) => {
    const response = await session.actions.requestNotificationEscalate(FAKE_NOTIFICATION_ID);
    await session.assert.responseStatusIs(response, 401);
  });
});
