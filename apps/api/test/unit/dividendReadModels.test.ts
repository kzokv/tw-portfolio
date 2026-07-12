import { describe, expect, it } from "vitest";
import { createDefaultFeeProfile, createStore, setStoreInstruments } from "../../src/services/store.js";
import {
  buildHoldingActivityDividends,
  buildTickerDividendOpenReconciliationPage,
  buildTickerDividendPostedHistoryPage,
} from "../../src/services/tickerDetails.js";

function buildStore() {
  const store = createStore();
  const twFee = createDefaultFeeProfile("acc-1", "TWD", "fp-acc-1");
  const twFee2 = createDefaultFeeProfile("acc-2", "TWD", "fp-acc-2");
  const auFee = createDefaultFeeProfile("acc-au", "AUD", "fp-acc-au");
  store.feeProfiles.push(twFee, twFee2, auFee);
  store.accounts.push(
    {
      id: "acc-1",
      userId: "user-1",
      name: "Alpha",
      feeProfileId: twFee.id,
      defaultCurrency: "TWD",
      accountType: "broker",
    },
    {
      id: "acc-2",
      userId: "user-1",
      name: "Beta",
      feeProfileId: twFee2.id,
      defaultCurrency: "TWD",
      accountType: "broker",
    },
    {
      id: "acc-au",
      userId: "user-1",
      name: "Sydney",
      feeProfileId: auFee.id,
      defaultCurrency: "AUD",
      accountType: "broker",
    },
  );
  setStoreInstruments(store, [
    ...store.instruments,
    { ticker: "2330", name: "TSMC", type: "STOCK", marketCode: "TW", isProvisional: false },
    { ticker: "BHP", name: "BHP", type: "STOCK", marketCode: "AU", isProvisional: false },
  ]);
  return store;
}

