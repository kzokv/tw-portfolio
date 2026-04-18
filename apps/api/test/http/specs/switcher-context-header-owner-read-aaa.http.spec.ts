import { TestEnv } from "@tw-portfolio/config/test";
import { transactionPayload } from "../../helpers/fixtures.js";
import { test } from "../fixtures.js";
import { createOauthSession } from "./helpers/sharing.js";

const dashboardOverviewUrl = new URL("/dashboard/overview", TestEnv.apiBaseUrl).href;

test.describe("portfolio switcher: context header owner read", () => {
  test("[switcher context]: grantee with x-context-user-id reads owner data and no fallback header", async ({
    request,
    sharesApi,
    transactionsApi,
  }) => {
    const owner = await createOauthSession(request, {
      sub: "switcher-owner-read-sub",
      email: "switcher-owner-read@example.com",
      name: "Switcher Owner Read",
      role: "admin",
    });
    const grantee = await createOauthSession(request, {
      sub: "switcher-grantee-read-sub",
      email: "switcher-grantee-read@example.com",
      name: "Switcher Grantee Read",
      role: "viewer",
    });

    const createBody = await sharesApi.arrange.createBody(
      await sharesApi.actions.createShareForCookie(owner.cookieHeader, grantee.email),
    );
    sharesApi.arrange.asResolvedBody(createBody);

    const seedTxn1 = await transactionsApi.actions.createTransactionForCookie(
      owner.cookieHeader,
      undefined,
      transactionPayload({ ticker: "2330", quantity: 100, unitPrice: 600, tradeDate: "2026-01-02" }),
      "switcher-seed-owner-read-1",
    );
    await sharesApi.assert.statusIs(seedTxn1, 200);

    const seedTxn2 = await transactionsApi.actions.createTransactionForCookie(
      owner.cookieHeader,
      undefined,
      transactionPayload({ ticker: "2454", quantity: 50, unitPrice: 1000, tradeDate: "2026-01-03" }),
      "switcher-seed-owner-read-2",
    );
    await sharesApi.assert.statusIs(seedTxn2, 200);

    const response = await request.get(dashboardOverviewUrl, {
      headers: {
        cookie: grantee.cookieHeader,
        "x-context-user-id": owner.userId,
      },
    });

    await sharesApi.assert.statusIs(response, 200);
    await sharesApi.assert.mxAssertEqual(
      response.headers()["x-context-fallback"],
      undefined,
      "x-context-fallback header is absent",
    );
    const body = await response.json() as { summary: { holdingCount: number } };
    await sharesApi.assert.mxAssertTruthy(
      body.summary.holdingCount > 0,
      `summary.holdingCount > 0 (got ${body.summary.holdingCount})`,
    );
  });
});
