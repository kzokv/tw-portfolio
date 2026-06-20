import { allocateSellLots, applyBuyToLots, roundToDecimal, type Lot } from "@vakwen/domain";
import type { RealizedPnlBreakdownDto, RealizedPnlBreakdownUnavailableReason } from "@vakwen/shared-types";
import type { AccountingStore, Transaction } from "../types/store.js";

export function buildRealizedPnlBreakdown(
  accounting: AccountingStore,
  trade: Transaction,
): RealizedPnlBreakdownDto | null {
  return createRealizedPnlBreakdownResolver(accounting)(trade);
}

export function createRealizedPnlBreakdownResolver(
  accounting: AccountingStore,
): (trade: Transaction) => RealizedPnlBreakdownDto | null {
  const tradesByBucket = new Map<string, Transaction[]>();
  for (const trade of accounting.facts.tradeEvents) {
    const key = transactionBucketKey(trade);
    const bucket = tradesByBucket.get(key);
    if (bucket) {
      bucket.push(trade);
    } else {
      tradesByBucket.set(key, [trade]);
    }
  }
  for (const bucket of tradesByBucket.values()) {
    bucket.sort(compareTradesForReplay);
  }

  return (trade) => buildRealizedPnlBreakdownFromBuckets(accounting, trade, tradesByBucket);
}

function buildRealizedPnlBreakdownFromBuckets(
  accounting: AccountingStore,
  trade: Transaction,
  tradesByBucket: ReadonlyMap<string, Transaction[]>,
): RealizedPnlBreakdownDto | null {
  if (trade.type !== "SELL") {
    return null;
  }

  if (accounting.policy.disposalPolicy !== "WEIGHTED_AVERAGE") {
    return unavailable(trade.priceCurrency, "unsupported_cost_basis_method");
  }

  if (hasRelevantCorporateActionBeforeSell(accounting, trade)) {
    return unavailable(trade.priceCurrency, "unknown");
  }

  const relevantTrades = tradesByBucket.get(transactionBucketKey(trade)) ?? [];

  let lots: Lot[] = [];
  for (const entry of relevantTrades) {
    if (entry.id === trade.id) {
      return replayTargetSell(accounting, lots, entry);
    }

    const step = applyHistoricalTrade(lots, entry);
    if (step.reason) {
      return unavailable(trade.priceCurrency, step.reason);
    }
    lots = step.lots;
  }

  return unavailable(trade.priceCurrency, "unknown");
}

function transactionBucketKey(trade: Pick<Transaction, "accountId" | "ticker" | "marketCode">): string {
  return `${trade.accountId}\u0000${trade.marketCode}\u0000${trade.ticker}`;
}

function applyHistoricalTrade(
  lots: Lot[],
  trade: Transaction,
): { lots: Lot[]; reason: RealizedPnlBreakdownUnavailableReason | null } {
  if (hasCurrencyMismatch(lots, trade.priceCurrency)) {
    return { lots, reason: "currency_mismatch" };
  }

  try {
    if (trade.type === "BUY") {
      const nextLot: Lot = {
        id: `breakdown-${trade.id}`,
        accountId: trade.accountId,
        ticker: trade.ticker,
        openQuantity: trade.quantity,
        totalCostAmount: roundToDecimal(trade.quantity * trade.unitPrice, 2) + trade.commissionAmount + trade.taxAmount,
        costCurrency: trade.priceCurrency,
        openedAt: trade.tradeDate,
        openedSequence: trade.bookingSequence,
      };
      return { lots: applyBuyToLots(lots, nextLot).updatedLots, reason: null };
    }

    const openLots = lots.filter((lot) => lot.openQuantity > 0);
    return { lots: allocateSellLots(openLots, trade.quantity).updatedLots, reason: null };
  } catch (error) {
    return { lots, reason: reasonForReplayError(error) };
  }
}

