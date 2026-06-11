import { describe, expect, it, vi } from "vitest";
import { replayPositionHistory } from "../../src/services/replayPositionHistory.js";
import { MemoryPersistence } from "../../src/persistence/memory.js";
import type { Persistence } from "../../src/persistence/types.js";
import type { BookedTradeEvent, DividendEvent, DividendLedgerEntry, LotAllocationProjection } from "../../src/types/store.js";
import type { Lot, MarketCode } from "@vakwen/domain";

describe("replayPositionHistory", () => {
  it("passes marketCode through replay persistence boundaries", async () => {
    const persistence = {
      getTradeEventsForAccountTicker: vi.fn().mockResolvedValue([]),
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

    store.accounting.projections.lots.push(
      makeLot("lot-trade-au", accountId),
      makeLot("lot-dle-au", accountId),
      makeLot("lot-dle-us", accountId),
    );
    store.accounting.projections.lotAllocations.push(
      makeAllocation("alloc-trade", userId, accountId, trade.id, "lot-trade-au"),
      makeAllocation("alloc-dividend", userId, accountId, trade.id, "lot-dle-au"),
      makeAllocation("alloc-other-market", userId, accountId, "trade-us", "lot-dle-us"),
    );

    const deletedLots = await persistence.deleteLotsForAccountTicker(userId, accountId, "BHP", "AU");
    const deletedAllocations = await persistence.deleteLotAllocationsForAccountTicker(userId, accountId, "BHP", "AU");

    expect(deletedLots).toBe(2);
    expect(deletedAllocations).toBe(2);
    expect(store.accounting.projections.lots.map((lot) => lot.id)).toEqual(["lot-dle-us"]);
    expect(store.accounting.projections.lotAllocations.map((allocation) => allocation.id)).toEqual(["alloc-other-market"]);
  });
});

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

function makeDividendLedgerEntry(accountId: string, dividendEventId: string, id: string): DividendLedgerEntry {
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
