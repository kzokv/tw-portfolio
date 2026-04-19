import { test } from "../fixtures.js";
import { createDemoSession } from "./helpers/sharing.js";

test.describe("anonymous share tokens: demo create blocked", () => {
  test("[anon token create]: demo user posts token create → 403 share_grant_forbidden", async ({
    request,
    anonymousShareTokensApi,
  }) => {
    const demo = await createDemoSession(request);

    const response = await anonymousShareTokensApi.actions.createTokenForCookie(demo.cookieHeader, 30);
    await anonymousShareTokensApi.assert.statusIs(response, 403);
    await anonymousShareTokensApi.assert.errorCodeIs(
      await anonymousShareTokensApi.arrange.errorBody(response),
      "share_grant_forbidden",
    );
  });
});
