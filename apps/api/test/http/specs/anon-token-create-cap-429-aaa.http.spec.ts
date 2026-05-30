import { test } from "../fixtures.js";
import { seedSingleAnonymousShareToken } from "./helpers/anonymousShare.js";
import { createOauthSession } from "./helpers/sharing.js";

test.describe("anonymous share tokens: active cap enforced", () => {
  test("[anon token create]: owner already has 20 active tokens → 429 anonymous_token_cap_exceeded", async ({
    request,
    anonymousShareTokensApi,
  }) => {
    const owner = await createOauthSession(request, {
      sub: "anon-token-cap-owner-sub",
      email: "anon-token-cap-owner@example.com",
      name: "Anon Token Cap Owner",
      role: "member",
    });

    for (let index = 0; index < 20; index += 1) {
      await seedSingleAnonymousShareToken(request, {
        ownerUserId: owner.userId,
        expiresInDays: 30,
      });
    }

    const response = await anonymousShareTokensApi.actions.createTokenForCookie(owner.cookieHeader, 30);
    await anonymousShareTokensApi.assert.statusIs(response, 429);
    await anonymousShareTokensApi.assert.errorCodeIs(
      await anonymousShareTokensApi.arrange.errorBody(response),
      "anonymous_token_cap_exceeded",
    );
  });
});
