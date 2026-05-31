import { test } from "../fixtures.js";
import { seedSingleAnonymousShareToken } from "./helpers/anonymousShare.js";
import { createOauthSession } from "./helpers/sharing.js";

test.describe("anonymous share tokens: list retention", () => {
  test("[anon token list]: active + recent terminal rows listed → older terminal rows filtered and statuses derived", async ({
    request,
    anonymousShareTokensApi,
  }) => {
    const owner = await createOauthSession(request, {
      sub: "anon-token-list-owner-sub",
      email: "anon-token-list-owner@example.com",
      name: "Anon Token List Owner",
      role: "member",
    });

    const active = await seedSingleAnonymousShareToken(request, {
      ownerUserId: owner.userId,
      expiresInDays: 30,
    });
    const recentExpired = await seedSingleAnonymousShareToken(request, {
      ownerUserId: owner.userId,
      expiresAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    });
    const oldExpired = await seedSingleAnonymousShareToken(request, {
      ownerUserId: owner.userId,
      expiresAt: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString(),
    });
    const revoked = await seedSingleAnonymousShareToken(request, {
      ownerUserId: owner.userId,
      expiresInDays: 30,
    });

    const revokeResponse = await anonymousShareTokensApi.actions.revokeTokenForCookie(owner.cookieHeader, revoked.id);
    await anonymousShareTokensApi.assert.statusIs(revokeResponse, 204);

    const listBody = await anonymousShareTokensApi.arrange.listBody(
      await anonymousShareTokensApi.actions.listTokensForCookie(owner.cookieHeader),
    );

    await anonymousShareTokensApi.assert.listContainsTokenId(listBody, active.id);
    await anonymousShareTokensApi.assert.listContainsTokenId(listBody, recentExpired.id);
    await anonymousShareTokensApi.assert.listContainsTokenId(listBody, revoked.id);
    await anonymousShareTokensApi.assert.listExcludesTokenId(listBody, oldExpired.id);

    await anonymousShareTokensApi.assert.tokenStatusIs(
      anonymousShareTokensApi.arrange.findTokenById(listBody, active.id)!,
      "active",
    );
    await anonymousShareTokensApi.assert.tokenStatusIs(
      anonymousShareTokensApi.arrange.findTokenById(listBody, recentExpired.id)!,
      "expired",
    );
    await anonymousShareTokensApi.assert.tokenStatusIs(
      anonymousShareTokensApi.arrange.findTokenById(listBody, revoked.id)!,
      "revoked",
    );
  });
});
