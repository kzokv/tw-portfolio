import { test } from "../fixtures.js";
import { createOauthSession } from "./helpers/sharing.js";

test.describe("sharing grant contract", () => {
  test("[sharing grant]: known grantee email resolves immediately → outbound and inbound lists update", async ({
    request,
    adminApi,
    sharesApi,
  }) => {
    const owner = await createOauthSession(request, {
      sub: "sharing-owner-known-sub",
      email: "owner-known@example.com",
      name: "Owner Known",
      role: "admin",
    });
    const grantee = await createOauthSession(request, {
      sub: "sharing-grantee-known-sub",
      email: "grantee-known@example.com",
      name: "Grantee Known",
      role: "viewer",
    });

    const createResponse = await sharesApi.actions.createShareForCookie(owner.cookieHeader, grantee.email);
    await sharesApi.assert.statusIs(createResponse, 201);
    const createBody = await sharesApi.arrange.createBody(createResponse);
    const resolved = sharesApi.arrange.asResolvedBody(createBody);
    await sharesApi.assert.fieldEquals(resolved.share, "granteeEmail", grantee.email);

    const ownerList = await sharesApi.arrange.listBody(
      await sharesApi.actions.listSharesForCookie(owner.cookieHeader),
    );
    await sharesApi.assert.bucketContainsValue(ownerList, "outbound", "active", grantee.email);

    const granteeList = await sharesApi.arrange.listBody(
      await sharesApi.actions.listSharesForCookie(grantee.cookieHeader),
    );
    await sharesApi.assert.bucketContainsValue(granteeList, "inbound", "active", owner.email);

    const auditBody = await adminApi.arrange.auditLogBody(
      await adminApi.actions.listAuditLogForCookie(owner.cookieHeader, {
        action: ["share_granted"],
      }),
    );
    const auditEntry = auditBody.items.find((item) =>
      item.action === "share_granted"
        && item.metadata.ownerEmail === owner.email
        && item.metadata.granteeEmail === grantee.email,
    );
    await sharesApi.assert.mxAssertDefined(auditEntry, "share_granted audit entry");
    await sharesApi.assert.auditEntryMatchesMetadata(auditEntry!, {
      ownerEmail: owner.email,
      granteeEmail: grantee.email,
    });
  });
});
