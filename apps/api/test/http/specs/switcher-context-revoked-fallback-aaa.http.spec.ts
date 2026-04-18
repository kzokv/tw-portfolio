import { TestEnv } from "@tw-portfolio/config/test";
import { transactionPayload } from "../../helpers/fixtures.js";
import { test } from "../fixtures.js";
import { createOauthSession } from "./helpers/sharing.js";

const dashboardOverviewUrl = new URL("/dashboard/overview", TestEnv.apiBaseUrl).href;

const CONTEXT_COOKIE_NAME = "tw_context_user_id";

test.describe("portfolio switcher: revoked share context fallback", () => {
  test("[switcher fallback]: revoked share x-context-user-id falls back to session, stamps revoked header + clear-cookie, returns grantee data", async ({
    request,
    sharesApi,
    transactionsApi,
  }) => {
    const owner = await createOauthSession(request, {
      sub: "switcher-revoked-owner-sub",
      email: "switcher-revoked-owner@example.com",
      name: "Switcher Revoked Owner",
      role: "admin",
    });
    const grantee = await createOauthSession(request, {
      sub: "switcher-revoked-grantee-sub",
      email: "switcher-revoked-grantee@example.com",
      name: "Switcher Revoked Grantee",
      role: "viewer",
    });

    const seedTxn = await transactionsApi.actions.createTransactionForCookie(
      owner.cookieHeader,
      undefined,
      transactionPayload({ ticker: "2330", quantity: 100, unitPrice: 600, tradeDate: "2026-01-04" }),
      "switcher-revoked-seed-1",
    );
    await sharesApi.assert.statusIs(seedTxn, 200);

    const createBody = await sharesApi.arrange.createBody(
      await sharesApi.actions.createShareForCookie(owner.cookieHeader, grantee.email),
    );
    const resolved = sharesApi.arrange.asResolvedBody(createBody);
    const shareId = String(resolved.share.id ?? "");
    await sharesApi.assert.mxAssertTruthy(shareId, "resolved share id");

    const revokeResponse = await sharesApi.actions.revokeShareForCookie(owner.cookieHeader, shareId);
    await sharesApi.assert.statusIs(revokeResponse, 204);

    const response = await request.get(dashboardOverviewUrl, {
      headers: {
        cookie: grantee.cookieHeader,
        "x-context-user-id": owner.userId,
      },
    });

    await sharesApi.assert.statusIs(response, 200);
    await sharesApi.assert.mxAssertEqual(
      response.headers()["x-context-fallback"],
      "revoked",
      "x-context-fallback header is revoked",
    );

    const setCookieHeader = response.headers()["set-cookie"] ?? "";
    await sharesApi.assert.mxAssertTruthy(
      setCookieHeader.includes(`${CONTEXT_COOKIE_NAME}=;`)
        && setCookieHeader.includes("Max-Age=0"),
      `set-cookie clears ${CONTEXT_COOKIE_NAME} (got: ${setCookieHeader})`,
    );

    const body = await response.json() as { summary: { holdingCount: number } };
    await sharesApi.assert.mxAssertEqual(
      body.summary.holdingCount,
      0,
      "summary.holdingCount is 0 (response uses grantee's empty data, not owner's)",
    );
  });
});
