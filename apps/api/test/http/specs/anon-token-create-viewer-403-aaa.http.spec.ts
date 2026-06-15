import { test } from "../fixtures.js";
import { createOauthSession } from "./helpers/sharing.js";

test.describe("anonymous share tokens: viewer create blocked", () => {
  test("[anon token create]: viewer posts token create → 403 write_blocked_viewer_role", async ({
    request,
    anonymousShareTokensApi,
  }) => {
    const viewer = await createOauthSession(request, {
      sub: "anon-token-viewer-sub",
      email: "anon-token-viewer@example.com",
      name: "Anon Token Viewer",
      role: "viewer",
    });

    const response = await anonymousShareTokensApi.actions.createTokenForCookie(viewer.cookieHeader, 30);
    await anonymousShareTokensApi.assert.statusIs(response, 403);
    await anonymousShareTokensApi.assert.errorCodeIs(
      await anonymousShareTokensApi.arrange.errorBody(response),
      "write_blocked_viewer_role",
    );
  });
});
