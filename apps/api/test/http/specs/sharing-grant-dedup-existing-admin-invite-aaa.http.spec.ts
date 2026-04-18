import { TestEnv } from "@tw-portfolio/config/test";
import { test } from "../fixtures.js";
import { createOauthSession } from "./helpers/sharing.js";

test.describe("sharing dedup contract", () => {
  test("[sharing grant]: pending admin invite already exists → share intent attaches in place, no new invite", async ({
    request,
    adminApi,
    sharesApi,
  }) => {
    const admin = await createOauthSession(request, {
      sub: "sharing-dedup-admin-sub",
      email: "owner-dedup@example.com",
      name: "Owner Dedup",
      role: "admin",
    });
    const pendingEmail = "dedup-target@example.com";

    // Admin issues an invite for the email first (no share intent yet)
    const inviteResponse = await request.post(new URL("/invites", TestEnv.apiBaseUrl).href, {
      data: { email: pendingEmail, role: "member" },
      headers: { cookie: admin.cookieHeader },
    });
    await sharesApi.assert.mxAssertResponseStatus(inviteResponse, 201);
    const issuedInvite = await inviteResponse.json() as { code: string };

    // Owner (same admin in this test) now issues a share for the same email
    const shareResponse = await sharesApi.actions.createShareForCookie(admin.cookieHeader, pendingEmail);
    await sharesApi.assert.statusIs(shareResponse, 201);
    const createBody = await sharesApi.arrange.createBody(shareResponse);
    const pending = sharesApi.arrange.asPendingBody(createBody);

    // Dedup: reuses the existing code, does NOT mint a new one
    await sharesApi.assert.fieldEquals(pending.invite, "code", issuedInvite.code);

    // Invite list still has exactly one invite for this email
    const invitesBody = await adminApi.arrange.invitesBody(
      await adminApi.actions.listInvitesForCookie(admin.cookieHeader, { email: pendingEmail }),
    );
    await sharesApi.assert.mxAssertEqual(invitesBody.items.length, 1, "invite count after dedup");
  });
});
