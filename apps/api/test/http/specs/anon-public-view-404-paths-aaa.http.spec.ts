import { test } from "../fixtures.js";
import {
  deactivateAnonShareOwner,
  resetAnonymousShareRateLimit,
  seedSingleAnonymousShareToken,
} from "./helpers/anonymousShare.js";
import { createOauthSession } from "./helpers/sharing.js";

const UNKNOWN_TOKEN = "AbCdEfGhIjKlMnOpQrStUv";

test.describe("anonymous public view: 404 paths", () => {
  test("[anon public view]: expired, revoked, missing, malformed, and deactivated-owner tokens → identical 404 token_not_found", async ({
    request,
    anonymousShareTokensApi,
  }) => {
    await resetAnonymousShareRateLimit(request);

    const owner = await createOauthSession(request, {
      sub: "anon-public-404-owner-sub",
      email: "anon-public-404-owner@example.com",
      name: "Anon Public 404 Owner",
      role: "member",
    });

    const expired = await seedSingleAnonymousShareToken(request, {
      ownerUserId: owner.userId,
      expiresAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    });
    const revoked = await seedSingleAnonymousShareToken(request, {
      ownerUserId: owner.userId,
      expiresInDays: 30,
      revokedAt: new Date().toISOString(),
    });
    const deactivatedOwner = await seedSingleAnonymousShareToken(request, {
      ownerUserId: owner.userId,
      expiresInDays: 30,
    });

    await deactivateAnonShareOwner(request, owner.userId);

    for (const token of [expired.token, revoked.token, deactivatedOwner.token, UNKNOWN_TOKEN, "bad-token"]) {
      const response = await anonymousShareTokensApi.actions.fetchPublicView(token);
      await anonymousShareTokensApi.assert.statusIs(response, 404);
      await anonymousShareTokensApi.assert.errorCodeIs(
        await anonymousShareTokensApi.arrange.errorBody(response),
        "token_not_found",
      );
    }
  });
});
