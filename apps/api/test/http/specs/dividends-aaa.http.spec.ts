import { TestEnv } from "@vakwen/config/test";
import {
  dividendPostingPayload,
  dividendPostingUpdatePayload,
  dividendReconciliationPayload,
  seededDividendEventPayload,
} from "../../helpers/fixtures.js";
import { test } from "../fixtures.js";

test.describe("dividends", () => {
  test("GET extended endpoints: date filters include null payment dates and nested ledger rows", async ({
    dividendsApi,
  }) => {
    await dividendsApi.actions.seedDividendEvent(
      seededDividendEventPayload({
        ticker: "2330",
        eventType: "CASH",
        exDividendDate: "2026-04-01",
        paymentDate: "2026-04-20",
        cashDividendPerShare: 0.12,
      }),
    );
    const tbdSeed = await dividendsApi.actions.seedDividendEvent(
      seededDividendEventPayload({
        ticker: "0050",
        eventType: "CASH",
        exDividendDate: "2026-04-02",
        paymentDate: null,
        cashDividendPerShare: 0.5,
      }),
    );
    await dividendsApi.assert.statusIs(tbdSeed, 200);
    const maySeed = await dividendsApi.actions.seedDividendEvent(
      seededDividendEventPayload({
        ticker: "2330",
        eventType: "CASH",
        exDividendDate: "2026-05-01",
        paymentDate: "2026-05-20",
        cashDividendPerShare: 0.08,
      }),
    );
    await dividendsApi.assert.statusIs(maySeed, 200);

    const aprilSeedBody = await dividendsApi.arrange.seedBody(
      await dividendsApi.actions.seedDividendEvent(
        seededDividendEventPayload({
          ticker: "2330",
          eventType: "CASH",
          exDividendDate: "2026-04-03",
          paymentDate: "2026-04-24",
          cashDividendPerShare: 0.2,
        }),
      ),
    );
    const aprilEventId = await dividendsApi.arrange.seededDividendEventId(aprilSeedBody);
    const postResponse = await dividendsApi.actions.createOrUpdatePosting(
      dividendPostingPayload({
        dividendEventId: aprilEventId,
        receivedCashAmount: 188,
        deductions: [
          {
            deductionType: "NHI_SUPPLEMENTAL_PREMIUM",
            amount: 12,
            currencyCode: "TWD",
            withheldAtSource: true,
            source: "dividend_posting",
          },
        ],
        sourceLines: [
          {
            sourceBucket: "DIVIDEND_INCOME",
            amount: 200,
            currencyCode: "TWD",
            source: "issuer_statement",
          },
        ],
      }),
    );
    await dividendsApi.assert.statusIs(postResponse, 200);

    const eventsResponse = await dividendsApi.actions.listDividendEvents({
      fromPaymentDate: "2026-04-01",
      toPaymentDate: "2026-04-30",
      limit: 10,
    });
    await dividendsApi.assert.statusIs(eventsResponse, 200);
    const aprilEvents = await dividendsApi.arrange.dividendEvents(eventsResponse);
    await dividendsApi.assert.arrayLengthAtLeast(aprilEvents, 3, "april dividend events");
    await dividendsApi.assert.fieldEquals(await dividendsApi.arrange.firstEntry(aprilEvents), "paymentDate", null, "first april event");

    const limitedResponse = await dividendsApi.actions.listDividendEvents({
      fromPaymentDate: "2026-04-01",
      toPaymentDate: "2026-04-30",
      limit: 1,
    });
    const limitedEvents = await dividendsApi.arrange.dividendEvents(limitedResponse);
    await dividendsApi.assert.fieldEquals({ count: limitedEvents.length }, "count", 1, "limited events");

    const ledgerResponse = await dividendsApi.actions.listDividendLedger({
      fromPaymentDate: "2026-04-01",
      toPaymentDate: "2026-04-30",
      accountId: "acc-1",
      limit: 10,
    });
    await dividendsApi.assert.statusIs(ledgerResponse, 200);
    const ledgerEntries = await dividendsApi.arrange.dividendLedgerEntries(ledgerResponse);
    await dividendsApi.assert.arrayLengthAtLeast(ledgerEntries, 1, "april ledger entries");
    const firstLedgerEntry = await dividendsApi.arrange.firstEntry(ledgerEntries);
    await dividendsApi.assert.nestedCollectionsPresent(firstLedgerEntry);
  });

  test("POST /portfolio/dividends/postings: cash happy path persists nested collections", async ({
    dividendsApi,
  }) => {
    const seedResponse = await dividendsApi.actions.seedDividendEvent(
      seededDividendEventPayload({
        ticker: "2330",
        eventType: "CASH",
        exDividendDate: "2026-04-10",
        paymentDate: "2026-04-25",
        cashDividendPerShare: 0.12,
      }),
    );
    await dividendsApi.assert.statusIs(seedResponse, 200);
    const seedBody = await dividendsApi.arrange.seedBody(seedResponse);
    const dividendEventId = await dividendsApi.arrange.seededDividendEventId(seedBody);

    const postResponse = await dividendsApi.actions.createOrUpdatePosting(
      dividendPostingPayload({
        dividendEventId,
      }),
    );
    await dividendsApi.assert.statusIs(postResponse, 200);
    const ledgerEntry = await dividendsApi.arrange.dividendLedgerEntry(postResponse);
    await dividendsApi.assert.fieldEquals(ledgerEntry, "sourceCompositionStatus", "provided");
    await dividendsApi.assert.fieldEquals(ledgerEntry, "version", 1);

    const ledgerResponse = await dividendsApi.actions.listDividendLedger({
      fromPaymentDate: "2026-04-01",
      toPaymentDate: "2026-04-30",
      accountId: "acc-1",
      limit: 10,
    });
    const ledgerEntries = await dividendsApi.arrange.dividendLedgerEntries(ledgerResponse);
    const persistedEntry = ledgerEntries.find((entry) => entry.id === ledgerEntry.id) ?? await dividendsApi.arrange.firstEntry(ledgerEntries);
    await dividendsApi.assert.nestedCollectionsPresent(persistedEntry);
    await dividendsApi.assert.sourceLinesReconcileWithinTolerance(persistedEntry);
  });

  test("POST /portfolio/dividends/postings: ETF posting accepts unknown disclosure with no source lines", async ({
    dividendsApi,
  }) => {
    const seedResponse = await dividendsApi.actions.seedDividendEvent(
      seededDividendEventPayload({
        ticker: "0050",
        eventType: "CASH",
        exDividendDate: "2026-04-12",
        paymentDate: "2026-04-26",
        cashDividendPerShare: 0.6,
      }),
    );
    const dividendEventId = await dividendsApi.arrange.seededDividendEventId(await dividendsApi.arrange.seedBody(seedResponse));

    const postResponse = await dividendsApi.actions.createOrUpdatePosting(
      dividendPostingPayload({
        dividendEventId,
        receivedCashAmount: 600,
        deductions: [],
        sourceCompositionStatus: "unknown_pending_disclosure",
        sourceLines: [],
      }),
    );
    await dividendsApi.assert.statusIs(postResponse, 200);
    const ledgerEntry = await dividendsApi.arrange.dividendLedgerEntry(postResponse);
    await dividendsApi.assert.fieldEquals(ledgerEntry, "sourceCompositionStatus", "unknown_pending_disclosure");
  });

  test("POST update path: stock edit updates quantity and stale cash version conflicts", async ({
    dividendsApi,
  }) => {
    const stockSeed = await dividendsApi.actions.seedDividendEvent(
      seededDividendEventPayload({
        ticker: "2330",
        eventType: "STOCK",
        exDividendDate: "2026-04-15",
        paymentDate: "2026-04-28",
        cashDividendPerShare: 0,
        stockDividendPerShare: 0.1,
      }),
    );
    const stockEventId = await dividendsApi.arrange.seededDividendEventId(await dividendsApi.arrange.seedBody(stockSeed));
    const stockPost = await dividendsApi.actions.createOrUpdatePosting(
      dividendPostingPayload({
        dividendEventId: stockEventId,
        receivedCashAmount: 0,
        receivedStockQuantity: 100,
        deductions: [],
        sourceCompositionStatus: "unknown_pending_disclosure",
        sourceLines: [],
      }),
    );
    const stockLedgerEntry = await dividendsApi.arrange.dividendLedgerEntry(stockPost);

    const stockEditResponse = await dividendsApi.actions.createOrUpdatePosting(
      dividendPostingUpdatePayload({
        dividendEventId: stockEventId,
        dividendLedgerEntryId: stockLedgerEntry.id,
        expectedVersion: stockLedgerEntry.version,
        receivedCashAmount: 0,
        receivedStockQuantity: 120,
        deductions: [],
        sourceCompositionStatus: "unknown_pending_disclosure",
        sourceLines: [],
      }),
    );
    await dividendsApi.assert.statusIs(stockEditResponse, 200);
    const updatedStockLedgerEntry = await dividendsApi.arrange.dividendLedgerEntry(stockEditResponse);
    await dividendsApi.assert.fieldEquals(updatedStockLedgerEntry, "receivedStockQuantity", 120);
    await dividendsApi.assert.versionIncremented(stockLedgerEntry, updatedStockLedgerEntry);

    const cashSeed = await dividendsApi.actions.seedDividendEvent(
      seededDividendEventPayload({
        ticker: "2330",
        eventType: "CASH",
        exDividendDate: "2026-04-16",
        paymentDate: "2026-04-29",
        cashDividendPerShare: 0.12,
      }),
    );
    const cashEventId = await dividendsApi.arrange.seededDividendEventId(await dividendsApi.arrange.seedBody(cashSeed));
    const cashPost = await dividendsApi.actions.createOrUpdatePosting(dividendPostingPayload({ dividendEventId: cashEventId }));
    const cashLedgerEntry = await dividendsApi.arrange.dividendLedgerEntry(cashPost);

    const updatedResponse = await dividendsApi.actions.createOrUpdatePosting(
      dividendPostingUpdatePayload({
        dividendEventId: cashEventId,
        dividendLedgerEntryId: cashLedgerEntry.id,
        expectedVersion: cashLedgerEntry.version,
        receivedCashAmount: 96,
      }),
    );
    await dividendsApi.assert.statusIs(updatedResponse, 200);
    const updatedLedgerEntry = await dividendsApi.arrange.dividendLedgerEntry(updatedResponse);
    await dividendsApi.assert.versionIncremented(cashLedgerEntry, updatedLedgerEntry);

    const staleResponse = await dividendsApi.actions.createOrUpdatePosting(
      dividendPostingUpdatePayload({
        dividendEventId: cashEventId,
        dividendLedgerEntryId: cashLedgerEntry.id,
        expectedVersion: cashLedgerEntry.version,
        receivedCashAmount: 94,
      }),
    );
    await dividendsApi.assert.statusIs(staleResponse, 409);
    await dividendsApi.assert.hasErrorCode(await dividendsApi.arrange.postingBody(staleResponse), "dividend_version_conflict");
  });

  test("PATCH reconciliation: validates note requirements and authorization", async ({
    dividendsApi,
    request,
    sessionApi,
    testUser,
  }) => {
    const seedResponse = await dividendsApi.actions.seedDividendEvent(
      seededDividendEventPayload({
        ticker: "2330",
        eventType: "CASH",
        exDividendDate: "2026-04-18",
        paymentDate: "2026-04-30",
        cashDividendPerShare: 0.12,
      }),
    );
    const dividendEventId = await dividendsApi.arrange.seededDividendEventId(await dividendsApi.arrange.seedBody(seedResponse));
    const postResponse = await dividendsApi.actions.createOrUpdatePosting(dividendPostingPayload({ dividendEventId }));
    const ledgerEntry = await dividendsApi.arrange.dividendLedgerEntry(postResponse);

    const explainedWithoutNote = await dividendsApi.actions.patchReconciliation(
      String(ledgerEntry.id),
      dividendReconciliationPayload({ status: "explained" }),
    );
    await dividendsApi.assert.statusIs(explainedWithoutNote, 400);
    await dividendsApi.assert.hasErrorCode(await dividendsApi.arrange.postingBody(explainedWithoutNote), "reconciliation_note_required");

    const explainedWithNote = await dividendsApi.actions.patchReconciliation(
      String(ledgerEntry.id),
      dividendReconciliationPayload({ status: "explained", note: "Issuer rounded fractional entitlement." }),
    );
    await dividendsApi.assert.statusIs(explainedWithNote, 200);
    const explainedBody = await dividendsApi.arrange.postingBody(explainedWithNote);
    await dividendsApi.assert.fieldEquals(explainedBody.ledgerEntry as Record<string, unknown>, "reconciliationStatus", "explained", "reconciled entry");

    const unauthenticatedResponse = await request.patch(
      new URL(`/portfolio/dividends/postings/${String(ledgerEntry.id)}/reconciliation`, TestEnv.apiBaseUrl).href,
      {
        headers: { cookie: "" },
        data: { status: "matched" },
      },
    );
    await dividendsApi.assert.statusIs(unauthenticatedResponse, 401);

    const altSession = await sessionApi.actions.createOauthSessionForClaims({
      sub: "alt-dividends-user",
      email: "alt-dividends@e2e.local",
      name: "Alt Dividends User",
    });
    const altCookie = await sessionApi.arrange.sessionCookieHeader(altSession);
    const forbiddenResponse = await request.patch(
      new URL(`/portfolio/dividends/postings/${String(ledgerEntry.id)}/reconciliation`, TestEnv.apiBaseUrl).href,
      {
        headers: { cookie: altCookie },
        data: { status: "matched" },
      },
    );
    await dividendsApi.assert.statusIs(forbiddenResponse, 403);
    await dividendsApi.assert.hasErrorCode(await dividendsApi.arrange.postingBody(forbiddenResponse), "forbidden");

    const matchedResponse = await request.patch(
      new URL(`/portfolio/dividends/postings/${String(ledgerEntry.id)}/reconciliation`, TestEnv.apiBaseUrl).href,
      {
        headers: { cookie: testUser.sessionCookie ?? "" },
        data: { status: "matched" },
      },
    );
    await dividendsApi.assert.statusIs(matchedResponse, 200);
  });
});
