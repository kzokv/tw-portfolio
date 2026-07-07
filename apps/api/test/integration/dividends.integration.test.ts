import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { createDividendEvent, type CreateDividendEventInput } from "../../src/services/dividends.js";
import type { DividendLedgerEntry } from "../../src/types/store.js";
import {
  dividendEventPayload,
  dividendPostingPayload,
  dividendPostingUpdatePayload,
  dividendReconciliationPayload,
  transactionPayload,
} from "../helpers/fixtures.js";

let app: Awaited<ReturnType<typeof buildApp>>;

async function seedInstrument() {
  const store = await app.persistence.loadStore("user-1");
  const instrument = store.instruments.find((entry) => entry.ticker === "2330" && entry.marketCode === "TW");
  if (!instrument) throw new Error("instrument_not_found:2330:TW");
  instrument.name = "TSMC";
}

async function seedBuy(quantity: number = 10) {
  await app.inject({
    method: "POST",
    url: "/portfolio/transactions",
    headers: { "idempotency-key": `buy-${quantity}-${Math.random()}` },
    payload: transactionPayload({
      quantity,
      unitPrice: 100,
      tradeDate: "2026-01-15",
      commissionAmount: 0,
      taxAmount: 0,
    }),
  });
}

async function seedBuyAtDate(tradeDate: string, quantity: number = 10) {
  await app.inject({
    method: "POST",
    url: "/portfolio/transactions",
    headers: { "idempotency-key": `buy-${quantity}-${tradeDate}-${Math.random()}` },
    payload: transactionPayload({
      quantity,
      unitPrice: 100,
      tradeDate,
      commissionAmount: 0,
      taxAmount: 0,
    }),
  });
}

async function seedDividendEvent(
  overrides: Record<string, unknown> = {},
): Promise<ReturnType<typeof createDividendEvent>> {
  const store = await app.persistence.loadStore("user-1");
  const dividendEvent = createDividendEvent(store, {
    id: randomUUID(),
    ...dividendEventPayload(overrides),
  } as CreateDividendEventInput);
  await app.persistence.saveStore(store);
  return dividendEvent;
}

