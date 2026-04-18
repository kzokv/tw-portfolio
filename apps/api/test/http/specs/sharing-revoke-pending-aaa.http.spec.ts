import { test } from "../fixtures.js";
import { createOauthSession } from "./helpers/sharing.js";

test.describe("sharing pending revoke contract", () => {
  test("[sharing revoke]: owner cancels pending invite → pending row moves to revoked history", async ({
    request,
    adminApi,
    sharesApi,
  }) => {
    const owner = await createOauthSession(request, {
      sub: "sharing-owner-pending-revoke-sub",
      email: "owner-pending-revoke@example.com",
      name: "Owner Pending Revoke",
      role: "admin",
    });
    const pendingEmail = "pending-revoke@example.com";

    const createBody = await sharesApi.arrange.createBody(
      await sharesApi.actions.createShareForCookie(owner.cookieHeader, pendingEmail),
    );
    const pending = sharesApi.arrange.asPendingBody(createBody);

    const inviteCode = String(pending.invite.code ?? "");
    await sharesApi.assert.mxAssertTruthy(inviteCode, "pending invite code");

    const revokeResponse = await sharesApi.actions.revokePendingShareForCookie(owner.cookieHeader, inviteCode);
    await sharesApi.assert.statusIs(revokeResponse, 204);

    const ownerList = await sharesApi.arrange.listBody(
      await sharesApi.actions.listSharesForCookie(owner.cookieHeader),
    );
    await sharesApi.assert.bucketLengthIs(ownerList, "outbound", "pending", 0);
    await sharesApi.assert.bucketContainsValue(ownerList, "outbound", "revoked", pendingEmail);

    const auditBody = await adminApi.arrange.auditLogBody(
      await adminApi.actions.listAuditLogForCookie(owner.cookieHeader, {
        action: ["admin_invite_revoked"],
      }),
    );
    const auditEntry = auditBody.items.find((item) =>
      item.action === "admin_invite_revoked"
        && item.metadata.inviteCode === inviteCode
        && item.metadata.targetEmail === pendingEmail
        && item.metadata.shareOwnerEmail === owner.email,
    );
    await sharesApi.assert.mxAssertDefined(auditEntry, "admin_invite_revoked audit entry");
    await sharesApi.assert.auditEntryMatchesMetadata(auditEntry!, {
      inviteCode,
      targetEmail: pendingEmail,
      shareCoupled: true,
      shareOwnerEmail: owner.email,
    });
  });
});
