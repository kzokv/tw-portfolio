import { test } from "../fixtures.js";
import { createOauthSession } from "./helpers/sharing.js";

test.describe("sharing self-share guard", () => {
  test("[sharing grant]: owner shares to own email → rejected with cannot_share_with_self", async ({
    request,
    sharesApi,
  }) => {
    const owner = await createOauthSession(request, {
      sub: "sharing-owner-self-sub",
      email: "owner-self@example.com",
      name: "Owner Self",
      role: "member",
    });

    const response = await sharesApi.actions.createShareForCookie(owner.cookieHeader, owner.email);
    await sharesApi.assert.statusIs(response, 400);
    const body = await response.json() as Record<string, unknown>;
    await sharesApi.assert.fieldEquals(body, "error", "cannot_share_with_self");
  });
});