describe("dividends", () => {
  beforeEach(async () => {
    app = await buildApp({ persistenceBackend: "memory" });
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it("declares a dividend event and posts cash receipt with linked deductions and source lines", async () => {
    await seedBuy();
    const dividendEvent = await seedDividendEvent({
      ticker: "2330",
      eventType: "CASH",
      exDividendDate: "2026-02-01",
      paymentDate: "2026-02-20",
      cashDividendPerShare: 12,
    });

    const postingResponse = await app.inject({
      method: "POST",
      url: "/portfolio/dividends/postings",
      headers: { "idempotency-key": "k-dividend-posting" },
      payload: dividendPostingPayload({
        dividendEventId: dividendEvent.id,
        receivedCashAmount: 108,
      }),
    });

    expect(postingResponse.statusCode).toBe(200);
    const posting = postingResponse.json();
    expect(posting.comparison).toEqual({
      expectedCashAmount: 120,
      actualCashEconomicAmount: 120,
      cashVarianceAmount: 0,
      expectedStockQuantity: 0,
      actualStockQuantity: 0,
      stockVarianceQuantity: 0,
    });
    expect(posting.dividendSourceLines).toEqual([
      expect.objectContaining({
        dividendLedgerEntryId: posting.dividendLedgerEntry.id,
        sourceBucket: "DIVIDEND_INCOME",
        amount: 120,
      }),
    ]);

    const ledgerResponse = await app.inject({ method: "GET", url: "/portfolio/dividends/ledger" });
    expect(ledgerResponse.statusCode).toBe(200);
    expect(ledgerResponse.json()).toEqual(
      expect.objectContaining({
        ledgerEntries: [
          expect.objectContaining({
            accountId: "acc-1",
            dividendEventId: dividendEvent.id,
            eligibleQuantity: 10,
            ticker: "2330",
            expectedCashAmount: 120,
            receivedCashAmount: 108,
            postingStatus: "posted",
            reconciliationStatus: "open",
            sourceCompositionStatus: "provided",
            version: 1,
            deductions: [
              expect.objectContaining({
                deductionType: "NHI_SUPPLEMENTAL_PREMIUM",
                amount: 12,
              }),
            ],
            sourceLines: [
              expect.objectContaining({
                sourceBucket: "DIVIDEND_INCOME",
                amount: 120,
              }),
            ],
          }),
        ],
      }),
    );

    const store = await app.persistence.loadStore("user-1");
    expect(store.accounting.facts.dividendDeductionEntries).toEqual([
      expect.objectContaining({
        dividendLedgerEntryId: posting.dividendLedgerEntry.id,
        deductionType: "NHI_SUPPLEMENTAL_PREMIUM",
        amount: 12,
        currencyCode: "TWD",
      }),
    ]);
    expect(store.accounting.facts.dividendSourceLines).toEqual([
      expect.objectContaining({
        dividendLedgerEntryId: posting.dividendLedgerEntry.id,
        sourceBucket: "DIVIDEND_INCOME",
        amount: 120,
      }),
    ]);
    expect(store.accounting.facts.cashLedgerEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relatedDividendLedgerEntryId: posting.dividendLedgerEntry.id,
          entryType: "DIVIDEND_RECEIPT",
          amount: 108,
        }),
        expect.objectContaining({
          relatedDividendLedgerEntryId: posting.dividendLedgerEntry.id,
          entryType: "DIVIDEND_DEDUCTION",
          amount: -12,
        }),
      ]),
    );
  });

  it("returns account-scoped dividend rows and includes payment-date TBD events", async () => {
    await seedInstrument();
    await seedBuy();
    await seedDividendEvent({
      ticker: "2330",
      eventType: "CASH",
      exDividendDate: "2026-02-01",
      paymentDate: "2026-02-20",
      cashDividendPerShare: 12,
    });
    await seedDividendEvent({
      ticker: "2330",
      eventType: "CASH",
      exDividendDate: "2026-02-05",
      paymentDate: null,
      cashDividendPerShare: 8,
    });

    const response = await app.inject({
      method: "GET",
      url: "/dividend-events?fromPaymentDate=2026-02-01&toPaymentDate=2026-02-28&limit=20",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      dividendEvents: expect.arrayContaining([
        expect.objectContaining({
          accountId: "acc-1",
          ticker: "2330",
          tickerName: "TSMC",
          marketCode: "TW",
          paymentDate: "2026-02-20",
          eligibleQuantity: 10,
          expectedCashAmount: 120,
          hasPostedLedgerEntry: false,
        }),
        expect.objectContaining({
          accountId: "acc-1",
          ticker: "2330",
          tickerName: "TSMC",
          marketCode: "TW",
          paymentDate: null,
          eligibleQuantity: 10,
          expectedCashAmount: 80,
          hasPostedLedgerEntry: false,
        }),
      ]),
    });
  });

  it("returns the combined calendar snapshot with display-name enrichment", async () => {
    await seedInstrument();
    await seedBuy();
    const dividendEvent = await seedDividendEvent({
      ticker: "2330",
      eventType: "CASH",
      exDividendDate: "2026-02-01",
      paymentDate: "2026-02-20",
      cashDividendPerShare: 12,
    });

    const postingResponse = await app.inject({
      method: "POST",
      url: "/portfolio/dividends/postings",
      headers: { "idempotency-key": "calendar-snapshot-posting" },
      payload: dividendPostingPayload({
        dividendEventId: dividendEvent.id,
        receivedCashAmount: 108,
      }),
    });
    expect(postingResponse.statusCode).toBe(200);

    const response = await app.inject({
      method: "GET",
      url: "/portfolio/dividends/calendar?fromPaymentDate=2026-02-01&toPaymentDate=2026-02-28&limit=20",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      events: Array<Record<string, unknown>>;
      ledgerEntries: Array<Record<string, unknown>>;
    };
    expect(body.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        ticker: "2330",
        tickerName: "TSMC",
        marketCode: "TW",
        paymentDate: "2026-02-20",
        hasPostedLedgerEntry: true,
      }),
    ]));
    expect(body.ledgerEntries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        ticker: "2330",
        tickerName: "TSMC",
        marketCode: "TW",
        paymentDate: "2026-02-20",
        reconciliationStatus: "open",
      }),
    ]));
    expect(body.events[0]).toHaveProperty("dividendLedgerEntryId");
    expect(body.ledgerEntries[0]).toHaveProperty("id");
  });

  it("filters the dividend ledger route by marketCode", async () => {
    const accountResponse = await app.inject({
      method: "POST",
      url: "/accounts",
      payload: {
        name: "AU Account",
        defaultCurrency: "AUD",
        accountType: "broker",
      },
    });
    expect(accountResponse.statusCode).toBe(200);
    const auAccount = accountResponse.json() as { id: string };
    const store = await app.persistence.loadStore("user-1");
    const twEvent = createDividendEvent(store, {
      id: randomUUID(),
      ...dividendEventPayload({
        ticker: "DUPE",
        marketCode: "TW",
        cashDividendCurrency: "TWD",
        paymentDate: "2026-02-20",
      }),
    } as CreateDividendEventInput);
    const auEvent = createDividendEvent(store, {
      id: randomUUID(),
      ...dividendEventPayload({
        ticker: "DUPE",
        marketCode: "AU",
        cashDividendCurrency: "AUD",
        paymentDate: "2026-02-21",
      }),
    } as CreateDividendEventInput);
    store.accounting.facts.dividendLedgerEntries.push(
      {
        id: "ledger-tw",
        accountId: "acc-1",
        dividendEventId: twEvent.id,
        eligibleQuantity: 10,
        expectedCashAmount: 120,
        expectedStockQuantity: 0,
        receivedCashAmount: 120,
        receivedStockQuantity: 0,
        postingStatus: "posted",
        reconciliationStatus: "matched",
        version: 1,
        sourceCompositionStatus: "provided",
        bookedAt: new Date().toISOString(),
      },
      {
        id: "ledger-au",
        accountId: auAccount.id,
        dividendEventId: auEvent.id,
        eligibleQuantity: 10,
        expectedCashAmount: 80,
        expectedStockQuantity: 0,
        receivedCashAmount: 80,
        receivedStockQuantity: 0,
        postingStatus: "posted",
        reconciliationStatus: "matched",
        version: 1,
        sourceCompositionStatus: "provided",
        bookedAt: new Date().toISOString(),
      },
    );
    await app.persistence.saveStore(store);

    const response = await app.inject({
      method: "GET",
      url: "/portfolio/dividends/ledger?ticker=DUPE&marketCode=AU",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().ledgerEntries).toEqual([
      expect.objectContaining({
        id: "ledger-au",
        marketCode: "AU",
        ticker: "DUPE",
      }),
    ]);
  });

  it("applies the calendar market filter before limiting dividend events", async () => {
    const accountResponse = await app.inject({
      method: "POST",
      url: "/accounts",
      payload: {
        name: "AU Account",
        defaultCurrency: "AUD",
        accountType: "broker",
      },
    });
    expect(accountResponse.statusCode).toBe(200);
    const auAccount = accountResponse.json() as { id: string };
    const tradeResponse = await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "calendar-au-position" },
      payload: transactionPayload({
        accountId: auAccount.id,
        ticker: "DUPE",
        marketCode: "AU",
        quantity: 10,
        unitPrice: 10,
        priceCurrency: "AUD",
        tradeDate: "2026-01-15",
      }),
    });
    expect(tradeResponse.statusCode).toBe(200);
    const store = await app.persistence.loadStore("user-1");
    createDividendEvent(store, {
      id: randomUUID(),
      ...dividendEventPayload({
        ticker: "DUPE",
        marketCode: "TW",
        cashDividendCurrency: "TWD",
        paymentDate: "2026-02-20",
      }),
    } as CreateDividendEventInput);
    createDividendEvent(store, {
      id: randomUUID(),
      ...dividendEventPayload({
        ticker: "DUPE",
        marketCode: "AU",
        cashDividendCurrency: "AUD",
        paymentDate: "2026-02-21",
      }),
    } as CreateDividendEventInput);
    await app.persistence.saveStore(store);

    const response = await app.inject({
      method: "GET",
      url: "/portfolio/dividends/calendar?fromPaymentDate=2026-02-01&toPaymentDate=2026-02-28&marketCode=AU&limit=1",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().events).toEqual([
      expect.objectContaining({
        ticker: "DUPE",
        marketCode: "AU",
        paymentDate: "2026-02-21",
      }),
    ]);
  });

  it("returns only paid January 2026 rows for the month-scoped calendar snapshot", async () => {
    await seedInstrument();
    await seedBuyAtDate("2025-12-15");
    await seedDividendEvent({
      ticker: "2330",
      eventType: "CASH",
      exDividendDate: "2026-01-10",
      paymentDate: "2026-01-20",
      cashDividendPerShare: 10,
    });
    await seedDividendEvent({
      ticker: "2330",
      eventType: "CASH",
      exDividendDate: "2026-03-10",
      paymentDate: null,
      cashDividendPerShare: 9,
    });
    await seedDividendEvent({
      ticker: "2330",
      eventType: "CASH",
      exDividendDate: "2026-04-10",
      paymentDate: "2026-04-20",
      cashDividendPerShare: 12,
    });

    const response = await app.inject({
      method: "GET",
      url: "/portfolio/dividends/calendar?fromPaymentDate=2026-01-01&toPaymentDate=2026-01-31&limit=20",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      events: [
        expect.objectContaining({
          ticker: "2330",
          tickerName: "TSMC",
          paymentDate: "2026-01-20",
          expectedCashAmount: 100,
        }),
      ],
      ledgerEntries: [],
    });
    expect(response.json().events).toHaveLength(1);
    expect(response.json().events.every((event: { paymentDate: string | null }) => event.paymentDate !== null)).toBe(true);
  });

  it("returns only paid April 2026 rows for the month-scoped calendar snapshot", async () => {
    await seedInstrument();
    await seedBuyAtDate("2025-12-15");
    const aprilDividend = await seedDividendEvent({
      ticker: "2330",
      eventType: "CASH",
      exDividendDate: "2026-04-10",
      paymentDate: "2026-04-20",
      cashDividendPerShare: 11,
    });
    await seedDividendEvent({
      ticker: "2330",
      eventType: "CASH",
      exDividendDate: "2026-01-10",
      paymentDate: "2026-01-20",
      cashDividendPerShare: 10,
    });
    await seedDividendEvent({
      ticker: "2330",
      eventType: "CASH",
      exDividendDate: "2026-03-10",
      paymentDate: null,
      cashDividendPerShare: 9,
    });

    const postingResponse = await app.inject({
      method: "POST",
      url: "/portfolio/dividends/postings",
      headers: { "idempotency-key": "calendar-april-posting" },
      payload: dividendPostingPayload({
        dividendEventId: aprilDividend.id,
        receivedCashAmount: 99,
        sourceLines: [
          {
            sourceBucket: "DIVIDEND_INCOME",
            amount: 110,
            currencyCode: "TWD",
            source: "issuer_statement",
            sourceReference: "stmt-2026-04",
          },
        ],
        deductions: [
          {
            deductionType: "NHI_SUPPLEMENTAL_PREMIUM",
            amount: 11,
            currencyCode: "TWD",
            withheldAtSource: true,
            source: "dividend_posting",
          },
        ],
      }),
    });
    expect(postingResponse.statusCode).toBe(200);

    const response = await app.inject({
      method: "GET",
      url: "/portfolio/dividends/calendar?fromPaymentDate=2026-04-01&toPaymentDate=2026-04-30&limit=20",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      events: [
        expect.objectContaining({
          ticker: "2330",
          tickerName: "TSMC",
          paymentDate: "2026-04-20",
          hasPostedLedgerEntry: true,
        }),
      ],
      ledgerEntries: [
        expect.objectContaining({
          ticker: "2330",
          tickerName: "TSMC",
          paymentDate: "2026-04-20",
          receivedCashAmount: 99,
        }),
      ],
    });
    expect(response.json().events).toHaveLength(1);
    expect(response.json().ledgerEntries).toHaveLength(1);
    expect(response.json().events.every((event: { paymentDate: string | null }) => event.paymentDate !== null)).toBe(true);
  });

  it("updates posted cash dividends in place and emits dividend events", async () => {
    const events: Array<{ type: string; data: unknown }> = [];
    app.eventBus.subscribe("user-1", (event) => events.push({ type: event.type, data: event.data }));

    await seedBuy();
    const dividendEvent = await seedDividendEvent({
      ticker: "2330",
      eventType: "CASH",
      exDividendDate: "2026-02-01",
      paymentDate: "2026-02-20",
      cashDividendPerShare: 12,
    });

    const initialPostingResponse = await app.inject({
      method: "POST",
      url: "/portfolio/dividends/postings",
      headers: { "idempotency-key": "k-dividend-posting-initial" },
      payload: dividendPostingPayload({
        dividendEventId: dividendEvent.id,
        receivedCashAmount: 108,
      }),
    });
    expect(initialPostingResponse.statusCode).toBe(200);
    const initialPosting = initialPostingResponse.json();

    const updateResponse = await app.inject({
      method: "POST",
      url: "/portfolio/dividends/postings",
      headers: { "idempotency-key": "k-dividend-posting-update" },
      payload: dividendPostingUpdatePayload({
        dividendEventId: dividendEvent.id,
        dividendLedgerEntryId: initialPosting.dividendLedgerEntry.id,
        expectedVersion: initialPosting.dividendLedgerEntry.version,
        receivedCashAmount: 96,
        deductions: [
          {
            deductionType: "WITHHOLDING_TAX",
            amount: 24,
            currencyCode: "TWD",
            withheldAtSource: true,
            source: "broker_statement",
          },
        ],
        sourceLines: [
          {
            sourceBucket: "DIVIDEND_INCOME",
            amount: 120,
            currencyCode: "TWD",
            source: "broker_statement",
          },
        ],
      }),
    });

    expect(updateResponse.statusCode).toBe(200);
    const updatedPosting = updateResponse.json();
    expect(updatedPosting.dividendLedgerEntry.version).toBe(2);
    expect(updatedPosting.dividendLedgerEntry.reconciliationStatus).toBe("open");
    expect(updatedPosting.comparison.actualCashEconomicAmount).toBe(120);

    const ledgerResponse = await app.inject({ method: "GET", url: "/portfolio/dividends/ledger" });
    const [updatedEntry] = ledgerResponse.json().ledgerEntries;
    expect(updatedEntry).toEqual(
      expect.objectContaining({
        id: initialPosting.dividendLedgerEntry.id,
        receivedCashAmount: 96,
        version: 2,
        deductions: [
          expect.objectContaining({
            deductionType: "WITHHOLDING_TAX",
            amount: 24,
          }),
        ],
      }),
    );

    // POST /portfolio/transactions fires scheduleReplayWithRetry after
    // KZO-37 Invariant 5, so the event bus sees recompute_complete from the
    // seed buy before the dividend lifecycle events. Filter for dividend
    // events only — their relative order is the load-bearing contract.
    const dividendOnly = events.filter((event) => event.type.startsWith("dividend_"));
    expect(dividendOnly.map((event) => event.type)).toEqual(["dividend_posted", "dividend_updated"]);
  });

  it("posts stock dividends through the non-cash holdings path and rejects in-place edits", async () => {
    await seedBuy();
    const dividendEvent = await seedDividendEvent({
      ticker: "2330",
      eventType: "STOCK",
      exDividendDate: "2026-02-01",
      paymentDate: "2026-02-20",
      cashDividendPerShare: 0,
      stockDividendPerShare: 0.1,
    });

    const postingResponse = await app.inject({
      method: "POST",
      url: "/portfolio/dividends/postings",
      headers: { "idempotency-key": "k-stock-dividend-posting" },
      payload: dividendPostingPayload({
        dividendEventId: dividendEvent.id,
        receivedCashAmount: 0,
        receivedStockQuantity: 1,
        deductions: [],
        sourceCompositionStatus: "unknown_pending_disclosure",
        sourceLines: [],
      }),
    });

    expect(postingResponse.statusCode).toBe(200);
    const posting = postingResponse.json();
    expect(posting.comparison.expectedStockQuantity).toBe(1);

    const holdingsResponse = await app.inject({ method: "GET", url: "/portfolio/holdings" });
    expect(holdingsResponse.statusCode).toBe(200);
    expect(holdingsResponse.json()).toEqual([
      {
        accountId: "acc-1",
        ticker: "2330",
        quantity: 11,
        costBasisAmount: 1_000,
        currency: "TWD",
      },
    ]);

    const updateResponse = await app.inject({
      method: "POST",
      url: "/portfolio/dividends/postings",
      headers: { "idempotency-key": "k-stock-dividend-update" },
      payload: dividendPostingUpdatePayload({
        dividendEventId: dividendEvent.id,
        dividendLedgerEntryId: posting.dividendLedgerEntry.id,
        expectedVersion: posting.dividendLedgerEntry.version,
        receivedCashAmount: 0,
        deductions: [],
        sourceLines: [],
        sourceCompositionStatus: "unknown_pending_disclosure",
      }),
    });

    expect(updateResponse.statusCode).toBe(422);
    expect(updateResponse.json()).toEqual(
      expect.objectContaining({ error: "stock_dividend_in_place_edit_unsupported" }),
    );
  });

  it("patches reconciliation status, requires note for explained, and rejects expected rows", async () => {
    const events: Array<{ type: string; data: unknown }> = [];
    app.eventBus.subscribe("user-1", (event) => events.push({ type: event.type, data: event.data }));

    await seedBuy();
    const postedEvent = await seedDividendEvent({
      ticker: "2330",
      eventType: "CASH",
      exDividendDate: "2026-02-01",
      paymentDate: "2026-02-20",
      cashDividendPerShare: 12,
    });
    const postResponse = await app.inject({
      method: "POST",
      url: "/portfolio/dividends/postings",
      headers: { "idempotency-key": "k-dividend-posting-reconciliation" },
      payload: dividendPostingPayload({
        dividendEventId: postedEvent.id,
        receivedCashAmount: 108,
      }),
    });
    const postedEntryId = postResponse.json().dividendLedgerEntry.id as string;

    const matchedResponse = await app.inject({
      method: "PATCH",
      url: `/portfolio/dividends/postings/${postedEntryId}/reconciliation`,
      payload: dividendReconciliationPayload(),
    });
    expect(matchedResponse.statusCode).toBe(200);
    expect(matchedResponse.json().ledgerEntry).toEqual(
      expect.objectContaining({
        id: postedEntryId,
        reconciliationStatus: "matched",
        version: 2,
      }),
    );

    const explainedWithoutNote = await app.inject({
      method: "PATCH",
      url: `/portfolio/dividends/postings/${postedEntryId}/reconciliation`,
      payload: dividendReconciliationPayload({ status: "explained" }),
    });
    expect(explainedWithoutNote.statusCode).toBe(400);
    expect(explainedWithoutNote.json()).toEqual(
      expect.objectContaining({ error: "reconciliation_note_required" }),
    );

    const explainedWithNote = await app.inject({
      method: "PATCH",
      url: `/portfolio/dividends/postings/${postedEntryId}/reconciliation`,
      payload: dividendReconciliationPayload({ status: "explained", note: "Broker netted tax separately" }),
    });
    expect(explainedWithNote.statusCode).toBe(200);
    expect(explainedWithNote.json().ledgerEntry).toEqual(
      expect.objectContaining({
        id: postedEntryId,
        reconciliationStatus: "explained",
        reconciliationNote: "Broker netted tax separately",
        version: 3,
      }),
    );

    const store = await app.persistence.loadStore("user-1");
    const expectedEvent = createDividendEvent(store, {
      id: randomUUID(),
      ...dividendEventPayload({
        ticker: "2330",
        eventType: "CASH",
        exDividendDate: "2026-03-01",
        paymentDate: "2026-03-20",
        cashDividendPerShare: 5,
      }),
    } as CreateDividendEventInput);
    const expectedEntry: DividendLedgerEntry = {
      id: randomUUID(),
      accountId: "acc-1",
      dividendEventId: expectedEvent.id,
      eligibleQuantity: 10,
      expectedCashAmount: 50,
      expectedStockQuantity: 0,
      receivedCashAmount: 0,
      receivedStockQuantity: 0,
      postingStatus: "expected",
      reconciliationStatus: "open",
      version: 1,
      sourceCompositionStatus: "unknown_pending_disclosure",
      bookedAt: new Date().toISOString(),
    };
    store.accounting.facts.dividendLedgerEntries.push(expectedEntry);
    await app.persistence.saveStore(store);

    const expectedPatchResponse = await app.inject({
      method: "PATCH",
      url: `/portfolio/dividends/postings/${expectedEntry.id}/reconciliation`,
      payload: dividendReconciliationPayload(),
    });
    expect(expectedPatchResponse.statusCode).toBe(409);
    expect(expectedPatchResponse.json()).toEqual(
      expect.objectContaining({ error: "reconciliation_requires_posted_status" }),
    );

    expect(events.map((event) => event.type)).toContain("dividend_reconciliation_changed");
  });

  it("updates stored expected amounts when a retroactive trade lands (Rule B)", async () => {
    // Buy 1 share initially.
    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-retro-initial-buy" },
      payload: transactionPayload({
        quantity: 1,
        unitPrice: 100,
        tradeDate: "2026-01-10",
        commissionAmount: 0,
        taxAmount: 0,
      }),
    });

    // Declare and post a dividend — eligibleQuantity captured at this moment = 1.
    const dividendEvent = await seedDividendEvent({
      ticker: "2330",
      eventType: "CASH",
      exDividendDate: "2026-02-15",
      paymentDate: "2026-02-28",
      cashDividendPerShare: 12,
    });
    const postingResponse = await app.inject({
      method: "POST",
      url: "/portfolio/dividends/postings",
      headers: { "idempotency-key": "k-retro-initial-post" },
      payload: dividendPostingPayload({
        dividendEventId: dividendEvent.id,
        receivedCashAmount: 12,
        deductions: [],
        sourceCompositionStatus: "unknown_pending_disclosure",
        sourceLines: [],
      }),
    });
    expect(postingResponse.statusCode).toBe(200);
    const postedLedgerEntryId = postingResponse.json().dividendLedgerEntry.id;

    // Sanity: stored snapshot captured eligibleQuantity=1.
    let store = await app.persistence.loadStore("user-1");
    let storedEntry = store.accounting.facts.dividendLedgerEntries.find((e) => e.id === postedLedgerEntryId)!;
    expect(storedEntry.eligibleQuantity).toBe(1);
    expect(storedEntry.expectedCashAmount).toBe(12);
    const originalVersion = storedEntry.version;

    // Retroactively enter a forgotten BUY of 9 more shares dated before the
    // ex-dividend cutoff. The scheduled replay should recompute the posted
    // ledger entry and bring stored values in line with current trades.
    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-retro-late-buy" },
      payload: transactionPayload({
        quantity: 9,
        unitPrice: 100,
        tradeDate: "2026-02-01",
        commissionAmount: 0,
        taxAmount: 0,
      }),
    });
    // Replay runs on setImmediate — yield the event loop to let it finish.
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Stored snapshot should now reflect 10 × 12 = 120 via recompute.
    store = await app.persistence.loadStore("user-1");
    storedEntry = store.accounting.facts.dividendLedgerEntries.find((e) => e.id === postedLedgerEntryId)!;
    expect(storedEntry.eligibleQuantity).toBe(10);
    expect(storedEntry.expectedCashAmount).toBe(120);
    expect(storedEntry.version).toBe(originalVersion + 1);

    // GET endpoints must also reflect the recomputed values.
    const listResponse = await app.inject({ method: "GET", url: "/dividend-events" });
    const eventsBody = listResponse.json();
    const item = eventsBody.dividendEvents.find(
      (entry: { id: string }) => entry.id === dividendEvent.id,
    );
    expect(item).toEqual(
      expect.objectContaining({
        eligibleQuantity: 10,
        expectedCashAmount: 120,
      }),
    );

    const ledgerResponse = await app.inject({ method: "GET", url: "/portfolio/dividends/ledger" });
    const ledgerBody = ledgerResponse.json();
    expect(ledgerBody.ledgerEntries).toHaveLength(1);
    expect(ledgerBody.ledgerEntries[0]).toEqual(
      expect.objectContaining({
        eligibleQuantity: 10,
        expectedCashAmount: 120,
        receivedCashAmount: 12,
      }),
    );
  });

  it("resets a matched ledger entry to open and emits SSE when recompute changes expected (Rule B)", async () => {
    const events: Array<{ type: string; data: unknown }> = [];
    app.eventBus.subscribe("user-1", (event) => events.push({ type: event.type, data: event.data }));

    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-matched-initial" },
      payload: transactionPayload({
        quantity: 1,
        unitPrice: 100,
        tradeDate: "2026-01-10",
        commissionAmount: 0,
        taxAmount: 0,
      }),
    });

    const dividendEvent = await seedDividendEvent({
      ticker: "2330",
      eventType: "CASH",
      exDividendDate: "2026-02-15",
      paymentDate: "2026-02-28",
      cashDividendPerShare: 12,
    });
    const postResponse = await app.inject({
      method: "POST",
      url: "/portfolio/dividends/postings",
      headers: { "idempotency-key": "k-matched-post" },
      payload: dividendPostingPayload({
        dividendEventId: dividendEvent.id,
        receivedCashAmount: 12,
        deductions: [],
        sourceCompositionStatus: "unknown_pending_disclosure",
        sourceLines: [],
      }),
    });
    const ledgerEntryId = postResponse.json().dividendLedgerEntry.id;

    // Mark matched manually.
    const matchedResponse = await app.inject({
      method: "PATCH",
      url: `/portfolio/dividends/postings/${ledgerEntryId}/reconciliation`,
      payload: { status: "matched" },
    });
    expect(matchedResponse.statusCode).toBe(200);

    // Add retroactive buy — recompute must reset status to "open" and
    // emit a dividend_reconciliation_changed event.
    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-matched-late-buy" },
      payload: transactionPayload({
        quantity: 9,
        unitPrice: 100,
        tradeDate: "2026-02-01",
        commissionAmount: 0,
        taxAmount: 0,
      }),
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    const store = await app.persistence.loadStore("user-1");
    const storedEntry = store.accounting.facts.dividendLedgerEntries.find((e) => e.id === ledgerEntryId)!;
    expect(storedEntry.reconciliationStatus).toBe("open");
    expect(storedEntry.expectedCashAmount).toBe(120);
    // Two dividend_reconciliation_changed events: one from the manual PATCH,
    // one from the Rule B auto-reopen during recompute.
    const reconciliationEvents = events.filter((e) => e.type === "dividend_reconciliation_changed");
    expect(reconciliationEvents.length).toBeGreaterThanOrEqual(2);
    expect(reconciliationEvents.at(-1)?.data).toEqual(
      expect.objectContaining({
        dividendLedgerEntryId: ledgerEntryId,
        reconciliationStatus: "open",
      }),
    );
  });

  it("preserves reconciliation_note on explained → open transitions (1a)", async () => {
    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-explained-initial" },
      payload: transactionPayload({
        quantity: 1,
        unitPrice: 100,
        tradeDate: "2026-01-10",
        commissionAmount: 0,
        taxAmount: 0,
      }),
    });

    const dividendEvent = await seedDividendEvent({
      ticker: "2330",
      eventType: "CASH",
      exDividendDate: "2026-02-15",
      paymentDate: "2026-02-28",
      cashDividendPerShare: 12,
    });
    const postResponse = await app.inject({
      method: "POST",
      url: "/portfolio/dividends/postings",
      headers: { "idempotency-key": "k-explained-post" },
      payload: dividendPostingPayload({
        dividendEventId: dividendEvent.id,
        receivedCashAmount: 10,
        deductions: [],
        sourceCompositionStatus: "unknown_pending_disclosure",
        sourceLines: [],
      }),
    });
    const ledgerEntryId = postResponse.json().dividendLedgerEntry.id;

    const explainedNote = "Broker netted a NT$2 rounding";
    await app.inject({
      method: "PATCH",
      url: `/portfolio/dividends/postings/${ledgerEntryId}/reconciliation`,
      payload: { status: "explained", note: explainedNote },
    });

    // Retroactive buy flips expected and triggers auto-reopen.
    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-explained-late-buy" },
      payload: transactionPayload({
        quantity: 9,
        unitPrice: 100,
        tradeDate: "2026-02-01",
        commissionAmount: 0,
        taxAmount: 0,
      }),
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    const store = await app.persistence.loadStore("user-1");
    const entry = store.accounting.facts.dividendLedgerEntries.find((e) => e.id === ledgerEntryId)!;
    expect(entry.reconciliationStatus).toBe("open");
    expect(entry.reconciliationNote).toBe(explainedNote); // preserved
  });

  it("is a full no-op when a trade does not change expected values (1b)", async () => {
    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-noop-initial" },
      payload: transactionPayload({
        quantity: 10,
        unitPrice: 100,
        tradeDate: "2026-01-10",
        commissionAmount: 0,
        taxAmount: 0,
      }),
    });

    const dividendEvent = await seedDividendEvent({
      ticker: "2330",
      eventType: "CASH",
      exDividendDate: "2026-02-15",
      paymentDate: "2026-02-28",
      cashDividendPerShare: 12,
    });
    const postResponse = await app.inject({
      method: "POST",
      url: "/portfolio/dividends/postings",
      headers: { "idempotency-key": "k-noop-post" },
      payload: dividendPostingPayload({
        dividendEventId: dividendEvent.id,
        receivedCashAmount: 120,
        deductions: [],
        sourceCompositionStatus: "unknown_pending_disclosure",
        sourceLines: [],
      }),
    });
    const ledgerEntryId = postResponse.json().dividendLedgerEntry.id;

    await app.inject({
      method: "PATCH",
      url: `/portfolio/dividends/postings/${ledgerEntryId}/reconciliation`,
      payload: { status: "matched" },
    });

    let store = await app.persistence.loadStore("user-1");
    const beforeEntry = store.accounting.facts.dividendLedgerEntries.find((e) => e.id === ledgerEntryId)!;
    const versionBefore = beforeEntry.version;
    expect(beforeEntry.reconciliationStatus).toBe("matched");

    // Add a trade AFTER the ex-dividend date — does not affect eligibility
    // and therefore must not change expected_cash_amount. Rule 1b: full no-op.
    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-noop-post-exdiv" },
      payload: transactionPayload({
        quantity: 5,
        unitPrice: 100,
        tradeDate: "2026-03-01",
        commissionAmount: 0,
        taxAmount: 0,
      }),
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    store = await app.persistence.loadStore("user-1");
    const afterEntry = store.accounting.facts.dividendLedgerEntries.find((e) => e.id === ledgerEntryId)!;
    expect(afterEntry.version).toBe(versionBefore);
    expect(afterEntry.reconciliationStatus).toBe("matched"); // preserved
    expect(afterEntry.expectedCashAmount).toBe(120);
  });
});
