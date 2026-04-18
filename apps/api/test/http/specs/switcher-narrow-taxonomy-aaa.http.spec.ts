import { TestEnv } from "@tw-portfolio/config/test";
import type { NotificationDto } from "@tw-portfolio/shared-types";
import { transactionPayload } from "../../helpers/fixtures.js";
import { test } from "../fixtures.js";
import { createOauthSession } from "./helpers/sharing.js";

const profileUrl = new URL("/profile", TestEnv.apiBaseUrl).href;
const notificationsUrl = new URL("/notifications", TestEnv.apiBaseUrl).href;
const sharesUrl = new URL("/shares", TestEnv.apiBaseUrl).href;

test.describe("portfolio switcher: narrow write-block taxonomy", () => {
  test("[switcher taxonomy]: identity routes return session user even under shared context, while write routes are blocked 403", async ({
    request,
    sharesApi,
    transactionsApi,
  }) => {
    const owner = await createOauthSession(request, {
      sub: "switcher-narrow-owner-sub",
      email: "switcher-narrow-owner@example.com",
      name: "Switcher Narrow Owner",
      role: "admin",
    });
    const grantee = await createOauthSession(request, {
      sub: "switcher-narrow-grantee-sub",
      email: "switcher-narrow-grantee@example.com",
      name: "Switcher Narrow Grantee",
      role: "member",
    });
    const bystander = await createOauthSession(request, {
      sub: "switcher-narrow-bystander-sub",
      email: "switcher-narrow-bystander@example.com",
      name: "Switcher Narrow Bystander",
      role: "member",
    });

    const createBody = await sharesApi.arrange.createBody(
      await sharesApi.actions.createShareForCookie(owner.cookieHeader, grantee.email),
    );
    sharesApi.arrange.asResolvedBody(createBody);

    // Seed distinct outbound shares for the grantee (to prove /shares returns
    // grantee's shares, not owner's) by granting from grantee to bystander.
    await sharesApi.actions.createShareForCookie(grantee.cookieHeader, bystander.email);

    const profileResponse = await request.get(profileUrl, {
      headers: {
        cookie: grantee.cookieHeader,
        "x-context-user-id": owner.userId,
      },
    });
    await sharesApi.assert.statusIs(profileResponse, 200);
    await sharesApi.assert.mxAssertEqual(
      profileResponse.headers()["x-context-fallback"],
      undefined,
      "x-context-fallback header is absent on identity route",
    );
    const profileBody = await profileResponse.json() as { userId: string; email: string | null };
    await sharesApi.assert.mxAssertEqual(
      profileBody.userId,
      grantee.userId,
      "/profile returns grantee's userId (session-scoped, not context-scoped)",
    );
    await sharesApi.assert.mxAssertEqual(
      profileBody.email,
      grantee.email,
      "/profile returns grantee's email",
    );

    // /notifications — grantee's own inbox, even under shared context. The
    // grantee received a `Portfolio shared with you` notification when the
    // owner granted them above, so that becomes our sentinel. Owner
    // notifications should never appear.
    const notificationsResponse = await request.get(notificationsUrl, {
      headers: {
        cookie: grantee.cookieHeader,
        "x-context-user-id": owner.userId,
      },
    });
    await sharesApi.assert.statusIs(notificationsResponse, 200);
    const notificationsBody = await notificationsResponse.json() as {
      notifications: NotificationDto[];
    };
    const granteeSharingTitle = notificationsBody.notifications.some(
      (n) => n.source === "sharing" && n.title === "Portfolio shared with you",
    );
    await sharesApi.assert.mxAssertTruthy(
      granteeSharingTitle,
      "/notifications returns the grantee's sharing inbox under shared context",
    );

    // /shares — grantee's outbound list must contain the share-to-bystander
    // grant created above. The owner's outbound list (which has a share to
    // grantee) must NOT appear here.
    const sharesResponse = await request.get(sharesUrl, {
      headers: {
        cookie: grantee.cookieHeader,
        "x-context-user-id": owner.userId,
      },
    });
    await sharesApi.assert.statusIs(sharesResponse, 200);
    const sharesBody = await sharesResponse.json() as {
      outbound: { active: Array<{ granteeEmail: string | null }> };
      inbound: { active: Array<{ ownerEmail: string | null }> };
    };
    const granteeOutboundEmails = sharesBody.outbound.active.map((r) => r.granteeEmail);
    await sharesApi.assert.mxAssertTruthy(
      granteeOutboundEmails.includes(bystander.email),
      "/shares.outbound.active contains the grantee's outbound grant (to bystander)",
    );
    await sharesApi.assert.mxAssertTruthy(
      !granteeOutboundEmails.includes(grantee.email),
      "/shares does not leak the owner's outbound grant (to grantee)",
    );
    const granteeInboundEmails = sharesBody.inbound.active.map((r) => r.ownerEmail);
    await sharesApi.assert.mxAssertTruthy(
      granteeInboundEmails.includes(owner.email),
      "/shares.inbound.active contains the grantee's inbound grant from owner",
    );

    const blockedWrite = await transactionsApi.actions.createTransactionForCookie(
      grantee.cookieHeader,
      owner.userId,
      transactionPayload({ ticker: "2330", quantity: 10, unitPrice: 600, tradeDate: "2026-01-07" }),
      "switcher-narrow-write-1",
    );
    await sharesApi.assert.statusIs(blockedWrite, 403);
    const errorBody = await blockedWrite.json() as { error: string };
    await sharesApi.assert.mxAssertEqual(
      errorBody.error,
      "write_blocked_viewing_shared",
      "write route is blocked with write_blocked_viewing_shared",
    );
  });
});
