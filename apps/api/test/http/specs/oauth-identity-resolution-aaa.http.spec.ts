import { test } from "../fixtures.js";

test.describe("/__e2e/oauth-session identity resolution", () => {
  test("creates a user and sets a cookie with a valid UUID", async ({ sessionApi }) => {
    const response = await sessionApi.actions.createOauthSession();
    await sessionApi.assert.statusIs(response, 200);
    const body = await sessionApi.arrange.sessionBody(response);
    const cookieHeader = await sessionApi.arrange.sessionCookieHeader(response);

    await sessionApi.assert.bodyUserIdIsUuid(body);
    await sessionApi.assert.cookieUserIdEquals(cookieHeader, body.userId);
  });

  test("reuses the same userId for repeated calls with the same custom id_token", async ({ sessionApi }) => {
    const claims = {
      sub: "custom-sub-001",
      email: "custom@example.com",
      name: "Custom User",
    };

    const firstResponse = await sessionApi.actions.createOauthSessionForClaims(claims);
    await sessionApi.assert.statusIs(firstResponse, 200);
    const firstBody = await sessionApi.arrange.sessionBody(firstResponse);

    const secondResponse = await sessionApi.actions.createOauthSessionForClaims(claims);
    await sessionApi.assert.statusIs(secondResponse, 200);
    const secondBody = await sessionApi.arrange.sessionBody(secondResponse);

    await sessionApi.assert.bodyFieldEquals(firstBody, "userId", secondBody.userId);
  });

  test("session cookie grants access to protected routes", async ({ sessionApi, settingsApi }) => {
    const sessionResponse = await sessionApi.actions.createOauthSession();
    await sessionApi.assert.statusIs(sessionResponse, 200);
    const sessionBody = await sessionApi.arrange.sessionBody(sessionResponse);
    const cookieHeader = await sessionApi.arrange.sessionCookieHeader(sessionResponse);

    const settingsResponse = await settingsApi.actions.getSettingsForCookie(cookieHeader);
    await settingsApi.assert.statusIs(settingsResponse, 200);
    const settingsBody = await settingsApi.arrange.settingsBody(settingsResponse);
    await settingsApi.assert.fieldEquals(settingsBody, "userId", sessionBody.userId);
  });
});
