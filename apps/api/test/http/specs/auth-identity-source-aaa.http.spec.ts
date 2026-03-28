import { test } from "../fixtures.js";

test.describe("session cookie as sole identity source (AUTH_MODE=oauth)", () => {
  test("x-authenticated-user-id header is ignored", async ({ sessionApi, settingsApi }) => {
    const cookie = await sessionApi.arrange.currentSessionCookie();
    const sessionUserId = await sessionApi.arrange.currentSessionUserId();

    const response = await settingsApi.actions.getSettingsForCookie(cookie, {
      "x-authenticated-user-id": "evil-override",
    });

    await settingsApi.assert.statusIs(response, 200);
    const body = await settingsApi.arrange.settingsBody(response);
    await settingsApi.assert.fieldEquals(body, "userId", sessionUserId);
  });

  test("unauthenticated request with x-authenticated-user-id header returns 401", async ({ settingsApi }) => {
    const response = await settingsApi.actions.getSettingsForCookie("", {
      "x-authenticated-user-id": "user-1",
    });

    await settingsApi.assert.statusIs(response, 401);
  });

  test("unauthenticated request without any identity headers returns 401", async ({ settingsApi }) => {
    const response = await settingsApi.actions.getSettingsForCookie("");
    await settingsApi.assert.statusIs(response, 401);
  });
});
