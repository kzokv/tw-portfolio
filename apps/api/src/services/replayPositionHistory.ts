import { applyBuyToLots, allocateSellLots } from "@tw-portfolio/domain";
import type { Lot } from "@tw-portfolio/domain";
import type { Persistence } from "../persistence/types.js";
import type { CashLedgerEntry, LotAllocationProjection } from "../types/store.js";
import type { EventBus } from "../events/types.js";

export interface ReplaySummary {
  accountId: string;
  symbol: string;
  updatedHoldings: {
    openQuantity: number;
    averageCost: number;
    totalRealizedPnl: number;
    totalCommission: number;
    totalTax: number;
  };
  cashBalanceChange: number;
  lotsRecalculated: number;
  affectedTradeCount: number;
}

export class ReplayError extends Error {
  constructor(
    message: string,
    public readonly failedTradeEventId: string,
  ) {
    super(message);
    this.name = "ReplayError";
  }
}

export async function replayPositionHistory(
  persistence: Persistence,
  userId: string,
  accountId: string,
  symbol: string,
): Promise<ReplaySummary> {
  // 1. Load all trade events for account+symbol, ordered by trade_date ASC, booking_sequence ASC
  const trades = await persistence.getTradeEventsForAccountSymbol(userId, accountId, symbol);

  // 2. Delete lots for account+symbol (CRITICAL — blocker from debate)
  await persistence.deleteLotsForAccountSymbol(userId, accountId, symbol);

  // 3. Delete lot_allocations for account+symbol
  await persistence.deleteLotAllocationsForAccountSymbol(userId, accountId, symbol);

  // 4. Delete TRADE_SETTLEMENT_IN/OUT cash entries for account+symbol
  await persistence.deleteTradeCashEntriesForAccountSymbol(userId, accountId, symbol);

  // 5. Replay each trade in order
  let lots: Lot[] = [];
  const allAllocations: LotAllocationProjection[] = [];
  const allCashEntries: CashLedgerEntry[] = [];
  let totalRealizedPnl = 0;
  let totalCommission = 0;
  let totalTax = 0;
  let cashBalanceChange = 0;

  for (const trade of trades) {
    // Use the trade's stored commission/tax (replay does NOT recalculate fees)
    totalCommission += trade.commissionAmount;
    totalTax += trade.taxAmount;

    if (trade.type === "BUY") {
      const lot: Lot = {
        id: `lot-${trade.id}`,
        accountId: trade.accountId,
        symbol: trade.symbol,
        openQuantity: trade.quantity,
        totalCostAmount: trade.unitPrice * trade.quantity + trade.commissionAmount + trade.taxAmount,
        costCurrency: trade.priceCurrency,
        openedAt: trade.tradeDate,
        openedSequence: trade.bookingSequence ?? 1,
      };
      const result = applyBuyToLots(lots, lot);
      lots = result.updatedLots;
    } else {
      // SELL — allocate from lots
      const openLots = lots.filter((l) => l.openQuantity > 0);
      try {
        const result = allocateSellLots(openLots, trade.quantity);
        lots = lots.map((l) => {
          const updated = result.updatedLots.find((u) => u.id === l.id);
          return updated ?? l;
        });
        // Build lot allocation projections
        const allocProjections = result.matchedAllocations.map((alloc) => ({
          id: `${trade.id}:${alloc.lotId}`,
          userId,
          accountId: trade.accountId,
          tradeEventId: trade.id,
          symbol: trade.symbol,
          lotId: alloc.lotId,
          lotOpenedAt: alloc.openedAt,
          lotOpenedSequence: alloc.openedSequence ?? 1,
          allocatedQuantity: alloc.quantity,
          allocatedCostAmount: alloc.allocatedCostAmount,
          costCurrency: alloc.costCurrency,
          createdAt: new Date().toISOString(),
        }));
        allAllocations.push(...allocProjections);

        // Derive realized PnL for this sell
        const allocatedCost = allocProjections.reduce((sum, a) => sum + a.allocatedCostAmount, 0);
        const netProceeds = trade.quantity * trade.unitPrice - trade.commissionAmount - trade.taxAmount;
        const pnl = netProceeds - allocatedCost;
        totalRealizedPnl += pnl;
      } catch (error) {
        // "Insufficient quantity to sell" — wrap with trade context
        const message = error instanceof Error ? error.message : String(error);
        throw new ReplayError(
          `Replay failed at trade ${trade.id} (${trade.type} ${trade.quantity}x${trade.symbol} on ${trade.tradeDate}): ${message}`,
          trade.id,
        );
      }
    }

    // Generate cash ledger entry (settlement)
    const grossTradeValue = trade.quantity * trade.unitPrice;
    const settlementAmount =
      trade.type === "BUY"
        ? -(grossTradeValue + trade.commissionAmount + trade.taxAmount)
        : grossTradeValue - trade.commissionAmount - trade.taxAmount;

    // Skip zero-amount entries (CHECK constraint: amount <> 0)
    if (settlementAmount !== 0) {
      allCashEntries.push({
        id: `cash-replay-${trade.id}`,
        userId,
        accountId: trade.accountId,
        entryDate: trade.tradeDate,
        entryType: trade.type === "BUY" ? "TRADE_SETTLEMENT_OUT" : "TRADE_SETTLEMENT_IN",
        amount: settlementAmount,
        currency: trade.priceCurrency,
        relatedTradeEventId: trade.id,
        sourceType: "trade_settlement",
        sourceReference: trade.id,
        bookedAt: new Date().toISOString(),
      });
      cashBalanceChange += settlementAmount;
    }
  }

  // 6. Persist replayed state
  if (lots.length > 0) {
    await persistence.bulkUpsertLots(userId, lots);
  }
  if (allAllocations.length > 0) {
    await persistence.bulkInsertLotAllocations(userId, allAllocations);
  }
  if (allCashEntries.length > 0) {
    await persistence.bulkInsertCashLedgerEntries(userId, allCashEntries);
  }

  // 7. Build summary
  const openLots = lots.filter((l) => l.openQuantity > 0);
  const openQuantity = openLots.reduce((sum, l) => sum + l.openQuantity, 0);
  const totalCost = openLots.reduce((sum, l) => sum + l.totalCostAmount, 0);
  const averageCost = openQuantity > 0 ? totalCost / openQuantity : 0;

  return {
    accountId,
    symbol,
    updatedHoldings: {
      openQuantity,
      averageCost,
      totalRealizedPnl,
      totalCommission,
      totalTax,
    },
    cashBalanceChange,
    lotsRecalculated: lots.length,
    affectedTradeCount: trades.length,
  };
}

