import { TestEnv } from "@tw-portfolio/config/test";
import { test } from "../fixtures.js";

const sessionCookieRequiresSecure = TestEnv.sessionCookieName.startsWith("__Host-");

test.describe("POST /__e2e/oauth-session", () => {
  test("returns signed session cookie with hardcoded sub when no id_token is provided", async ({ sessionApi }) => {
    const response = await sessionApi.actions.createOauthSession();
    await sessionApi.assert.statusIs(response, 200);
    const body = await sessionApi.arrange.sessionBody(response);

    await sessionApi.assert.bodyFieldEquals(body, "status", "ok");
    await sessionApi.assert.bodyFieldEquals(body, "sub", "e2e-ci-google-sub-001");
    await sessionApi.assert.bodyUserIdIsUuid(body);
    await sessionApi.assert.responseSetCookieContains(response, `${TestEnv.sessionCookieName}=`);
    await sessionApi.assert.responseSetCookieContains(response, "HttpOnly");

    const cookieHeader = await sessionApi.arrange.sessionCookieHeader(response);
    await sessionApi.assert.cookieUserIdEquals(cookieHeader, body.userId);
  });

  test("returns signed session cookie from decoded id_token when provided", async ({ sessionApi }) => {
    const response = await sessionApi.actions.createOauthSessionForClaims({
      sub: "google-custom-sub-456",
      email: "test@example.com",
    });
    await sessionApi.assert.statusIs(response, 200);
    const body = await sessionApi.arrange.sessionBody(response);

    await sessionApi.assert.bodyFieldEquals(body, "status", "ok");
    await sessionApi.assert.bodyFieldEquals(body, "sub", "google-custom-sub-456");
    await sessionApi.assert.bodyUserIdIsUuid(body);

    const cookieHeader = await sessionApi.arrange.sessionCookieHeader(response);
    await sessionApi.assert.cookieUserIdEquals(cookieHeader, body.userId);
  });

  test("uses the same cookie attributes as the real callback flow", async ({ sessionApi }) => {
    const response = await sessionApi.actions.createOauthSession();

    await sessionApi.assert.responseSetCookieContains(response, "Path=/");
    await sessionApi.assert.responseSetCookieContains(response, "HttpOnly");
    await sessionApi.assert.responseSetCookieContains(response, "SameSite=Lax");

    if (sessionCookieRequiresSecure) {
      await sessionApi.assert.responseSetCookieContains(response, "Secure");
    }
  });
});
