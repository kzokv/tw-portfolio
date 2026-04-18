import { test } from "../fixtures.js";
import { createOauthSession } from "./helpers/sharing.js";

test.describe("sharing pending invite contract", () => {
  test("[sharing grant]: unknown email issues viewer invite → pending list and audit row created", async ({
    request,
    adminApi,
    sharesApi,
  }) => {
    const owner = await createOauthSession(request, {
      sub: "sharing-owner-pending-sub",
      email: "owner-pending@example.com",
      name: "Owner Pending",
      role: "admin",
    });
    const pendingEmail = "bob-pending@example.com";

    const createResponse = await sharesApi.actions.createShareForCookie(owner.cookieHeader, pendingEmail);
    await sharesApi.assert.statusIs(createResponse, 201);
    const createBody = await sharesApi.arrange.createBody(createResponse);
    const pending = sharesApi.arrange.asPendingBody(createBody);
    await sharesApi.assert.fieldContains(pending.invite, "inviteUrl", "/invite/");

    const ownerList = await sharesApi.arrange.listBody(
      await sharesApi.actions.listSharesForCookie(owner.cookieHeader),
    );
    await sharesApi.assert.bucketContainsValue(ownerList, "outbound", "pending", pendingEmail);

    const invitesBody = await adminApi.arrange.invitesBody(
      await adminApi.actions.listInvitesForCookie(owner.cookieHeader, { email: pendingEmail }),
    );
    const invite = adminApi.arrange.findInviteByEmail(invitesBody, pendingEmail);
    await sharesApi.assert.mxAssertDefined(invite, "pending share invite");
    await sharesApi.assert.mxAssertEqual(invite?.role, "viewer", "pending invite role");

    const auditBody = await adminApi.arrange.auditLogBody(
      await adminApi.actions.listAuditLogForCookie(owner.cookieHeader, {
        action: ["admin_invite_issued"],
      }),
    );
    const auditEntry = auditBody.items.find((item) =>
      item.action === "admin_invite_issued"
        && item.metadata.targetEmail === pendingEmail
        && item.metadata.shareOwnerEmail === owner.email,
    );
    await sharesApi.assert.mxAssertDefined(auditEntry, "admin_invite_issued audit entry");
    await sharesApi.assert.auditEntryMatchesMetadata(auditEntry!, {
      targetEmail: pendingEmail,
      shareCoupled: true,
      shareOwnerEmail: owner.email,
    });
  });
});
