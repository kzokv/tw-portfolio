import { test } from "../fixtures.js";

test.describe("session cookie identity format (AUTH_MODE=oauth)", () => {
  test("session cookie userId part is a UUID", async ({ sessionApi }) => {
    const cookie = await sessionApi.arrange.currentSessionCookie();
    await sessionApi.assert.cookieUserIdIsUuid(cookie);
  });

  test("/settings returns a UUID as userId", async ({ sessionApi, settingsApi }) => {
    const response = await settingsApi.actions.getSettings();
    await settingsApi.assert.statusIs(response, 200);
    const body = await settingsApi.arrange.settingsBody(response);
    await sessionApi.assert.bodyUserIdIsUuid(body);
  });

  test("userId in session cookie matches userId returned by /settings", async ({ sessionApi, settingsApi }) => {
    const sessionUserId = await sessionApi.arrange.currentSessionUserId();

    const response = await settingsApi.actions.getSettings();
    await settingsApi.assert.statusIs(response, 200);
    const body = await settingsApi.arrange.settingsBody(response);
    await settingsApi.assert.fieldEquals(body, "userId", sessionUserId);
  });
});