describe("dividend read models", () => {
  it("[ticker posted history]: page and open queries → paginate independently and keep open rows visible", () => {
    const store = buildStore();

    for (let index = 1; index <= 12; index += 1) {
      const day = String(index).padStart(2, "0");
      const eventId = `event-${day}`;
      store.marketData.dividendEvents.push({
        id: eventId,
        ticker: "2330",
        marketCode: "TW",
        eventType: "CASH",
        exDividendDate: `2026-01-${day}`,
        paymentDate: `2026-02-${day}`,
        cashDividendPerShare: 10,
        cashDividendCurrency: "TWD",
        stockDividendPerShare: 0,
        source: "test",
      });
      store.accounting.facts.dividendLedgerEntries.push({
        id: `ledger-${day}`,
        accountId: "acc-1",
        dividendEventId: eventId,
        eligibleQuantity: 10,
        expectedCashAmount: 100,
        expectedStockQuantity: 0,
        receivedCashAmount: 100,
        receivedStockQuantity: 0,
        postingStatus: "posted",
        reconciliationStatus: index === 1 ? "open" : "matched",
        version: 1,
        sourceCompositionStatus: "provided",
        bookedAt: `2026-02-${day}T09:00:00.000Z`,
      });
    }

    store.accounting.facts.dividendLedgerEntries.push({
      id: "ledger-reversed",
      accountId: "acc-1",
      dividendEventId: "event-02",
      eligibleQuantity: 10,
      expectedCashAmount: 100,
      expectedStockQuantity: 0,
      receivedCashAmount: 100,
      receivedStockQuantity: 0,
      postingStatus: "posted",
      reconciliationStatus: "matched",
      version: 1,
      sourceCompositionStatus: "provided",
      reversalOfDividendLedgerEntryId: "ledger-02",
      bookedAt: "2026-02-03T09:00:00.000Z",
    });
    store.accounting.facts.dividendLedgerEntries.push({
      id: "ledger-superseded",
      accountId: "acc-1",
      dividendEventId: "event-03",
      eligibleQuantity: 10,
      expectedCashAmount: 100,
      expectedStockQuantity: 0,
      receivedCashAmount: 100,
      receivedStockQuantity: 0,
      postingStatus: "posted",
      reconciliationStatus: "matched",
      version: 1,
      sourceCompositionStatus: "provided",
      supersededAt: "2026-02-04T00:00:00.000Z",
      bookedAt: "2026-02-03T09:00:00.000Z",
    });
    store.accounting.facts.dividendLedgerEntries.push({
      id: "ledger-other-market",
      accountId: "acc-au",
      dividendEventId: "event-01",
      eligibleQuantity: 10,
      expectedCashAmount: 100,
      expectedStockQuantity: 0,
      receivedCashAmount: 100,
      receivedStockQuantity: 0,
      postingStatus: "posted",
      reconciliationStatus: "open",
      version: 1,
      sourceCompositionStatus: "provided",
      bookedAt: "2026-02-01T09:00:00.000Z",
    });

    const page1 = buildTickerDividendPostedHistoryPage(store, "2330", "TW", new Set(["acc-1"]), { page: 1, limit: 10 });
    const page2 = buildTickerDividendPostedHistoryPage(store, "2330", "TW", new Set(["acc-1"]), { page: 2, limit: 10 });
    const open = buildTickerDividendOpenReconciliationPage(store, "2330", "TW", new Set(["acc-1"]), { page: 1, limit: 10 });

    expect(page1.total).toBe(11);
    expect(page1.items).toHaveLength(10);
    expect(page1.items[0]?.dividendLedgerEntryId).toBe("ledger-12");
    expect(page2.items.map((item) => item.dividendLedgerEntryId)).toEqual(["ledger-01"]);
    expect(open.total).toBe(1);
    expect(open.items.map((item) => item.dividendLedgerEntryId)).toEqual(["ledger-01"]);
  });

  it("[holding activity]: position actions → include all active action types in stable reverse-chronological order", () => {
    const store = buildStore();
    store.accounting.facts.positionActions.push(
      {
        id: "split-1",
        accountId: "acc-1",
        ticker: "2330",
        marketCode: "TW",
        actionType: "SPLIT",
        actionDate: "2026-03-15",
        actionTimestamp: "2026-03-15T09:00:00.000Z",
        quantity: 20,
        ratioNumerator: 2,
        ratioDenominator: 1,
        source: "manual",
      },
      {
        id: "stock-1",
        accountId: "acc-1",
        ticker: "2330",
        marketCode: "TW",
        actionType: "STOCK_DIVIDEND",
        actionDate: "2026-02-20",
        actionTimestamp: "2026-02-20T09:00:00.000Z",
        quantity: 1,
        relatedDividendLedgerEntryId: "ledger-open",
        source: "dividend_posting",
      },
      {
        id: "reverse-1",
        accountId: "acc-1",
        ticker: "2330",
        marketCode: "TW",
        actionType: "REVERSE_SPLIT",
        actionDate: "2026-01-10",
        actionTimestamp: "2026-01-10T09:00:00.000Z",
        quantity: -5,
        ratioNumerator: 1,
        ratioDenominator: 5,
        source: "manual",
      },
      {
        id: "reversed-original",
        accountId: "acc-1",
        ticker: "2330",
        marketCode: "TW",
        actionType: "SPLIT",
        actionDate: "2026-01-05",
        quantity: 10,
        source: "manual",
      },
      {
        id: "reversal-row",
        accountId: "acc-1",
        ticker: "2330",
        marketCode: "TW",
        actionType: "REVERSE_SPLIT",
        actionDate: "2026-01-06",
        quantity: -10,
        source: "manual",
        reversalOfPositionActionId: "reversed-original",
      },
      {
        id: "superseded-row",
        accountId: "acc-1",
        ticker: "2330",
        marketCode: "TW",
        actionType: "SPLIT",
        actionDate: "2026-01-04",
        quantity: 3,
        source: "manual",
        supersededAt: "2026-01-05T00:00:00.000Z",
      },
      {
        id: "other-account",
        accountId: "acc-2",
        ticker: "2330",
        marketCode: "TW",
        actionType: "SPLIT",
        actionDate: "2026-04-01",
        quantity: 2,
        source: "manual",
      },
      {
        id: "other-market",
        accountId: "acc-au",
        ticker: "BHP",
        marketCode: "AU",
        actionType: "SPLIT",
        actionDate: "2026-04-01",
        quantity: 2,
        source: "manual",
      },
    );

    const result = buildHoldingActivityDividends(store, {
      ticker: "2330",
      marketCode: "TW",
      scopedAccountIds: new Set(["acc-1"]),
      positionActionsPage: 1,
      positionActionsLimit: 10,
      upcomingPage: 1,
      upcomingLimit: 10,
      postedPage: 1,
      postedLimit: 10,
    });

    expect(result.positionActions.items.map((item) => item.id)).toEqual(["split-1", "stock-1", "reverse-1"]);
    expect(result.positionActions.items.map((item) => item.actionType)).toEqual([
      "SPLIT",
      "STOCK_DIVIDEND",
      "REVERSE_SPLIT",
    ]);
  });
});
