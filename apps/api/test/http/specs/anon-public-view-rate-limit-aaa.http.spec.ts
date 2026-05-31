import { test } from "../fixtures.js";
import { resetAnonymousShareRateLimit, seedSingleAnonymousShareToken } from "./helpers/anonymousShare.js";
import { createOauthSession } from "./helpers/sharing.js";

const UNKNOWN_TOKEN = "ZyXwVuTsRqPoNmLkJiHgFe";

test.describe("anonymous public view: rate limit", () => {
  test("[anon public view]: 30 requests allowed → invalid token also counts and next request returns 429 with retry-after", async ({
    request,
    anonymousShareTokensApi,
  }) => {
    const owner = await createOauthSession(request, {
      sub: "anon-public-rate-owner-sub",
      email: "anon-public-rate-owner@example.com",
      name: "Anon Public Rate Owner",
      role: "member",
    });
    const token = await seedSingleAnonymousShareToken(request, {
      ownerUserId: owner.userId,
      expiresInDays: 30,
    });

    await resetAnonymousShareRateLimit(request);
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const ok = await anonymousShareTokensApi.actions.fetchPublicView(token.token);
      await anonymousShareTokensApi.assert.statusIs(ok, 200);
    }
    const overLimit = await anonymousShareTokensApi.actions.fetchPublicView(token.token);
    await anonymousShareTokensApi.assert.statusIs(overLimit, 429);
    await anonymousShareTokensApi.assert.errorCodeIs(
      await anonymousShareTokensApi.arrange.errorBody(overLimit),
      "rate_limit_exceeded",
    );
    await anonymousShareTokensApi.assert.headerEquals(overLimit, "retry-after", "300");

    await resetAnonymousShareRateLimit(request);
    for (let attempt = 0; attempt < 29; attempt += 1) {
      const ok = await anonymousShareTokensApi.actions.fetchPublicView(token.token);
      await anonymousShareTokensApi.assert.statusIs(ok, 200);
    }

    const invalid = await anonymousShareTokensApi.actions.fetchPublicView(UNKNOWN_TOKEN);
    await anonymousShareTokensApi.assert.statusIs(invalid, 404);
    await anonymousShareTokensApi.assert.errorCodeIs(
      await anonymousShareTokensApi.arrange.errorBody(invalid),
      "token_not_found",
    );

    const countedAfterInvalid = await anonymousShareTokensApi.actions.fetchPublicView(token.token);
    await anonymousShareTokensApi.assert.statusIs(countedAfterInvalid, 429);
    await anonymousShareTokensApi.assert.errorCodeIs(
      await anonymousShareTokensApi.arrange.errorBody(countedAfterInvalid),
      "rate_limit_exceeded",
    );
    await anonymousShareTokensApi.assert.headerEquals(countedAfterInvalid, "retry-after", "300");
  });
});
