import { TestEnv } from "@vakwen/config/test";
import { test } from "../fixtures.js";
import { createOauthSession } from "./helpers/sharing.js";

test.describe("sharing hard-purge cascade contract", () => {
  test("[admin hard-purge]: purging share owner → grantee's inbound list is cleared via ON DELETE CASCADE", async ({
    request,
    sharesApi,
  }) => {
    const purger = await createOauthSession(request, {
      sub: "sharing-purger-admin-sub",
      email: "purger-admin@example.com",
      name: "Purger Admin",
      role: "admin",
    });
    const owner = await createOauthSession(request, {
      sub: "sharing-purge-owner-sub",
      email: "purge-owner@example.com",
      name: "Purge Owner",
      role: "member",
    });
    const grantee = await createOauthSession(request, {
      sub: "sharing-purge-grantee-sub",
      email: "purge-grantee@example.com",
      name: "Purge Grantee",
      role: "viewer",
    });

    // Owner creates an active share to the grantee.
    const createResponse = await sharesApi.actions.createShareForCookie(owner.cookieHeader, grantee.email);
    await sharesApi.assert.statusIs(createResponse, 201);

    // Sanity: grantee sees the inbound share.
    const preInbound = await sharesApi.arrange.listBody(
      await sharesApi.actions.listSharesForCookie(grantee.cookieHeader),
    );
    await sharesApi.assert.bucketLengthIs(preInbound, "inbound", "active", 1);

    // Admin hard-purges the owner. Requires the server-validated confirmation phrase.
    const purgeResponse = await request.delete(
      new URL(`/admin/users/${owner.userId}/purge`, TestEnv.apiBaseUrl).href,
      {
        data: {
          confirmation: `PURGE ${owner.email}`,
          adminEmail: purger.email,
        },
        headers: { cookie: purger.cookieHeader },
      },
    );
    await sharesApi.assert.mxAssertResponseStatus(purgeResponse, 204);

    // FK cascade: portfolio_shares rows are deleted when the owner row is.
    const postInbound = await sharesApi.arrange.listBody(
      await sharesApi.actions.listSharesForCookie(grantee.cookieHeader),
    );
    await sharesApi.assert.bucketLengthIs(postInbound, "inbound", "active", 0);
    await sharesApi.assert.bucketLengthIs(postInbound, "inbound", "revoked", 0);
  });
});
