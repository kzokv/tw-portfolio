import { test } from "../fixtures.js";
import { createOauthSession } from "./helpers/sharing.js";

test.describe("sharing orphan materialization contract", () => {
  test("[sharing oauth]: user signs up via a different path → pending share materializes at login", async ({
    request,
    adminApi,
    sharesApi,
  }) => {
    const owner = await createOauthSession(request, {
      sub: "sharing-orphan-owner-sub",
      email: "orphan-owner@example.com",
      name: "Orphan Owner",
      role: "admin",
    });
    const granteeEmail = "orphan-grantee@example.com";

    // Owner issues a pending share-coupled invite for an unknown email.
    const pendingResponse = await sharesApi.actions.createShareForCookie(owner.cookieHeader, granteeEmail);
    await sharesApi.assert.statusIs(pendingResponse, 201);
    const pendingBody = await sharesApi.arrange.createBody(pendingResponse);
    await sharesApi.assert.createTypeIs(pendingBody, "pending");

    // Simulate the grantee signing up via an entirely separate OAuth session
    // (not via the pending share-coupled invite). The test harness bypasses
    // the invite gate via the __e2e/oauth-session endpoint — this stands in
    // for any path that materializes the user without consuming the invite.
    const grantee = await createOauthSession(request, {
      sub: "sharing-orphan-grantee-sub",
      email: granteeEmail,
      name: "Orphan Grantee",
      role: "member",
    });

    // Inbound list for the grantee should now show an active share (materialized post-sign-up).
    const inbound = await sharesApi.arrange.listBody(
      await sharesApi.actions.listSharesForCookie(grantee.cookieHeader),
    );
    await sharesApi.assert.bucketContainsValue(inbound, "inbound", "active", owner.email);

    // Owner's outbound active list should also reflect the materialized share.
    const outbound = await sharesApi.arrange.listBody(
      await sharesApi.actions.listSharesForCookie(owner.cookieHeader),
    );
    await sharesApi.assert.bucketContainsValue(outbound, "outbound", "active", granteeEmail);

    // Audit log records the share_granted event at materialization time.
    const auditBody = await adminApi.arrange.auditLogBody(
      await adminApi.actions.listAuditLogForCookie(owner.cookieHeader, {
        action: ["share_granted"],
      }),
    );
    const auditEntry = auditBody.items.find((item) =>
      item.action === "share_granted"
        && item.metadata.ownerEmail === owner.email
        && item.metadata.granteeEmail === granteeEmail,
    );
    await sharesApi.assert.mxAssertDefined(auditEntry, "share_granted audit entry after materialization");
  });
});
