import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildDashboardOverview } from "../../src/services/dashboard.js";
import { createStore } from "../../src/services/store.js";

describe("buildDashboardOverview dividend metadata", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-06T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("includes ticker display names and market context on upcoming and recent dividend rows", () => {
    const store = createStore();
    const instrument = store.instruments.find((entry) => entry.ticker === "2330" && entry.marketCode === "TW");
    if (!instrument) throw new Error("instrument_not_found:2330:TW");
    instrument.name = "TSMC";

    store.accounting.facts.tradeEvents.push({
      id: "buy-2330",
      userId: "user-1",
      accountId: "acc-1",
      ticker: "2330",
      marketCode: "TW",
      instrumentType: "STOCK",
      type: "BUY",
      quantity: 10,
      unitPrice: 100,
      priceCurrency: "TWD",
      tradeDate: "2026-01-15",
      commissionAmount: 0,
      taxAmount: 0,
      isDayTrade: false,
      feeSnapshot: store.feeProfiles[0]!,
    });

    store.marketData.dividendEvents.push(
      {
        id: "div-upcoming",
        ticker: "2330",
        marketCode: "TW",
        eventType: "CASH",
        exDividendDate: "2026-08-01",
        paymentDate: "2026-08-20",
        cashDividendPerShare: 12,
        cashDividendCurrency: "TWD",
        stockDividendPerShare: 0,
        source: "test",
      },
      {
        id: "div-posted",
        ticker: "2330",
        marketCode: "TW",
        eventType: "CASH",
        exDividendDate: "2026-06-01",
        paymentDate: "2026-06-20",
        cashDividendPerShare: 8,
        cashDividendCurrency: "TWD",
        stockDividendPerShare: 0,
        source: "test",
      },
    );

    store.accounting.facts.dividendLedgerEntries.push({
      id: "ledger-posted",
      accountId: "acc-1",
      dividendEventId: "div-posted",
      eligibleQuantity: 10,
      expectedCashAmount: 80,
      expectedStockQuantity: 0,
      receivedCashAmount: 72,
      receivedStockQuantity: 0,
      postingStatus: "posted",
      reconciliationStatus: "open",
      version: 1,
      sourceCompositionStatus: "provided",
      bookedAt: "2026-06-20T00:00:00.000Z",
    });

    const overview = buildDashboardOverview(store, {
      integrityIssue: null,
      quotes: [],
    });

    expect(overview.dividends.upcoming).toEqual([
      expect.objectContaining({
        ticker: "2330",
        tickerName: "TSMC",
        marketCode: "TW",
        expectedAmount: 120,
      }),
    ]);
    expect(overview.dividends.recent).toEqual([
      expect.objectContaining({
        ticker: "2330",
        tickerName: "TSMC",
        marketCode: "TW",
        dividendLedgerEntryId: "ledger-posted",
        reconciliationStatus: "open",
      }),
    ]);
  });
});
