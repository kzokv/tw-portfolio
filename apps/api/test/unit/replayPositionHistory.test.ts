import { describe, expect, it, vi } from "vitest";
import { replayPositionHistory } from "../../src/services/replayPositionHistory.js";
import { MemoryPersistence } from "../../src/persistence/memory.js";
import type { Persistence } from "../../src/persistence/types.js";
import type { BookedTradeEvent, DividendEvent, DividendLedgerEntry, LotAllocationProjection, PositionAction } from "../../src/types/store.js";
import type { Lot, MarketCode } from "@vakwen/domain";

describe("replayPositionHistory", () => {
  it("passes marketCode through replay persistence boundaries", async () => {
    const persistence = {
      getTradeEventsForAccountTicker: vi.fn().mockResolvedValue([]),
      getPositionActionsForAccountTicker: vi.fn().mockResolvedValue([]),
      deleteLotsForAccountTicker: vi.fn().mockResolvedValue(0),
      deleteLotAllocationsForAccountTicker: vi.fn().mockResolvedValue(0),
      deleteTradeCashEntriesForAccountTicker: vi.fn().mockResolvedValue(0),
      loadStore: vi.fn().mockResolvedValue({
        accounting: {
          facts: {
            dividendLedgerEntries: [],
          },
        },
        marketData: {
          dividendEvents: [],
        },
      }),
    } as unknown as Persistence;

    const summary = await replayPositionHistory(
      persistence,
      "user-1",
      "acc-1",
      "BHP",
      { marketCode: "AU", deletedTradeEventIds: ["trade-deleted"] },
    );

    expect(persistence.getTradeEventsForAccountTicker).toHaveBeenCalledWith("user-1", "acc-1", "BHP", "AU");
    expect(persistence.getPositionActionsForAccountTicker).toHaveBeenCalledWith("user-1", "acc-1", "BHP", "AU");
    expect(persistence.deleteLotsForAccountTicker).toHaveBeenCalledWith("user-1", "acc-1", "BHP", "AU", ["trade-deleted"]);
    expect(persistence.deleteLotAllocationsForAccountTicker).toHaveBeenCalledWith("user-1", "acc-1", "BHP", "AU", ["trade-deleted"]);
    expect(persistence.deleteTradeCashEntriesForAccountTicker).toHaveBeenCalledWith("user-1", "acc-1", "BHP", "AU", ["trade-deleted"]);
    expect(summary.affectedTradeCount).toBe(0);
  });

  it("removes stock-dividend lots during market-scoped replay cleanup", async () => {
    const persistence = new MemoryPersistence();
    const userId = "user-1";
    const store = await persistence.loadStore(userId);
    const accountId = store.accounts[0]!.id;

    const trade: BookedTradeEvent = {
      id: "trade-au",
      userId,
      accountId,
      ticker: "BHP",
      marketCode: "AU",
      instrumentType: "STOCK",
      type: "BUY",
      quantity: 10,
      unitPrice: 100,
      priceCurrency: "AUD",
      tradeDate: "2026-01-02",
      commissionAmount: 0,
      taxAmount: 0,
      isDayTrade: false,
      bookingSequence: 1,
      feeSnapshot: store.feeProfiles[0]!,
    };
    store.accounting.facts.tradeEvents.push(trade);

    const auDividendEvent = makeStockDividendEvent("div-au", "AU", "AUD");
    const usDividendEvent = makeStockDividendEvent("div-us", "US", "USD");
    store.marketData.dividendEvents.push(auDividendEvent, usDividendEvent);
    store.accounting.facts.dividendLedgerEntries.push(
      makeDividendLedgerEntry(accountId, auDividendEvent.id, "dle-au"),
      makeDividendLedgerEntry(accountId, usDividendEvent.id, "dle-us"),
    );
    store.accounting.facts.positionActions.push(
      makeStockDividendAction(accountId, "BHP", "AU", "dle-au"),
      makeStockDividendAction(accountId, "BHP", "US", "dle-us"),
    );

    store.accounting.projections.lots.push(
      makeLot("lot-trade-au", accountId),
      makeLot("lot-pa-position-action-dle-au", accountId),
      makeLot("lot-pa-position-action-dle-us", accountId),
    );
    store.accounting.projections.lotAllocations.push(
      makeAllocation("alloc-trade", userId, accountId, trade.id, "lot-trade-au"),
      makeAllocation("alloc-dividend", userId, accountId, trade.id, "lot-pa-position-action-dle-au"),
      makeAllocation("alloc-other-market", userId, accountId, "trade-us", "lot-pa-position-action-dle-us"),
    );

    const deletedLots = await persistence.deleteLotsForAccountTicker(userId, accountId, "BHP", "AU");
    const deletedAllocations = await persistence.deleteLotAllocationsForAccountTicker(userId, accountId, "BHP", "AU");

    expect(deletedLots).toBe(2);
    expect(deletedAllocations).toBe(2);
    expect(store.accounting.projections.lots.map((lot) => lot.id)).toEqual(["lot-pa-position-action-dle-us"]);
    expect(store.accounting.projections.lotAllocations.map((allocation) => allocation.id)).toEqual(["alloc-other-market"]);
  });

  it("recomputes only dividend ledger entries in the replayed market", async () => {
    const persistence = new MemoryPersistence();
    const userId = "user-1";
    const store = await persistence.loadStore(userId);
    const accountId = store.accounts[0]!.id;

    store.accounting.facts.tradeEvents.push(
      makeTradeEvent("trade-au", userId, accountId, "AU", "AUD", 10),
      makeTradeEvent("trade-us", userId, accountId, "US", "USD", 20),
    );

    const auDividendEvent = makeCashDividendEvent("cash-au", "AU", "USD");
    const usDividendEvent = makeCashDividendEvent("cash-us", "US", "USD");
    store.marketData.dividendEvents.push(auDividendEvent, usDividendEvent);
    store.accounting.facts.dividendLedgerEntries.push(
      makeDividendLedgerEntry(accountId, auDividendEvent.id, "dle-au", { eligibleQuantity: 0, expectedCashAmount: 0 }),
      makeDividendLedgerEntry(accountId, usDividendEvent.id, "dle-us", { eligibleQuantity: 20, expectedCashAmount: 30 }),
    );

    const summary = await replayPositionHistory(
      persistence,
      userId,
      accountId,
      "BHP",
      { marketCode: "AU" },
    );

    expect(summary.dividendLedgerChanges.map((change) => change.ledgerEntryId)).toEqual(["dle-au"]);

    const updatedStore = await persistence.loadStore(userId);
    const auEntry = updatedStore.accounting.facts.dividendLedgerEntries.find((entry) => entry.id === "dle-au");
    const usEntry = updatedStore.accounting.facts.dividendLedgerEntries.find((entry) => entry.id === "dle-us");
    expect(auEntry).toMatchObject({
      eligibleQuantity: 10,
      expectedCashAmount: 15,
    });
    expect(usEntry).toMatchObject({
      eligibleQuantity: 20,
      expectedCashAmount: 30,
    });
  });

  it("recomputes dividend eligibility from replayed position actions before the ex-date", async () => {
    const persistence = new MemoryPersistence();
    const userId = "user-1";
    const store = await persistence.loadStore(userId);
    const accountId = store.accounts[0]!.id;

    store.accounting.facts.tradeEvents.push(
      makeTradeEvent("trade-before-split", userId, accountId, "TW", "TWD", 10),
    );
    store.accounting.facts.positionActions.push({
      id: "split-before-dividend",
      accountId,
      ticker: "BHP",
      marketCode: "TW",
      actionType: "SPLIT",
      actionDate: "2026-01-10",
      quantity: 0,
      ratioNumerator: 2,
      ratioDenominator: 1,
      source: "test",
    });

    const dividendEvent = makeCashDividendEvent("cash-after-split", "TW", "TWD");
    store.marketData.dividendEvents.push(dividendEvent);
    store.accounting.facts.dividendLedgerEntries.push(
      makeDividendLedgerEntry(accountId, dividendEvent.id, "dle-after-split", {
        eligibleQuantity: 10,
        expectedCashAmount: 15,
      }),
    );

    const summary = await replayPositionHistory(
      persistence,
      userId,
      accountId,
      "BHP",
      { marketCode: "TW" },
    );

    expect(summary.dividendLedgerChanges).toEqual([
      expect.objectContaining({
        ledgerEntryId: "dle-after-split",
        previousEligibleQuantity: 10,
        nextEligibleQuantity: 20,
        previousExpectedCashAmount: 15,
        nextExpectedCashAmount: 30,
      }),
    ]);

    const updatedStore = await persistence.loadStore(userId);
    const updatedEntry = updatedStore.accounting.facts.dividendLedgerEntries.find((entry) => entry.id === "dle-after-split");
    expect(updatedEntry).toMatchObject({
      eligibleQuantity: 20,
      expectedCashAmount: 30,
    });
  });

  it("orders same-day position actions before trades when either side lacks a timestamp", async () => {
    const persistence = new MemoryPersistence();
    const userId = "user-1";
    const store = await persistence.loadStore(userId);
    const accountId = store.accounts[0]!.id;

    store.accounting.facts.tradeEvents.push(
      makeTradeEvent("same-day-buy", userId, accountId, "TW", "TWD", 10),
      {
        ...makeTradeEvent("same-day-sell", userId, accountId, "TW", "TWD", 15),
        type: "SELL",
        tradeDate: "2026-01-03",
        bookingSequence: 2,
      },
    );
    store.accounting.facts.positionActions.push({
      id: "same-day-split",
      accountId,
      ticker: "BHP",
      marketCode: "TW",
      actionType: "SPLIT",
      actionDate: "2026-01-03",
      actionTimestamp: "2026-01-03T09:00:00.000Z",
      quantity: 0,
      ratioNumerator: 2,
      ratioDenominator: 1,
      source: "test",
    });

    const summary = await replayPositionHistory(persistence, userId, accountId, "BHP", { marketCode: "TW" });

    expect(summary.updatedHoldings.openQuantity).toBe(5);
    const updatedStore = await persistence.loadStore(userId);
    expect(updatedStore.accounting.projections.lotAllocations).toEqual([
      expect.objectContaining({
        tradeEventId: "same-day-sell",
        allocatedQuantity: 15,
        allocatedCostAmount: 750,
      }),
    ]);
  });

  it("cleans up legacy stock-dividend lot ids during market-scoped replay", async () => {
    const persistence = new MemoryPersistence();
    const userId = "user-1";
    const store = await persistence.loadStore(userId);
    const accountId = store.accounts[0]!.id;
    const dividendEvent = makeStockDividendEvent("legacy-div", "TW", "TWD");
    const dividendLedgerEntry = makeDividendLedgerEntry(accountId, dividendEvent.id, "legacy-dle");
    store.marketData.dividendEvents.push(dividendEvent);
    store.accounting.facts.dividendLedgerEntries.push(dividendLedgerEntry);
    store.accounting.facts.positionActions.push(makeStockDividendAction(accountId, "BHP", "TW", dividendLedgerEntry.id));
    store.accounting.projections.lots.push(
      makeLot(`lot-${dividendLedgerEntry.id}`, accountId),
      makeLot(`lot-pa-position-action-${dividendLedgerEntry.id}`, accountId),
    );
    store.accounting.projections.lotAllocations.push(
      makeAllocation("legacy-allocation", userId, accountId, "legacy-sell", `lot-${dividendLedgerEntry.id}`),
    );

    const deletedLots = await persistence.deleteLotsForAccountTicker(userId, accountId, "BHP", "TW");
    const deletedAllocations = await persistence.deleteLotAllocationsForAccountTicker(userId, accountId, "BHP", "TW");

    expect(deletedLots).toBe(2);
    expect(deletedAllocations).toBe(1);
    expect(store.accounting.projections.lots).toEqual([]);
    expect(store.accounting.projections.lotAllocations).toEqual([]);
  });

  it("uses the action market currency for stock-dividend lots without cash-in-lieu", async () => {
    const persistence = new MemoryPersistence();
    const userId = "user-1";
    const store = await persistence.loadStore(userId);
    const accountId = store.accounts[0]!.id;

    store.accounting.facts.positionActions.push(
      makeStockDividendAction(accountId, "BHP", "AU", "dle-au"),
    );

    await replayPositionHistory(persistence, userId, accountId, "BHP", { marketCode: "AU" });

    const updatedStore = await persistence.loadStore(userId);
    expect(updatedStore.accounting.projections.lots).toEqual([
      expect.objectContaining({
        id: "lot-pa-position-action-dle-au",
        costCurrency: "AUD",
      }),
    ]);
  });
});

