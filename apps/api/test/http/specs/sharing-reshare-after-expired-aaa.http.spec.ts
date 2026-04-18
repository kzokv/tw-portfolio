import { TestEnv } from "@tw-portfolio/config/test";
import { test } from "../fixtures.js";
import { createOauthSession } from "./helpers/sharing.js";

test.describe("sharing re-share contract", () => {
  test("[sharing grant]: expired pending invite for same email → fresh pending invite issued", async ({
    request,
    adminApi,
    sharesApi,
  }) => {
    const owner = await createOauthSession(request, {
      sub: "sharing-reshare-owner-sub",
      email: "reshare-owner@example.com",
      name: "Reshare Owner",
      role: "admin",
    });
    const pendingEmail = "reshare-target@example.com";

    // Admin creates an invite for the target email with a past expires_at —
    // simulating a pending invite that has rolled off into the "expired" bucket.
    const expiredAt = new Date(Date.now() - 1_000 * 60 * 60).toISOString();
    const expiredInviteResponse = await request.post(new URL("/invites", TestEnv.apiBaseUrl).href, {
      data: { email: pendingEmail, role: "viewer", expiresAt: expiredAt },
      headers: { cookie: owner.cookieHeader },
    });
    await sharesApi.assert.mxAssertResponseStatus(expiredInviteResponse, 201);
    const expiredInvite = await expiredInviteResponse.json() as { code: string };

    // Owner re-shares — dedup SELECT filters out expired rows, so a new invite must mint.
    const createResponse = await sharesApi.actions.createShareForCookie(owner.cookieHeader, pendingEmail);
    await sharesApi.assert.statusIs(createResponse, 201);
    const createBody = await sharesApi.arrange.createBody(createResponse);
    const pending = sharesApi.arrange.asPendingBody(createBody);

    // Fresh code — must differ from the expired one.
    await sharesApi.assert.mxAssertTruthy(
      pending.invite.code !== expiredInvite.code,
      "re-share mints a new invite code distinct from the expired one",
    );

    // Admin invite list now shows both rows (expired + new pending).
    const invitesBody = await adminApi.arrange.invitesBody(
      await adminApi.actions.listInvitesForCookie(owner.cookieHeader, { email: pendingEmail }),
    );
    await sharesApi.assert.mxAssertEqual(invitesBody.items.length, 2, "expired and new invite coexist");
  });
});