function replayTargetSell(accounting: AccountingStore, lots: Lot[], trade: Transaction): RealizedPnlBreakdownDto {
  if (hasCurrencyMismatch(lots, trade.priceCurrency)) {
    return unavailable(trade.priceCurrency, "currency_mismatch");
  }

  const openLots = lots.filter((lot) => lot.openQuantity > 0);
  const preSaleOpenQuantity = openLots.reduce((sum, lot) => sum + lot.openQuantity, 0);
  const preSaleOpenCostAmount = roundToDecimal(
    openLots.reduce((sum, lot) => sum + lot.totalCostAmount, 0),
    2,
  );

  try {
    const allocation = allocateSellLots(openLots, trade.quantity);
    const grossProceedsAmount = roundToDecimal(trade.quantity * trade.unitPrice, 2);
    const netProceedsAmount = roundToDecimal(grossProceedsAmount - trade.commissionAmount - trade.taxAmount, 2);
    const realizedPnlAmount = roundToDecimal(netProceedsAmount - allocation.allocatedCostAmount, 2);
    const exactAverageCostPerShare = preSaleOpenQuantity === 0 ? 0 : preSaleOpenCostAmount / preSaleOpenQuantity;
    const persistedAllocation = persistedAllocationForSell(accounting, trade);
    if (persistedAllocation) {
      if (persistedAllocation.currencyMismatch) {
        return unavailable(trade.priceCurrency, "currency_mismatch");
      }
      if (
        !sameRoundedAmount(persistedAllocation.allocatedCostAmount, allocation.allocatedCostAmount)
        || (
          trade.realizedPnlAmount !== undefined
          && !sameRoundedAmount(trade.realizedPnlAmount, realizedPnlAmount)
        )
      ) {
        return unavailable(trade.priceCurrency, "unknown");
      }
    }

    return {
      status: "available",
      currency: trade.priceCurrency,
      preSaleOpenQuantity,
      preSaleOpenCostAmount,
      exactAverageCostPerShare,
      roundedAverageCostPerShare: allocation.averageCostAmount,
      allocatedCostAmount: allocation.allocatedCostAmount,
      grossProceedsAmount,
      commissionAmount: trade.commissionAmount,
      taxAmount: trade.taxAmount,
      netProceedsAmount,
      realizedPnlAmount,
    };
  } catch (error) {
    return unavailable(trade.priceCurrency, reasonForReplayError(error));
  }
}

function persistedAllocationForSell(
  accounting: AccountingStore,
  trade: Transaction,
): { allocatedCostAmount: number; currencyMismatch: boolean } | null {
  const allocations = accounting.projections.lotAllocations.filter((allocation) => allocation.tradeEventId === trade.id);
  if (allocations.length === 0) {
    return null;
  }
  const currencies = new Set(allocations.map((allocation) => allocation.costCurrency));
  return {
    allocatedCostAmount: roundToDecimal(
      allocations.reduce((sum, allocation) => sum + allocation.allocatedCostAmount, 0),
      2,
    ),
    currencyMismatch: currencies.size !== 1 || !currencies.has(trade.priceCurrency),
  };
}

function sameRoundedAmount(left: number, right: number): boolean {
  return roundToDecimal(left, 2) === roundToDecimal(right, 2);
}

function hasCurrencyMismatch(lots: Lot[], currency: Transaction["priceCurrency"]): boolean {
  const openCurrencies = new Set(lots.filter((lot) => lot.openQuantity > 0).map((lot) => lot.costCurrency));
  if (openCurrencies.size === 0) {
    return false;
  }
  return openCurrencies.size !== 1 || !openCurrencies.has(currency);
}

function hasRelevantCorporateActionBeforeSell(accounting: AccountingStore, trade: Transaction): boolean {
  return accounting.facts.corporateActions.some((action) => (
    action.accountId === trade.accountId
    && action.ticker === trade.ticker
    && action.actionType !== "DIVIDEND"
    && action.actionDate <= trade.tradeDate
  ));
}

function reasonForReplayError(error: unknown): RealizedPnlBreakdownUnavailableReason {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("Insufficient quantity to sell")) {
    return "insufficient_quantity";
  }
  return "unknown";
}

function unavailable(
  currency: Transaction["priceCurrency"],
  reason: RealizedPnlBreakdownUnavailableReason,
): RealizedPnlBreakdownDto {
  return {
    status: "unavailable",
    currency,
    reason,
  };
}

function compareTradesForReplay(left: Transaction, right: Transaction): number {
  return (
    left.tradeDate.localeCompare(right.tradeDate)
    || (left.bookingSequence ?? 0) - (right.bookingSequence ?? 0)
    || (left.tradeTimestamp ?? "").localeCompare(right.tradeTimestamp ?? "")
    || (left.bookedAt ?? "").localeCompare(right.bookedAt ?? "")
    || left.id.localeCompare(right.id)
  );
}
