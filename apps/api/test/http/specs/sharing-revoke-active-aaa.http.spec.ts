import { test } from "../fixtures.js";
import { createOauthSession } from "./helpers/sharing.js";

test.describe("sharing revoke contract", () => {
  test("[sharing revoke]: owner revokes active share → inbound disappears and grantee is notified", async ({
    request,
    adminApi,
    notificationsApi,
    sharesApi,
  }) => {
    const owner = await createOauthSession(request, {
      sub: "sharing-owner-revoke-sub",
      email: "owner-revoke@example.com",
      name: "Owner Revoke",
      role: "admin",
    });
    const grantee = await createOauthSession(request, {
      sub: "sharing-grantee-revoke-sub",
      email: "grantee-revoke@example.com",
      name: "Grantee Revoke",
      role: "viewer",
    });

    const createBody = await sharesApi.arrange.createBody(
      await sharesApi.actions.createShareForCookie(owner.cookieHeader, grantee.email),
    );
    const resolved = sharesApi.arrange.asResolvedBody(createBody);

    const shareId = String(resolved.share.id ?? "");
    await sharesApi.assert.mxAssertTruthy(shareId, "resolved share id");

    const revokeResponse = await sharesApi.actions.revokeShareForCookie(owner.cookieHeader, shareId);
    await sharesApi.assert.statusIs(revokeResponse, 204);

    const granteeList = await sharesApi.arrange.listBody(
      await sharesApi.actions.listSharesForCookie(grantee.cookieHeader),
    );
    await sharesApi.assert.bucketLengthIs(granteeList, "inbound", "active", 0);

    const auditBody = await adminApi.arrange.auditLogBody(
      await adminApi.actions.listAuditLogForCookie(owner.cookieHeader, {
        action: ["share_revoked"],
      }),
    );
    const auditEntry = auditBody.items.find((item) =>
      item.action === "share_revoked"
        && item.metadata.ownerEmail === owner.email
        && item.metadata.granteeEmail === grantee.email
        && item.metadata.shareId === shareId,
    );
    await sharesApi.assert.mxAssertDefined(auditEntry, "share_revoked audit entry");
    await sharesApi.assert.auditEntryMatchesMetadata(auditEntry!, {
      ownerEmail: owner.email,
      granteeEmail: grantee.email,
      shareId,
    });

    const notificationsBody = await notificationsApi.arrange.typedListBody(
      await notificationsApi.actions.listNotificationsForCookie(grantee.cookieHeader),
    );
    const notification = notificationsApi.arrange.findNotificationByTitle(
      notificationsBody,
      "Portfolio access revoked",
    );
    await sharesApi.assert.mxAssertDefined(notification, "share revoke notification");
    await sharesApi.assert.notificationMatches(notification!, {
      source: "sharing",
      severity: "info",
      title: "Portfolio access revoked",
    });
  });
});
