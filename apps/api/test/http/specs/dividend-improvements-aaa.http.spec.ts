import type { APIResponse } from "@playwright/test";
import { TestEnv } from "@vakwen/config/test";
import {
  dividendPostingPayload,
  seededDividendEventPayload,
} from "../../helpers/fixtures.js";
import { test } from "../fixtures.js";

type JsonObject = Record<string, unknown>;

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Expected ${label} to be an object`);
  }
  return value as JsonObject;
}

function array(value: unknown, label: string): JsonObject[] {
  if (!Array.isArray(value)) throw new Error(`Expected ${label} to be an array`);
  return value.map((entry, index) => object(entry, `${label}[${index}]`));
}

async function body(response: APIResponse): Promise<JsonObject> {
  return object(await response.json(), "response body");
}

function confirmation(previewBody: JsonObject): JsonObject {
  const preview = object(previewBody.preview, "preview");
  return {
    previewId: String(preview.previewId),
    previewVersion: Number(preview.previewVersion),
    fingerprint: String(preview.fingerprint),
  };
}

test.describe("locked dividend HTTP contracts", () => {
  test("[daily highlights]: UTC boundary instant → TW market-local today selects the local calendar date", async ({
    dividendsApi,
  }) => {
    await dividendsApi.actions.seedDividendEvent(seededDividendEventPayload({
      ticker: "7710",
      exDividendDate: "2026-07-10",
      paymentDate: "2026-07-10",
      eligibleQuantity: 100,
    }));
    await dividendsApi.actions.seedDividendEvent(seededDividendEventPayload({
      ticker: "7709",
      exDividendDate: "2026-07-09",
      paymentDate: "2026-07-09",
      eligibleQuantity: 100,
    }));

    const response = await dividendsApi.actions.listDailyHighlights({
      at: "2026-07-09T16:30:00.000Z",
      marketCode: "TW",
    });
    await dividendsApi.assert.statusIs(response, 200);
    const responseBody = await body(response);
    const payingToday = array(responseBody.payingToday, "payingToday");
    const exDividendToday = array(responseBody.exDividendToday, "exDividendToday");

    await dividendsApi.assert.mxAssertTruthy(
      payingToday.map((item) => item.ticker).includes("7710"),
      "payingToday includes 7710",
    );
    await dividendsApi.assert.mxAssertTruthy(
      exDividendToday.map((item) => item.ticker).includes("7710"),
      "exDividendToday includes 7710",
    );
    await dividendsApi.assert.mxAssertTruthy(
      !payingToday.map((item) => item.ticker).includes("7709"),
      "payingToday omits 7709",
    );
    await dividendsApi.assert.mxAssertTruthy(
      !exDividendToday.map((item) => item.ticker).includes("7709"),
      "exDividendToday omits 7709",
    );
    await dividendsApi.assert.mxAssertEqual(
      payingToday.find((item) => item.ticker === "7710")?.applicableLocalDate,
      "2026-07-10",
      "payingToday[7710].applicableLocalDate",
    );
  });

  test("[read models]: default and configured page sizes → holding and ticker sections expose independent 10/25/50 contracts", async ({
    dividendsApi,
  }) => {
    const seed = await dividendsApi.actions.seedDividendEvent(seededDividendEventPayload({
      ticker: "7725",
      exDividendDate: "2026-07-01",
      paymentDate: "2026-07-20",
      cashDividendPerShare: 0.2,
    }));
    const eventId = await dividendsApi.arrange.seededDividendEventId(await dividendsApi.arrange.seedBody(seed));
    await dividendsApi.actions.createOrUpdatePosting(dividendPostingPayload({
      dividendEventId: eventId,
      receivedCashAmount: 180,
      sourceCompositionStatus: "unknown_pending_disclosure",
      sourceLines: [],
      deductions: [],
    }));

    const holdingResponse = await dividendsApi.actions.listHoldingActivity("7725", {
      marketCode: "TW",
      positionActionsLimit: 10,
      postedLimit: 25,
      upcomingLimit: 50,
    });
    await dividendsApi.assert.statusIs(holdingResponse, 200);
    const holding = await body(holdingResponse);
    await dividendsApi.assert.mxAssertEqual(
      object(holding.positionActions, "positionActions").limit,
      10,
      "positionActions.limit",
    );
    await dividendsApi.assert.mxAssertEqual(
      object(holding.postedDividends, "postedDividends").limit,
      25,
      "postedDividends.limit",
    );
    await dividendsApi.assert.mxAssertEqual(
      object(holding.upcomingDividends, "upcomingDividends").limit,
      50,
      "upcomingDividends.limit",
    );

    const [upcomingResponse, openResponse, postedResponse] = await Promise.all([
      dividendsApi.actions.listTickerDividends("7725", "upcoming", { marketCode: "TW" }),
      dividendsApi.actions.listTickerDividends("7725", "open-reconciliation", { marketCode: "TW", limit: 25 }),
      dividendsApi.actions.listTickerDividends("7725", "posted-history", { marketCode: "TW", limit: 50 }),
    ]);
    for (const response of [upcomingResponse, openResponse, postedResponse]) {
      await dividendsApi.assert.statusIs(response, 200);
    }
    await dividendsApi.assert.mxAssertEqual(
      object((await body(upcomingResponse)).upcomingDividends, "upcomingDividends").limit,
      10,
      "upcomingDividends.limit",
    );
    await dividendsApi.assert.mxAssertEqual(
      object((await body(openResponse)).openReconciliation, "openReconciliation").limit,
      25,
      "openReconciliation.limit",
    );
    const postedPage = object((await body(postedResponse)).postedHistory, "postedHistory");
    await dividendsApi.assert.mxAssertEqual(postedPage.limit, 50, "postedHistory.limit");
    const postedItem = array(postedPage.items, "postedHistory.items")[0];
    await dividendsApi.assert.mxAssertDefined(postedItem, "postedHistory.items[0]");
    await dividendsApi.assert.fieldEquals(postedItem!, "ticker", "7725", "postedHistory.items[0]");
    await dividendsApi.assert.fieldEquals(postedItem!, "paymentDate", "2026-07-20", "postedHistory.items[0]");
    await dividendsApi.assert.fieldEquals(postedItem!, "exDividendDate", "2026-07-01", "postedHistory.items[0]");
    await dividendsApi.assert.fieldEquals(postedItem!, "reconciliationStatus", "open", "postedHistory.items[0]");
    await dividendsApi.assert.mxAssertEqual(typeof postedItem?.postedAt, "string", "postedHistory.items[0].postedAt type");
  });

  test("[single delete]: preview, stale confirm, valid confirm, and token reuse → impact is explicit and derived posting is permanently removed", async ({
    dividendsApi,
    request,
    testUser,
  }) => {
    const seed = await dividendsApi.actions.seedDividendEvent(seededDividendEventPayload({
      ticker: "7731",
      tradeDate: "2026-01-02",
      exDividendDate: "2026-02-01",
      paymentDate: "2026-02-20",
      cashDividendPerShare: 0.2,
    }));
    const eventId = await dividendsApi.arrange.seededDividendEventId(await dividendsApi.arrange.seedBody(seed));
    const postingResponse = await dividendsApi.actions.createOrUpdatePosting(dividendPostingPayload({
      dividendEventId: eventId,
    }));
    await dividendsApi.assert.statusIs(postingResponse, 200);
    const posting = await dividendsApi.arrange.dividendLedgerEntry(postingResponse);
    const ledgerEntryId = String(posting.id);

    const transactionsResponse = await request.get(new URL("/portfolio/transactions", TestEnv.apiBaseUrl).href, {
      headers: { cookie: testUser.sessionCookie ?? "" },
    });
    await dividendsApi.assert.statusIs(transactionsResponse, 200);
    const transactionsBody = await transactionsResponse.json() as unknown;
    const transactions = Array.isArray(transactionsBody)
      ? array(transactionsBody, "transactions")
      : array(object(transactionsBody, "transactions body").transactions, "transactions");
    const trade = transactions.find((entry) => entry.ticker === "7731");
    if (!trade) throw new Error("Expected seeded 7731 trade");

    const previewResponse = await dividendsApi.actions.previewTradeDelete(String(trade.id), "Incorrect source trade");
    await dividendsApi.assert.statusIs(previewResponse, 200);
    const previewBody = await body(previewResponse);
    const operation = object(previewBody.operation, "operation");
    await dividendsApi.assert.mxAssertEqual(operation.kind, "trade_delete", "operation.kind");
    await dividendsApi.assert.mxAssertEqual(
      operation.targetTradeEventId,
      String(trade.id),
      "operation.targetTradeEventId",
    );
    await dividendsApi.assert.mxAssertEqual(
      operation.reason,
      "Incorrect source trade",
      "operation.reason",
    );
    await dividendsApi.assert.mxAssertGreaterThanOrEqual(
      Number(object(previewBody.affectedCounts, "affectedCounts").dividendLedgerEntries),
      1,
      "affectedCounts.dividendLedgerEntries",
    );
    await dividendsApi.assert.mxAssertTruthy(
      array(previewBody.affectedDividends, "affectedDividends").some((entry) => (
        entry.dividendLedgerEntryId === ledgerEntryId && entry.requiresManualReceiptReentry === true
      )),
      "affectedDividends contains manual reentry ledger entry",
    );
    await dividendsApi.assert.mxAssertTruthy(
      Array.isArray(previewBody.manualReceiptReentryLedgerEntryIds)
        && previewBody.manualReceiptReentryLedgerEntryIds.includes(ledgerEntryId),
      "manualReceiptReentryLedgerEntryIds includes ledger entry id",
    );

    const token = confirmation(previewBody);
    const staleResponse = await dividendsApi.actions.confirmTradeDelete(String(trade.id), {
      ...token,
      previewVersion: Number(token.previewVersion) + 1,
    });
    await dividendsApi.assert.statusIs(staleResponse, 409);
    await dividendsApi.assert.hasErrorCode(await body(staleResponse), "dividend_destructive_preview_stale");

    const confirmResponse = await dividendsApi.actions.confirmTradeDelete(String(trade.id), token);
    await dividendsApi.assert.statusIs(confirmResponse, 200);
    await dividendsApi.assert.mxAssertEqual(
      object((await body(confirmResponse)).preview, "confirmed preview").consumedResult,
      "confirmed",
      "confirmed preview.consumedResult",
    );

    const consumedResponse = await dividendsApi.actions.confirmTradeDelete(String(trade.id), token);
    await dividendsApi.assert.statusIs(consumedResponse, 409);
    await dividendsApi.assert.hasErrorCode(await body(consumedResponse), "dividend_destructive_preview_consumed");

    const ledgerResponse = await dividendsApi.actions.listDividendLedger({ accountId: "acc-1", limit: 50 });
    const ledgerEntries = await dividendsApi.arrange.dividendLedgerEntries(ledgerResponse);
    await dividendsApi.assert.mxAssertTruthy(
      !ledgerEntries.map((entry) => entry.id).includes(ledgerEntryId),
      "ledger omits deleted entry",
    );
    const reviewResponse = await dividendsApi.actions.listReview({ ticker: "7731", limit: 10 });
    await dividendsApi.assert.mxAssertTruthy(
      array((await body(reviewResponse)).reviewRows, "review rows").every((entry) => entry.id !== ledgerEntryId),
      "review rows omit deleted entry",
    );
  });

  test("[cutoff purge]: inclusive cutoff preview and confirm → later source and derived rows are removed while earlier trades survive", async ({
    dividendsApi,
    request,
    testUser,
  }) => {
    await dividendsApi.actions.seedDividendEvent(seededDividendEventPayload({
      ticker: "7740",
      tradeDate: "2026-01-10",
      exDividendDate: "2026-01-20",
      paymentDate: "2026-01-25",
      eligibleQuantity: 10,
    }));
    const laterSeed = await dividendsApi.actions.seedDividendEvent(seededDividendEventPayload({
      ticker: "7741",
      tradeDate: "2026-02-01",
      exDividendDate: "2026-02-10",
      paymentDate: "2026-02-20",
      eligibleQuantity: 10,
    }));
    const laterEventId = await dividendsApi.arrange.seededDividendEventId(await dividendsApi.arrange.seedBody(laterSeed));
    const posted = await dividendsApi.actions.createOrUpdatePosting(dividendPostingPayload({
      dividendEventId: laterEventId,
    }));
    await dividendsApi.assert.statusIs(posted, 200);
    const laterLedgerId = String((await dividendsApi.arrange.dividendLedgerEntry(posted)).id);

    const previewResponse = await dividendsApi.actions.previewAccountPurge(
      "acc-1",
      "2026-02-01",
      "Rebuild after broker correction",
    );
    await dividendsApi.assert.statusIs(previewResponse, 200);
    const previewBody = await body(previewResponse);
    const operation = object(previewBody.operation, "operation");
    await dividendsApi.assert.mxAssertEqual(operation.kind, "account_cutoff_purge", "operation.kind");
    await dividendsApi.assert.mxAssertEqual(operation.accountId, "acc-1", "operation.accountId");
    await dividendsApi.assert.mxAssertEqual(operation.cutoffDate, "2026-02-01", "operation.cutoffDate");
    await dividendsApi.assert.mxAssertGreaterThanOrEqual(
      Number(object(previewBody.affectedCounts, "affectedCounts").tradeEvents),
      1,
      "affectedCounts.tradeEvents",
    );

    const confirmResponse = await dividendsApi.actions.confirmAccountPurge("acc-1", confirmation(previewBody));
    await dividendsApi.assert.statusIs(confirmResponse, 200);

    const transactionsResponse = await request.get(new URL("/portfolio/transactions", TestEnv.apiBaseUrl).href, {
      headers: { cookie: testUser.sessionCookie ?? "" },
    });
    const transactionsBody = await transactionsResponse.json() as unknown;
    const transactions = Array.isArray(transactionsBody)
      ? array(transactionsBody, "transactions")
      : array(object(transactionsBody, "transactions body").transactions, "transactions");
    await dividendsApi.assert.mxAssertTruthy(
      transactions.some((entry) => entry.ticker === "7740"),
      "transactions retain 7740",
    );
    await dividendsApi.assert.mxAssertTruthy(
      !transactions.some((entry) => entry.ticker === "7741"),
      "transactions purge 7741",
    );

    const ledgerResponse = await dividendsApi.actions.listDividendLedger({ accountId: "acc-1", limit: 50 });
    await dividendsApi.assert.mxAssertTruthy(
      !(await dividendsApi.arrange.dividendLedgerEntries(ledgerResponse)).map((entry) => entry.id).includes(laterLedgerId),
      "ledger omits purged entry",
    );
  });

  test("[delegated dividend write]: read-only share then dividend:write grant → mutation is denied then allowed", async ({
    dividendsApi,
    request,
    sessionApi,
    sharesApi,
  }) => {
    const ownerSession = await sessionApi.actions.createOauthSessionForClaims({
      sub: "dividend-write-owner",
      email: "dividend-write-owner@example.com",
      name: "Dividend Write Owner",
      role: "member",
    });
    const ownerCookie = await sessionApi.arrange.sessionCookieHeader(ownerSession);
    const granteeSession = await sessionApi.actions.createOauthSessionForClaims({
      sub: "dividend-write-grantee",
      email: "dividend-write-grantee@example.com",
      name: "Dividend Write Grantee",
      role: "viewer",
    });
    const granteeCookie = await sessionApi.arrange.sessionCookieHeader(granteeSession);
    const granteeEmail = "dividend-write-grantee@example.com";

    const ownerUserId = String((await body(ownerSession)).userId);

    const createShareBody = await sharesApi.arrange.createBody(
      await sharesApi.actions.createShareForCookie(ownerCookie, granteeEmail),
    );
    const share = sharesApi.arrange.asResolvedBody(createShareBody);
    const shareId = String(share.share.id);

    const seedResponse = await request.post(new URL("/__e2e/seed-dividend-event", TestEnv.apiBaseUrl).href, {
      headers: { cookie: ownerCookie },
      data: seededDividendEventPayload({
        ticker: "7750",
        exDividendDate: "2026-06-01",
        paymentDate: "2026-06-20",
        cashDividendPerShare: 0.2,
      }),
    });
    await dividendsApi.assert.statusIs(seedResponse, 200);
    const eventId = String(object((await body(seedResponse)).dividendEvent, "dividend event").id);
    const mutationHeaders = {
      cookie: granteeCookie,
      "x-context-user-id": ownerUserId,
      "idempotency-key": "delegated-dividend-write-contract",
    };

    const deniedResponse = await request.post(new URL("/portfolio/dividends/postings", TestEnv.apiBaseUrl).href, {
      headers: mutationHeaders,
      data: dividendPostingPayload({ dividendEventId: eventId }),
    });
    await dividendsApi.assert.statusIs(deniedResponse, 403);
    await dividendsApi.assert.hasErrorCode(await body(deniedResponse), "shared_capability_required");

    const grantResponse = await request.patch(new URL(`/shares/${shareId}/capabilities`, TestEnv.apiBaseUrl).href, {
      headers: { cookie: ownerCookie },
      data: { capabilities: ["portfolio:mcp_read", "dividend:write"] },
    });
    await sharesApi.assert.statusIs(grantResponse, 200);

    const allowedResponse = await request.post(new URL("/portfolio/dividends/postings", TestEnv.apiBaseUrl).href, {
      headers: { ...mutationHeaders, "idempotency-key": "delegated-dividend-write-contract-allowed" },
      data: dividendPostingPayload({ dividendEventId: eventId }),
    });
    await dividendsApi.assert.statusIs(allowedResponse, 200);
  });
});
