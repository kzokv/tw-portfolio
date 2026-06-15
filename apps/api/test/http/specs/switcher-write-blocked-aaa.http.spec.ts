import { transactionPayload } from "../../helpers/fixtures.js";
import { test } from "../fixtures.js";
import { createOauthSession } from "./helpers/sharing.js";

test.describe("portfolio switcher: write blocked in shared context", () => {
  test("[switcher write block]: grantee POST /portfolio/transactions without delegated capability is rejected 403 shared_capability_required and owner data is unchanged", async ({
    request,
    sharesApi,
    transactionsApi,
  }) => {
    const owner = await createOauthSession(request, {
      sub: "switcher-write-owner-sub",
      email: "switcher-write-owner@example.com",
      name: "Switcher Write Owner",
      role: "admin",
    });
    const grantee = await createOauthSession(request, {
      sub: "switcher-write-grantee-sub",
      email: "switcher-write-grantee@example.com",
      name: "Switcher Write Grantee",
      role: "member",
    });

    const seedTxn = await transactionsApi.actions.createTransactionForCookie(
      owner.cookieHeader,
      undefined,
      transactionPayload({ ticker: "2330", quantity: 100, unitPrice: 600, tradeDate: "2026-01-05" }),
      "switcher-write-seed-1",
    );
    await sharesApi.assert.statusIs(seedTxn, 200);

    const createBody = await sharesApi.arrange.createBody(
      await sharesApi.actions.createShareForCookie(owner.cookieHeader, grantee.email),
    );
    sharesApi.arrange.asResolvedBody(createBody);

    const blockedWrite = await transactionsApi.actions.createTransactionForCookie(
      grantee.cookieHeader,
      owner.userId,
      transactionPayload({ ticker: "2454", quantity: 25, unitPrice: 1000, tradeDate: "2026-01-06" }),
      "switcher-write-blocked-1",
    );
    await sharesApi.assert.statusIs(blockedWrite, 403);
    const errorBody = await blockedWrite.json() as { error: string };
    await sharesApi.assert.mxAssertEqual(
      errorBody.error,
      "shared_capability_required",
      "error code is shared_capability_required",
    );

    const ownerListResponse = await transactionsApi.actions.listTransactionsForCookie(owner.cookieHeader);
    await sharesApi.assert.statusIs(ownerListResponse, 200);
    const ownerTransactions = await ownerListResponse.json() as Array<{ ticker: string }>;
    await sharesApi.assert.mxAssertEqual(
      ownerTransactions.length,
      1,
      "owner has only the seeded transaction (blocked write did not persist)",
    );
    await sharesApi.assert.mxAssertEqual(
      ownerTransactions[0]?.ticker,
      "2330",
      "owner's surviving transaction is the seeded one",
    );
  });
});