export function scheduleReplayWithRetry(
  persistence: Persistence,
  eventBus: EventBus,
  userId: string,
  accountId: string,
  symbol: string,
): void {
  setImmediate(async () => {
    try {
      const summary = await replayPositionHistory(persistence, userId, accountId, symbol);
      await eventBus.publishEvent(userId, "recompute_complete", {
        accountId: summary.accountId,
        symbol: summary.symbol,
        updatedHoldings: summary.updatedHoldings,
        cashBalanceChange: summary.cashBalanceChange,
        lotsRecalculated: summary.lotsRecalculated,
        affectedTradeCount: summary.affectedTradeCount,
      });
    } catch (firstError) {
      const firstReason = firstError instanceof Error ? firstError.message : String(firstError);
      try {
        await eventBus.publishEvent(userId, "recompute_failed", {
          accountId,
          symbol,
          reason: firstReason,
          retriesExhausted: false,
        });
      } catch {
        // EventBus unavailable — client will hit safety net timeout
      }

      // One automatic retry
      setImmediate(async () => {
        try {
          const summary = await replayPositionHistory(persistence, userId, accountId, symbol);
          await eventBus.publishEvent(userId, "recompute_complete", {
            accountId: summary.accountId,
            symbol: summary.symbol,
            updatedHoldings: summary.updatedHoldings,
            cashBalanceChange: summary.cashBalanceChange,
            lotsRecalculated: summary.lotsRecalculated,
            affectedTradeCount: summary.affectedTradeCount,
          });
        } catch (retryError) {
          const retryReason = retryError instanceof Error ? retryError.message : String(retryError);
          try {
            await eventBus.publishEvent(userId, "recompute_failed", {
              accountId,
              symbol,
              reason: retryReason,
              retriesExhausted: true,
            });
          } catch {
            // EventBus unavailable — client will hit safety net timeout
          }
        }
      });
    }
  });
}