function makeTradeEvent(
  id: string,
  userId: string,
  accountId: string,
  marketCode: MarketCode,
  priceCurrency: BookedTradeEvent["priceCurrency"],
  quantity: number,
): BookedTradeEvent {
  return {
    id,
    userId,
    accountId,
    ticker: "BHP",
    marketCode,
    instrumentType: "STOCK",
    type: "BUY",
    quantity,
    unitPrice: 100,
    priceCurrency,
    tradeDate: "2026-01-02",
    commissionAmount: 0,
    taxAmount: 0,
    isDayTrade: false,
    bookingSequence: 1,
    feeSnapshot: {
      id: `fee-${id}`,
      accountId,
      name: "Default",
      boardCommissionRate: 0,
      commissionDiscountPercent: 0,
      minimumCommissionAmount: 0,
      commissionCurrency: priceCurrency,
      commissionRoundingMode: "FLOOR",
      taxRoundingMode: "FLOOR",
      stockSellTaxRateBps: 0,
      stockDayTradeTaxRateBps: 0,
      etfSellTaxRateBps: 0,
      bondEtfSellTaxRateBps: 0,
      commissionChargeMode: "CHARGED_UPFRONT",
    },
  };
}

function makeStockDividendEvent(
  id: string,
  marketCode: MarketCode,
  cashDividendCurrency: DividendEvent["cashDividendCurrency"],
): DividendEvent & { marketCode: MarketCode } {
  return {
    id,
    ticker: "BHP",
    marketCode,
    eventType: "STOCK",
    exDividendDate: "2026-01-15",
    paymentDate: "2026-01-31",
    cashDividendPerShare: 0,
    cashDividendCurrency,
    stockDividendPerShare: 0.1,
    source: "test",
  };
}

