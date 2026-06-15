import { TestEnv } from "@vakwen/config/test";
import { transactionPayload } from "../../helpers/fixtures.js";
import { test } from "../fixtures.js";
import { createOauthSession } from "./helpers/sharing.js";

const sharesUrl = new URL("/shares", TestEnv.apiBaseUrl).href;

test.describe("portfolio switcher: delegated transaction write", () => {
  test("[switcher delegated write]: grantee can post owner transaction after owner grants transaction:write", async ({
    request,
    sharesApi,
    transactionsApi,
  }) => {
    const owner = await createOauthSession(request, {
      sub: "switcher-delegated-write-owner-sub",
      email: "switcher-delegated-write-owner@example.com",
      name: "Switcher Delegated Write Owner",
      role: "admin",
    });
    const grantee = await createOauthSession(request, {
      sub: "switcher-delegated-write-grantee-sub",
      email: "switcher-delegated-write-grantee@example.com",
      name: "Switcher Delegated Write Grantee",
      role: "viewer",
    });

    const createBody = await sharesApi.arrange.createBody(
      await sharesApi.actions.createShareForCookie(owner.cookieHeader, grantee.email),
    );
    const share = sharesApi.arrange.asResolvedBody(createBody);
    const shareId = String(share.share["id"]);

    const grantResponse = await request.patch(`${sharesUrl}/${shareId}/capabilities`, {
      headers: {
        cookie: owner.cookieHeader,
        "content-type": "application/json",
      },
      data: {
        capabilities: ["portfolio:mcp_read", "transaction:write"],
      },
    });
    await sharesApi.assert.statusIs(grantResponse, 200);

    const delegatedWrite = await transactionsApi.actions.createTransactionForCookie(
      grantee.cookieHeader,
      owner.userId,
      transactionPayload({ ticker: "2330", quantity: 10, unitPrice: 600, tradeDate: "2026-01-07" }),
      "switcher-delegated-write-1",
    );
    await sharesApi.assert.statusIs(delegatedWrite, 200);

    const ownerListResponse = await transactionsApi.actions.listTransactionsForCookie(owner.cookieHeader);
    await sharesApi.assert.statusIs(ownerListResponse, 200);
    const ownerTransactions = await ownerListResponse.json() as Array<{ ticker: string }>;
    await sharesApi.assert.mxAssertTruthy(
      ownerTransactions.some((transaction) => transaction.ticker === "2330"),
      "owner portfolio contains the delegated transaction",
    );
  });
});
