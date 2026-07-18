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

  test("POST stock receipt without a resolved ratio: review preserves received shares while calculation stays unresolved", async ({
    dividendsApi,
  }) => {
    const seedResponse = await dividendsApi.actions.seedDividendEvent(
      seededDividendEventPayload({
        ticker: "2886",
        eventType: "STOCK",
        exDividendDate: "2026-07-15",
        paymentDate: "2026-08-20",
        cashDividendPerShare: 0,
        stockDividendPerShare: 0.1,
        stockDistributionRatio: null,
        stockDistributionRatioState: "unresolved",
        stockParValueAmount: null,
        stockParValueCurrency: null,
      }),
    );
    await dividendsApi.assert.statusIs(seedResponse, 200);
    const dividendEventId = await dividendsApi.arrange.seededDividendEventId(await dividendsApi.arrange.seedBody(seedResponse));

    const postResponse = await dividendsApi.actions.createOrUpdatePosting(
      dividendPostingPayload({
        ticker: "2886",
        dividendEventId,
        receivedCashAmount: 0,
        receivedStockQuantity: 150,
        deductions: [],
        sourceCompositionStatus: "unknown_pending_disclosure",
        sourceLines: [],
      }),
    );
    await dividendsApi.assert.statusIs(postResponse, 200);
    const postedLedgerEntry = await dividendsApi.arrange.dividendLedgerEntry(postResponse);
    await dividendsApi.assert.fieldEquals(postedLedgerEntry, "receivedStockQuantity", 150);

    const reviewResponse = await dividendsApi.actions.listReview({ ticker: "2886", limit: 10 });
    await dividendsApi.assert.statusIs(reviewResponse, 200);
    const reviewBody = await reviewResponse.json() as { reviewRows?: Array<Record<string, unknown>> };
    const reviewRows = reviewBody.reviewRows ?? [];
    const receiptRow = reviewRows.find((entry) => entry.id === postedLedgerEntry.id);
    await dividendsApi.assert.mxAssertDefined(receiptRow, "reviewRows receipt row");
    await dividendsApi.assert.fieldEquals(receiptRow!, "ticker", "2886", "reviewRows receipt row");
    await dividendsApi.assert.fieldEquals(receiptRow!, "receivedStockQuantity", 150, "reviewRows receipt row");
    await dividendsApi.assert.fieldEquals(
      receiptRow!,
      "stockDistributionRatioState",
      "unresolved",
      "reviewRows receipt row",
    );
    await dividendsApi.assert.fieldEquals(
      receiptRow!,
      "expectedStockCalcState",
      "needs_action",
      "reviewRows receipt row",
    );
  });

  test("dividend calculation contracts: settings, preview/confirm/reset, inline confirm+post, amend, and filtered hero stay coherent", async ({
    dividendsApi,
    request,
    testUser,
  }) => {
    const seedResponse = await dividendsApi.actions.seedDividendEvent(
      seededDividendEventPayload({
        ticker: "2330",
        eventType: "STOCK",
        exDividendDate: "2026-07-15",
        paymentDate: "2026-08-20",
        cashDividendPerShare: 0,
        stockDividendPerShare: 1,
        stockDistributionAmountRaw: 1,
        stockDistributionRatio: null,
        stockDistributionRatioState: "unresolved",
        stockProviderValueUnit: "TWD_PER_SHARE",
        stockProviderSource: "finmind",
        stockProviderDataset: "TaiwanStockDividend",
      }),
    );
    await dividendsApi.assert.statusIs(seedResponse, 200);
    const dividendEventId = await dividendsApi.arrange.seededDividendEventId(await dividendsApi.arrange.seedBody(seedResponse));
    const authHeaders = { cookie: testUser.sessionCookie ?? "" };

    const initialSettingsResponse = await request.get(
      new URL("/accounts/acc-1/dividend-settings/TW", TestEnv.apiBaseUrl).href,
      { headers: authHeaders },
    );
    await dividendsApi.assert.statusIs(initialSettingsResponse, 200);
    const initialSettings = await initialSettingsResponse.json() as {
      version: number;
      fallbackParValue: string | null;
    };

    const patchSettingsResponse = await request.patch(
      new URL("/accounts/acc-1/dividend-settings/TW", TestEnv.apiBaseUrl).href,
      {
        headers: authHeaders,
        data: {
          expectedVersion: initialSettings.version,
          fallbackParValue: "10",
        },
      },
    );
    await dividendsApi.assert.statusIs(patchSettingsResponse, 200);
    const patchedSettings = await patchSettingsResponse.json() as {
      version: number;
      fallbackParValue: string | null;
    };
    await dividendsApi.assert.fieldEquals(patchedSettings, "fallbackParValue", "10", "patched settings");

    const previewResponse = await request.post(
      new URL("/portfolio/dividends/calculations/preview", TestEnv.apiBaseUrl).href,
      {
        headers: authHeaders,
        data: {
          accountId: "acc-1",
          dividendEventId,
          method: "derived_from_par_value",
          selectedParValue: "10",
        },
      },
    );
    await dividendsApi.assert.statusIs(previewResponse, 200);
    const previewBody = await previewResponse.json() as {
      ratio: string;
      expectedWholeShares: number;
      providerUnit: string | null;
      providerSource: string | null;
      providerDataset: string | null;
    };
    await dividendsApi.assert.fieldEquals(previewBody, "ratio", "0.1", "preview body");
    await dividendsApi.assert.fieldEquals(previewBody, "expectedWholeShares", 100, "preview body");
    await dividendsApi.assert.fieldEquals(previewBody, "providerUnit", "TWD_PER_SHARE", "preview body");

    const confirmResponse = await request.post(
      new URL("/portfolio/dividends/calculations/confirm", TestEnv.apiBaseUrl).href,
      {
        headers: {
          ...authHeaders,
          "idempotency-key": "http-dividend-calculation-confirm",
        },
        data: {
          accountId: "acc-1",
          dividendEventId,
          method: "derived_from_par_value",
          selectedParValue: "10",
          expectedActiveCalculationId: null,
        },
      },
    );
    await dividendsApi.assert.statusIs(confirmResponse, 200);
    const confirmedCalculation = await confirmResponse.json() as {
      id: string;
      calculationVersion: number;
      status: string;
      method: string;
      expectedWholeShares: number;
    };
    await dividendsApi.assert.fieldEquals(confirmedCalculation, "status", "confirmed", "confirmed calculation");
    await dividendsApi.assert.fieldEquals(confirmedCalculation, "method", "derived_from_par_value", "confirmed calculation");
    await dividendsApi.assert.fieldEquals(confirmedCalculation, "expectedWholeShares", 100, "confirmed calculation");

    const resetResponse = await request.post(
      new URL("/portfolio/dividends/calculations/reset", TestEnv.apiBaseUrl).href,
      {
        headers: {
          ...authHeaders,
          "idempotency-key": "http-dividend-calculation-reset",
        },
        data: {
          accountId: "acc-1",
          dividendEventId,
          expectedActiveCalculationId: confirmedCalculation.id,
          expectedCalculationVersion: confirmedCalculation.calculationVersion,
        },
      },
    );
    await dividendsApi.assert.statusIs(resetResponse, 200);
    await dividendsApi.assert.fieldEquals(await resetResponse.json() as Record<string, unknown>, "status", "ok", "reset response");

    const inlinePostResponse = await request.post(
      new URL("/portfolio/dividends/postings", TestEnv.apiBaseUrl).href,
      {
        headers: {
          ...authHeaders,
          "idempotency-key": "http-inline-dividend-calculation-posting",
        },
        data: {
          ...dividendPostingPayload({
            ticker: "2330",
            dividendEventId,
            receivedCashAmount: 0,
            receivedStockQuantity: 150,
            deductions: [],
            sourceCompositionStatus: "unknown_pending_disclosure",
            sourceLines: [],
          }),
          calculation: {
            method: "derived_from_par_value",
            selectedParValue: "10",
          },
        },
      },
    );
    await dividendsApi.assert.statusIs(inlinePostResponse, 200);
    const inlinePostBody = await inlinePostResponse.json() as {
      dividendLedgerEntry: { id: string };
    };

    const detailResponse = await request.get(
      new URL(`/portfolio/dividends/postings/${inlinePostBody.dividendLedgerEntry.id}`, TestEnv.apiBaseUrl).href,
      { headers: authHeaders },
    );
    await dividendsApi.assert.statusIs(detailResponse, 200);
    const detailBody = await detailResponse.json() as {
      expectedStockQuantity: number | null;
      receivedStockQuantity: number;
      stockVarianceQuantity: number | null;
      activeCalculation: {
        id: string;
        calculationVersion: number;
        status: string;
        method: string;
        expectedWholeShares: number;
      };
      calculationHistory?: Array<{ id: string; status: string }>;
    };
    await dividendsApi.assert.fieldEquals(detailBody, "expectedStockQuantity", 100, "detail body");
    await dividendsApi.assert.fieldEquals(detailBody, "receivedStockQuantity", 150, "detail body");
    await dividendsApi.assert.fieldEquals(detailBody, "stockVarianceQuantity", 50, "detail body");
    await dividendsApi.assert.fieldEquals(detailBody.activeCalculation, "status", "confirmed", "detail activeCalculation");

    const amendResponse = await request.post(
      new URL("/portfolio/dividends/calculations/amend", TestEnv.apiBaseUrl).href,
      {
        headers: {
          ...authHeaders,
          "idempotency-key": "http-inline-dividend-calculation-amend",
        },
        data: {
          accountId: "acc-1",
          dividendEventId,
          dividendLedgerEntryId: inlinePostBody.dividendLedgerEntry.id,
          method: "custom_ratio",
          customRatio: "0.2",
          expectedActiveCalculationId: detailBody.activeCalculation.id,
          expectedCalculationVersion: detailBody.activeCalculation.calculationVersion,
        },
      },
    );
    await dividendsApi.assert.statusIs(amendResponse, 200);
    const amendedCalculation = await amendResponse.json() as {
      status: string;
      method: string;
      expectedWholeShares: number;
      dividendLedgerEntryId: string | null;
    };
    await dividendsApi.assert.fieldEquals(amendedCalculation, "status", "amended", "amended calculation");
    await dividendsApi.assert.fieldEquals(amendedCalculation, "method", "custom_ratio", "amended calculation");
    await dividendsApi.assert.fieldEquals(amendedCalculation, "expectedWholeShares", 200, "amended calculation");

    const reviewPrimaryResponse = await request.get(
      new URL("/portfolio/dividends/review/primary?cashStatus=open&stockStatus=variance&limit=10", TestEnv.apiBaseUrl).href,
      { headers: authHeaders },
    );
    await dividendsApi.assert.statusIs(reviewPrimaryResponse, 200);
    const reviewPrimaryBody = await reviewPrimaryResponse.json() as {
      reviewRows?: Array<Record<string, unknown>>;
    };
    const amendedRow = (reviewPrimaryBody.reviewRows ?? []).find((row) => row.id === inlinePostBody.dividendLedgerEntry.id);
    await dividendsApi.assert.mxAssertDefined(amendedRow, "filtered review row");
    await dividendsApi.assert.fieldEquals(amendedRow!, "stockReconciliationStatus", "variance", "filtered review row");
    await dividendsApi.assert.fieldEquals(amendedRow!, "expectedStockQuantity", 200, "filtered review row");
    await dividendsApi.assert.fieldEquals(amendedRow!, "receivedStockQuantity", 150, "filtered review row");

    const enrichmentResponse = await request.get(
      new URL("/portfolio/dividends/review/enrichment?cashStatus=open&stockStatus=variance", TestEnv.apiBaseUrl).href,
      { headers: authHeaders },
    );
    await dividendsApi.assert.statusIs(enrichmentResponse, 200);
    const enrichmentBody = await enrichmentResponse.json() as {
      hero?: {
        stockAttentionCount?: number;
        expectedStockTickers?: Array<Record<string, unknown>>;
        receivedStockTickers?: Array<Record<string, unknown>>;
      };
    };
    await dividendsApi.assert.mxAssertDefined(enrichmentBody.hero, "review enrichment hero");
    await dividendsApi.assert.fieldEquals(enrichmentBody.hero!, "stockAttentionCount", 1, "review enrichment hero");
    await dividendsApi.assert.mxAssertTruthy(
      (enrichmentBody.hero?.expectedStockTickers ?? []).some((entry) => entry.ticker === "2330" && entry.expectedWholeShares === 200),
      "expected stock hero includes amended 2330 row",
    );
    await dividendsApi.assert.mxAssertTruthy(
      (enrichmentBody.hero?.receivedStockTickers ?? []).some((entry) => entry.ticker === "2330" && entry.receivedShares === 150),
      "received stock hero includes posted 2330 row",
    );
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
