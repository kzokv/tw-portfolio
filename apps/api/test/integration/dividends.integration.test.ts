import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { dividendEventPayload, dividendPostingPayload, transactionPayload } from "../helpers/fixtures.js";

let app: Awaited<ReturnType<typeof buildApp>>;

describe("dividends", () => {
  beforeEach(async () => {
    app = await buildApp({ persistenceBackend: "memory" });
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it("declares a dividend event and posts cash receipt with linked deductions", async () => {
    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-dividend-buy" },
      payload: transactionPayload({
        quantity: 10,
        priceNtd: 100,
        tradeDate: "2026-01-15",
        commissionNtd: 0,
        taxNtd: 0,
      }),
    });

    const eventResponse = await app.inject({
      method: "POST",
      url: "/dividend-events",
      payload: dividendEventPayload({
        symbol: "2330",
        eventType: "CASH",
        exDividendDate: "2026-02-01",
        paymentDate: "2026-02-20",
        cashDividendPerShare: 12,
      }),
    });

    expect(eventResponse.statusCode).toBe(200);
    const dividendEvent = eventResponse.json();

    const postingResponse = await app.inject({
      method: "POST",
      url: "/portfolio/dividends/postings",
      headers: { "idempotency-key": "k-dividend-posting" },
      payload: dividendPostingPayload({
        dividendEventId: dividendEvent.id,
        receivedCashAmountNtd: 108,
        deductions: [
          {
            deductionType: "NHI_SUPPLEMENTAL_PREMIUM",
            amount: 12,
            withheldAtSource: true,
            sourceType: "dividend_posting",
          },
        ],
      }),
    });

    expect(postingResponse.statusCode).toBe(200);
    const posting = postingResponse.json();
    expect(posting.comparison).toEqual({
      expectedCashAmountNtd: 120,
      actualCashEconomicAmountNtd: 120,
      cashVarianceAmountNtd: 0,
      expectedStockQuantity: 0,
      actualStockQuantity: 0,
      stockVarianceQuantity: 0,
    });

    const ledgerResponse = await app.inject({ method: "GET", url: "/portfolio/dividends/ledger" });
    expect(ledgerResponse.statusCode).toBe(200);
    expect(ledgerResponse.json()).toEqual([
      expect.objectContaining({
        accountId: "acc-1",
        dividendEventId: dividendEvent.id,
        eligibleQuantity: 10,
        expectedCashAmountNtd: 120,
        receivedCashAmountNtd: 108,
        postingStatus: "posted",
        reconciliationStatus: "open",
      }),
    ]);

    const store = await app.persistence.loadStore("user-1");
    expect(store.accounting.facts.dividendEvents).toEqual([
      expect.objectContaining({
        id: dividendEvent.id,
        symbol: "2330",
      }),
    ]);
    expect(store.accounting.facts.dividendDeductionEntries).toEqual([
      expect.objectContaining({
        dividendLedgerEntryId: posting.dividendLedgerEntry.id,
        deductionType: "NHI_SUPPLEMENTAL_PREMIUM",
        amount: 12,
        currencyCode: "TWD",
      }),
    ]);
    expect(store.accounting.facts.cashLedgerEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relatedDividendLedgerEntryId: posting.dividendLedgerEntry.id,
          entryType: "DIVIDEND_RECEIPT",
          amountNtd: 108,
        }),
        expect.objectContaining({
          relatedDividendLedgerEntryId: posting.dividendLedgerEntry.id,
          entryType: "DIVIDEND_DEDUCTION",
          amountNtd: -12,
        }),
      ]),
    );
  });

  it("posts stock dividends through the non-cash holdings path", async () => {
    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-stock-dividend-buy" },
      payload: transactionPayload({
        quantity: 10,
        priceNtd: 100,
        tradeDate: "2026-01-15",
        commissionNtd: 0,
        taxNtd: 0,
      }),
    });

    const eventResponse = await app.inject({
      method: "POST",
      url: "/dividend-events",
      payload: dividendEventPayload({
        symbol: "2330",
        eventType: "STOCK",
        exDividendDate: "2026-02-01",
        paymentDate: "2026-02-20",
        cashDividendPerShare: 0,
        stockDividendPerShare: 0.1,
      }),
    });
    const dividendEvent = eventResponse.json();

    const postingResponse = await app.inject({
      method: "POST",
      url: "/portfolio/dividends/postings",
      headers: { "idempotency-key": "k-stock-dividend-posting" },
      payload: dividendPostingPayload({
        dividendEventId: dividendEvent.id,
        receivedCashAmountNtd: 0,
        receivedStockQuantity: 1,
        deductions: [],
      }),
    });

    expect(postingResponse.statusCode).toBe(200);
    expect(postingResponse.json().comparison.expectedStockQuantity).toBe(1);

    const holdingsResponse = await app.inject({ method: "GET", url: "/portfolio/holdings" });
    expect(holdingsResponse.statusCode).toBe(200);
    expect(holdingsResponse.json()).toEqual([
      {
        accountId: "acc-1",
        symbol: "2330",
        quantity: 11,
        costNtd: 1_000,
      },
    ]);
  });
});
