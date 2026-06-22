import { TestEnv } from "@vakwen/config/test";
import type { NotificationDto } from "@vakwen/shared-types";
import { transactionPayload } from "../../helpers/fixtures.js";
import { test } from "../fixtures.js";
import { createOauthSession } from "./helpers/sharing.js";

const profileUrl = new URL("/profile", TestEnv.apiBaseUrl).href;
const notificationsUrl = new URL("/notifications", TestEnv.apiBaseUrl).href;
const sharesUrl = new URL("/shares", TestEnv.apiBaseUrl).href;

test.describe("portfolio switcher: narrow write-block taxonomy", () => {
  test("[switcher taxonomy]: identity routes return session user even under shared context, while undelegated write routes return shared_capability_required", async ({
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

    // Seed a distinct outbound share for the grantee to prove `/shares` no
    // longer falls back to session-scoped data while viewing another owner's
    // portfolio without `sharing:manage`.
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

    // /shares — direct access is now owner-scoped and therefore requires the
    // delegated `sharing:manage` capability. The grantee's own outbound share
    // must not leak through as a session-scoped fallback.
    const sharesResponse = await request.get(sharesUrl, {
      headers: {
        cookie: grantee.cookieHeader,
        "x-context-user-id": owner.userId,
      },
    });
    await sharesApi.assert.statusIs(sharesResponse, 403);
    const sharesBody = await sharesResponse.json() as {
      error: string;
      metadata?: { routeKey?: string; requiredCapability?: string };
    };
    await sharesApi.assert.mxAssertEqual(
      sharesBody.error,
      "shared_capability_required",
      "/shares returns shared_capability_required without delegated sharing management",
    );
    await sharesApi.assert.mxAssertEqual(
      sharesBody.metadata?.routeKey,
      "GET /shares",
      "/shares denial reports the owner-scoped route key",
    );
    await sharesApi.assert.mxAssertEqual(
      sharesBody.metadata?.requiredCapability,
      "sharing:manage",
      "/shares denial requires sharing:manage",
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
      "shared_capability_required",
      "write route is blocked with shared_capability_required",
    );
  });
});
