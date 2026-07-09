import { allocateSellLots, applyBuyToLots, roundToDecimal, type Lot } from "@vakwen/domain";
import type { RealizedPnlBreakdownDto, RealizedPnlBreakdownUnavailableReason } from "@vakwen/shared-types";
import type { AccountingStore, PositionAction, Transaction } from "../types/store.js";

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
  const actionsByBucket = new Map<string, PositionAction[]>();
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
  for (const action of accounting.facts.positionActions) {
    const key = transactionBucketKey(action);
    const bucket = actionsByBucket.get(key);
    if (bucket) {
      bucket.push(action);
    } else {
      actionsByBucket.set(key, [action]);
    }
  }
  for (const bucket of actionsByBucket.values()) {
    bucket.sort(comparePositionActionsForReplay);
  }

  return (trade) => buildRealizedPnlBreakdownFromBuckets(accounting, trade, tradesByBucket, actionsByBucket);
}

function buildRealizedPnlBreakdownFromBuckets(
  accounting: AccountingStore,
  trade: Transaction,
  tradesByBucket: ReadonlyMap<string, Transaction[]>,
  actionsByBucket: ReadonlyMap<string, PositionAction[]>,
): RealizedPnlBreakdownDto | null {
  if (trade.type !== "SELL") {
    return null;
  }

  if (accounting.policy.disposalPolicy !== "WEIGHTED_AVERAGE") {
    return unavailable(trade.priceCurrency, "unsupported_cost_basis_method");
  }

  const relevantTrades = tradesByBucket.get(transactionBucketKey(trade)) ?? [];
  const relevantActions = actionsByBucket.get(transactionBucketKey(trade)) ?? [];
  const timeline = [...relevantTrades.map((entry) => ({ kind: "trade" as const, trade: entry })), ...relevantActions.map((entry) => ({ kind: "action" as const, action: entry }))]
    .sort(compareReplayTimelineEntries);

  let lots: Lot[] = [];
  for (const entry of timeline) {
    if (entry.kind === "trade" && entry.trade.id === trade.id) {
      return replayTargetSell(accounting, lots, entry.trade);
    }

    if (entry.kind === "action") {
      lots = applyHistoricalPositionAction(lots, entry.action);
    } else {
      const step = applyHistoricalTrade(lots, entry.trade);
      if (step.reason) {
        return unavailable(trade.priceCurrency, step.reason);
      }
      lots = step.lots;
    }
  }

  return unavailable(trade.priceCurrency, "unknown");
}

function transactionBucketKey(entry: Pick<Transaction, "accountId" | "ticker" | "marketCode"> | Pick<PositionAction, "accountId" | "ticker" | "marketCode">): string {
  return `${entry.accountId}\u0000${entry.marketCode}\u0000${entry.ticker}`;
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

function applyHistoricalPositionAction(lots: Lot[], action: PositionAction): Lot[] {
  if (action.reversalOfPositionActionId || action.supersededAt) {
    return lots;
  }
  if (action.actionType === "STOCK_DIVIDEND") {
    return applyBuyToLots(lots, {
      id: `lot-pa-${action.id}`,
      accountId: action.accountId,
      ticker: action.ticker,
      openQuantity: action.quantity,
      totalCostAmount: 0,
      costCurrency: action.cashInLieuCurrency ?? "TWD",
      openedAt: action.actionDate,
      openedSequence: 1,
    }).updatedLots;
  }
  const numerator = action.ratioNumerator ?? 1;
  const denominator = action.ratioDenominator ?? 1;
  const ratio = numerator / denominator;
  return lots.map((lot) => {
    if (lot.accountId !== action.accountId || lot.ticker !== action.ticker) {
      return lot;
    }
    const adjustedQuantity = lot.openQuantity * ratio;
    const retainedQuantity = Math.floor(adjustedQuantity);
    const hasFractionalQuantity = adjustedQuantity !== retainedQuantity;
    return {
      ...lot,
      openQuantity: hasFractionalQuantity ? retainedQuantity : adjustedQuantity,
    };
  });
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

function comparePositionActionsForReplay(left: PositionAction, right: PositionAction): number {
  return (
    left.actionDate.localeCompare(right.actionDate)
    || (left.actionTimestamp ?? "").localeCompare(right.actionTimestamp ?? "")
    || (left.bookedAt ?? "").localeCompare(right.bookedAt ?? "")
    || left.id.localeCompare(right.id)
  );
}

type ReplayTimelineEntry =
  | { kind: "trade"; trade: Transaction }
  | { kind: "action"; action: PositionAction };

function compareReplayTimelineEntries(left: ReplayTimelineEntry, right: ReplayTimelineEntry): number {
  const leftDate = left.kind === "trade" ? left.trade.tradeDate : left.action.actionDate;
  const rightDate = right.kind === "trade" ? right.trade.tradeDate : right.action.actionDate;
  if (leftDate !== rightDate) return leftDate.localeCompare(rightDate);

  const leftTimestamp = left.kind === "trade" ? left.trade.tradeTimestamp ?? null : left.action.actionTimestamp ?? null;
  const rightTimestamp = right.kind === "trade" ? right.trade.tradeTimestamp ?? null : right.action.actionTimestamp ?? null;
  if (leftTimestamp && rightTimestamp && leftTimestamp !== rightTimestamp) {
    return leftTimestamp.localeCompare(rightTimestamp);
  }
  if (left.kind !== right.kind && (!leftTimestamp || !rightTimestamp)) {
    return left.kind === "action" ? -1 : 1;
  }

  if (left.kind === "trade" && right.kind === "trade") return compareTradesForReplay(left.trade, right.trade);
  if (left.kind === "action" && right.kind === "action") return comparePositionActionsForReplay(left.action, right.action);
  return left.kind === "action" ? -1 : 1;
}
