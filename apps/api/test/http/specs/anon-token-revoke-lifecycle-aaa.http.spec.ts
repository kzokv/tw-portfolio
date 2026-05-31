import { test } from "../fixtures.js";
import { seedSingleAnonymousShareToken } from "./helpers/anonymousShare.js";
import { createOauthSession } from "./helpers/sharing.js";

test.describe("anonymous share tokens: revoke lifecycle", () => {
  test("[anon token revoke]: first revoke audits once → rerevoke no-ops, wrong owner 404, expired revoke stays no-op", async ({
    request,
    adminApi,
    anonymousShareTokensApi,
  }) => {
    const owner = await createOauthSession(request, {
      sub: "anon-token-revoke-owner-sub",
      email: "anon-token-revoke-owner@example.com",
      name: "Anon Token Revoke Owner",
      role: "member",
    });
    const otherUser = await createOauthSession(request, {
      sub: "anon-token-revoke-other-sub",
      email: "anon-token-revoke-other@example.com",
      name: "Anon Token Revoke Other",
      role: "member",
    });
    const auditor = await createOauthSession(request, {
      sub: "anon-token-revoke-auditor-sub",
      email: "anon-token-revoke-auditor@example.com",
      name: "Anon Token Revoke Auditor",
      role: "admin",
    });

    const active = await seedSingleAnonymousShareToken(request, {
      ownerUserId: owner.userId,
      expiresInDays: 30,
    });
    const expired = await seedSingleAnonymousShareToken(request, {
      ownerUserId: owner.userId,
      expiresAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    });

    const firstRevoke = await anonymousShareTokensApi.actions.revokeTokenForCookie(owner.cookieHeader, active.id);
    await anonymousShareTokensApi.assert.statusIs(firstRevoke, 204);

    const secondRevoke = await anonymousShareTokensApi.actions.revokeTokenForCookie(owner.cookieHeader, active.id);
    await anonymousShareTokensApi.assert.statusIs(secondRevoke, 204);

    const wrongOwner = await anonymousShareTokensApi.actions.revokeTokenForCookie(otherUser.cookieHeader, active.id);
    await anonymousShareTokensApi.assert.statusIs(wrongOwner, 404);
    await anonymousShareTokensApi.assert.errorCodeIs(
      await anonymousShareTokensApi.arrange.errorBody(wrongOwner),
      "token_not_found",
    );

    const expiredRevoke = await anonymousShareTokensApi.actions.revokeTokenForCookie(owner.cookieHeader, expired.id);
    await anonymousShareTokensApi.assert.statusIs(expiredRevoke, 204);

    const listBody = await anonymousShareTokensApi.arrange.listBody(
      await anonymousShareTokensApi.actions.listTokensForCookie(owner.cookieHeader),
    );
    await anonymousShareTokensApi.assert.tokenStatusIs(
      anonymousShareTokensApi.arrange.findTokenById(listBody, active.id)!,
      "revoked",
    );
    await anonymousShareTokensApi.assert.tokenStatusIs(
      anonymousShareTokensApi.arrange.findTokenById(listBody, expired.id)!,
      "expired",
    );

    const auditBody = await adminApi.arrange.auditLogBody(
      await adminApi.actions.listAuditLogForCookie(auditor.cookieHeader, {
        action: ["share_token_revoked"],
        actorUserId: owner.userId,
      }),
    );

    const activeEntries = auditBody.items.filter((item) => item.metadata.tokenId === active.id);
    const expiredEntries = auditBody.items.filter((item) => item.metadata.tokenId === expired.id);

    await anonymousShareTokensApi.assert.mxAssertEqual(
      activeEntries.length,
      1,
      "active token revoke emits exactly one audit entry",
    );
    await anonymousShareTokensApi.assert.mxAssertEqual(
      expiredEntries.length,
      0,
      "expired token revoke does not emit audit entries",
    );
  });
});
