import { test } from "../fixtures.js";
import { createOauthSession } from "./helpers/sharing.js";

test.describe("anonymous share tokens: switched context create blocked", () => {
  test("[anon token create]: shared-context grantee posts with x-context-user-id → 403 shared_capability_required", async ({
    request,
    anonymousShareTokensApi,
    sharesApi,
  }) => {
    const owner = await createOauthSession(request, {
      sub: "anon-token-switch-owner-sub",
      email: "anon-token-switch-owner@example.com",
      name: "Anon Token Switch Owner",
      role: "admin",
    });
    const grantee = await createOauthSession(request, {
      sub: "anon-token-switch-grantee-sub",
      email: "anon-token-switch-grantee@example.com",
      name: "Anon Token Switch Grantee",
      role: "member",
    });

    const shareResponse = await sharesApi.actions.createShareForCookie(owner.cookieHeader, grantee.email);
    await sharesApi.assert.statusIs(shareResponse, 201);

    const blocked = await anonymousShareTokensApi.actions.createTokenForCookieWithContext(
      grantee.cookieHeader,
      owner.userId,
      30,
    );

    await anonymousShareTokensApi.assert.statusIs(blocked, 403);
    await anonymousShareTokensApi.assert.errorCodeIs(
      await anonymousShareTokensApi.arrange.errorBody(blocked),
      "shared_capability_required",
    );
  });
});
