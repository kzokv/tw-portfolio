import { test } from "../fixtures.js";
import { createOauthSession } from "./helpers/sharing.js";

test.describe("portfolio switcher: share revoke notification payload", () => {
  test("[switcher revoke event]: share revoke notification carries detail.{ownerUserId, ownerEmail, ownerDisplayName, shareId}", async ({
    request,
    notificationsApi,
    sharesApi,
  }) => {
    const owner = await createOauthSession(request, {
      sub: "switcher-revoke-event-owner-sub",
      email: "switcher-revoke-event-owner@example.com",
      name: "Switcher Revoke Event Owner",
      role: "admin",
    });
    const grantee = await createOauthSession(request, {
      sub: "switcher-revoke-event-grantee-sub",
      email: "switcher-revoke-event-grantee@example.com",
      name: "Switcher Revoke Event Grantee",
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
      detail: {
        ownerUserId: owner.userId,
        ownerEmail: owner.email,
        ownerDisplayName: "Switcher Revoke Event Owner",
        shareId,
      },
    });
  });
});
