import { test } from "../fixtures.js";
import { createOauthSession } from "./helpers/sharing.js";

const PENDING_SHARE_INVITE_LIMIT = 10;

test.describe("sharing rate-limit contract", () => {
  test("[sharing grant]: 11th active pending share-coupled invite → 429 share_invite_rate_limited", async ({
    request,
    sharesApi,
  }) => {
    const owner = await createOauthSession(request, {
      sub: "sharing-rate-limit-owner-sub",
      email: "rate-limit-owner@example.com",
      name: "Rate Limit Owner",
      role: "admin",
    });

    // Issue `PENDING_SHARE_INVITE_LIMIT` pending share-coupled invites to distinct emails.
    for (let index = 0; index < PENDING_SHARE_INVITE_LIMIT; index += 1) {
      const response = await sharesApi.actions.createShareForCookie(owner.cookieHeader, `rate-target-${index}@example.com`);
      await sharesApi.assert.statusIs(response, 201);
    }

    // The 11th attempt (distinct email → no dedup path) must be rate-limited.
    const overflow = await sharesApi.actions.createShareForCookie(owner.cookieHeader, `rate-target-overflow@example.com`);
    await sharesApi.assert.statusIs(overflow, 429);
    const body = await overflow.json() as Record<string, unknown>;
    await sharesApi.assert.fieldEquals(body, "error", "share_invite_rate_limited");
  });
});
