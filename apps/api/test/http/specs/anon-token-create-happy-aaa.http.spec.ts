import { test } from "../fixtures.js";
import { createOauthSession } from "./helpers/sharing.js";

test.describe("anonymous share tokens: create happy path", () => {
  test("[anon token create]: member creates 30d token → dto returns and audit stores tokenId + ttlDays only", async ({
    request,
    adminApi,
    anonymousShareTokensApi,
  }) => {
    const owner = await createOauthSession(request, {
      sub: "anon-token-create-member-sub",
      email: "anon-token-create-member@example.com",
      name: "Anon Token Member",
      role: "member",
    });
    const auditor = await createOauthSession(request, {
      sub: "anon-token-auditor-sub",
      email: "anon-token-auditor@example.com",
      name: "Anon Token Auditor",
      role: "admin",
    });

    const createResponse = await anonymousShareTokensApi.actions.createTokenForCookie(owner.cookieHeader, 30);
    await anonymousShareTokensApi.assert.statusIs(createResponse, 201);

    const token = await anonymousShareTokensApi.arrange.createBody(createResponse);
    await anonymousShareTokensApi.assert.tokenShapeIsValid(token);

    const auditBody = await adminApi.arrange.auditLogBody(
      await adminApi.actions.listAuditLogForCookie(auditor.cookieHeader, {
        action: ["share_token_created"],
        actorUserId: owner.userId,
      }),
    );
    const entry = auditBody.items.find((item) => item.metadata.tokenId === token.id);

    await anonymousShareTokensApi.assert.mxAssertDefined(entry, "share_token_created audit entry");
    await anonymousShareTokensApi.assert.auditEntryMatchesMetadata(entry!, {
      tokenId: token.id,
      ttlDays: 30,
      expiresAt: token.expiresAt,
    });
    await anonymousShareTokensApi.assert.auditEntryOmitsMetadata(entry!, "token");
  });
});