function makeCashDividendEvent(
  id: string,
  marketCode: MarketCode,
  cashDividendCurrency: DividendEvent["cashDividendCurrency"],
): DividendEvent & { marketCode: MarketCode } {
  return {
    id,
    ticker: "BHP",
    marketCode,
    eventType: "CASH",
    exDividendDate: "2026-01-15",
    paymentDate: "2026-01-31",
    cashDividendPerShare: 1.5,
    cashDividendCurrency,
    stockDividendPerShare: 0,
    source: "test",
  };
}

function makeDividendLedgerEntry(
  accountId: string,
  dividendEventId: string,
  id: string,
  overrides: Partial<DividendLedgerEntry> = {},
): DividendLedgerEntry {
  return {
    id,
    accountId,
    dividendEventId,
    eligibleQuantity: 10,
    expectedCashAmount: 0,
    expectedStockQuantity: 1,
    receivedCashAmount: 0,
    receivedStockQuantity: 1,
    postingStatus: "posted",
    reconciliationStatus: "open",
    version: 1,
    sourceCompositionStatus: "unknown_pending_disclosure",
    bookedAt: "2026-01-31T00:00:00.000Z",
    ...overrides,
  };
}

function makeStockDividendAction(
  accountId: string,
  ticker: string,
  marketCode: MarketCode,
  dividendLedgerEntryId: string,
): PositionAction {
  return {
    id: `position-action-${dividendLedgerEntryId}`,
    accountId,
    ticker,
    marketCode,
    actionType: "STOCK_DIVIDEND",
    actionDate: "2026-01-31",
    actionTimestamp: "2026-01-31T00:00:00.000Z",
    bookedAt: "2026-01-31T00:00:00.000Z",
    quantity: 1,
    source: "test",
    sourceReference: dividendLedgerEntryId,
    relatedDividendLedgerEntryId: dividendLedgerEntryId,
  };
}

function makeLot(id: string, accountId: string): Lot {
  return {
    id,
    accountId,
    ticker: "BHP",
    openQuantity: 1,
    totalCostAmount: 100,
    costCurrency: "AUD",
    openedAt: "2026-01-31",
    openedSequence: 1,
  };
}

function makeAllocation(
  id: string,
  userId: string,
  accountId: string,
  tradeEventId: string,
  lotId: string,
): LotAllocationProjection {
  return {
    id,
    userId,
    accountId,
    tradeEventId,
    ticker: "BHP",
    lotId,
    lotOpenedAt: "2026-01-31",
    lotOpenedSequence: 1,
    allocatedQuantity: 1,
    allocatedCostAmount: 100,
    costCurrency: "AUD",
    createdAt: "2026-01-31T00:00:00.000Z",
  };
}
