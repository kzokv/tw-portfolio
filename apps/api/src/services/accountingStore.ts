import { roundToDecimal } from "@vakwen/domain";
import type { Lot } from "@vakwen/domain";
import type {
  AccountingPolicy,
  AccountingStore,
  BookedTradeEvent,
  CashLedgerEntry,
  CorporateAction,
  DividendDeductionEntry,
  DividendLedgerEntry,
  HoldingProjection,
  LotAllocationProjection,
  Store,
} from "../types/store.js";
import type { DividendSourceLine } from "@vakwen/shared-types";

export function syncAccountingPolicy(store: Store): void {
  store.accounting.policy = buildAccountingPolicy();
}

export function buildAccountingPolicy(): AccountingPolicy {
  return {
    inventoryModel: "LOT_CAPABLE",
    disposalPolicy: "WEIGHTED_AVERAGE",
  };
}

export function listTradeEvents(store: Store): BookedTradeEvent[] {
  return store.accounting.facts.tradeEvents;
}

export function appendTradeEvent(store: Store, tradeEvent: BookedTradeEvent): void {
  store.accounting.facts.tradeEvents.push(tradeEvent);
}

export function listCashLedgerEntries(store: Store): CashLedgerEntry[] {
  return store.accounting.facts.cashLedgerEntries;
}

export function appendCashLedgerEntry(store: Store, cashLedgerEntry: CashLedgerEntry): void {
  store.accounting.facts.cashLedgerEntries.push(cashLedgerEntry);
}

export function listDividendLedgerEntries(store: Store): DividendLedgerEntry[] {
  return store.accounting.facts.dividendLedgerEntries;
}

export function appendDividendLedgerEntry(store: Store, dividendLedgerEntry: DividendLedgerEntry): void {
  store.accounting.facts.dividendLedgerEntries.push(dividendLedgerEntry);
}

export function listDividendDeductionEntries(store: Store): DividendDeductionEntry[] {
  return store.accounting.facts.dividendDeductionEntries;
}

export function appendDividendDeductionEntry(store: Store, dividendDeductionEntry: DividendDeductionEntry): void {
  store.accounting.facts.dividendDeductionEntries.push(dividendDeductionEntry);
}

export function listDividendSourceLines(store: Store): DividendSourceLine[] {
  return store.accounting.facts.dividendSourceLines;
}

export function replaceDividendSourceLinesForLedger(
  store: Store,
  dividendLedgerEntryId: string,
  nextDividendSourceLines: DividendSourceLine[],
): void {
  store.accounting.facts.dividendSourceLines = [
    ...store.accounting.facts.dividendSourceLines.filter((entry) => entry.dividendLedgerEntryId !== dividendLedgerEntryId),
    ...nextDividendSourceLines,
  ];
}

export function replaceCashLedgerEntriesForDividend(
  store: Store,
  dividendLedgerEntryId: string,
  nextCashLedgerEntries: CashLedgerEntry[],
): void {
  store.accounting.facts.cashLedgerEntries = [
    ...store.accounting.facts.cashLedgerEntries.filter(
      (entry) => entry.relatedDividendLedgerEntryId !== dividendLedgerEntryId,
    ),
    ...nextCashLedgerEntries,
  ];
}

export function replaceDividendDeductionsForLedger(
  store: Store,
  dividendLedgerEntryId: string,
  nextDividendDeductions: DividendDeductionEntry[],
): void {
  store.accounting.facts.dividendDeductionEntries = [
    ...store.accounting.facts.dividendDeductionEntries.filter(
      (entry) => entry.dividendLedgerEntryId !== dividendLedgerEntryId,
    ),
    ...nextDividendDeductions,
  ];
}

export function replaceCashLedgerEntryForTrade(
  store: Store,
  tradeEventId: string,
  nextCashLedgerEntry: CashLedgerEntry,
): void {
  store.accounting.facts.cashLedgerEntries = [
    ...store.accounting.facts.cashLedgerEntries.filter((entry) => entry.relatedTradeEventId !== tradeEventId),
    nextCashLedgerEntry,
  ];
}

export function listLotAllocations(store: Store): LotAllocationProjection[] {
  return store.accounting.projections.lotAllocations;
}

export function replaceLotAllocationsForTrade(
  store: Store,
  tradeEventId: string,
  nextLotAllocations: LotAllocationProjection[],
): void {
  store.accounting.projections.lotAllocations = [
    ...store.accounting.projections.lotAllocations.filter((allocation) => allocation.tradeEventId !== tradeEventId),
    ...nextLotAllocations,
  ];
}

export function deriveRealizedPnlForTrade(
  accounting: AccountingStore,
  tradeOrTradeEventId: BookedTradeEvent | string,
): number | undefined {
  const trade =
    typeof tradeOrTradeEventId === "string"
      ? accounting.facts.tradeEvents.find((item) => item.id === tradeOrTradeEventId)
      : tradeOrTradeEventId;
  if (!trade || trade.type !== "SELL") {
    return undefined;
  }

  const allocations = accounting.projections.lotAllocations.filter((allocation) => allocation.tradeEventId === trade.id);
  if (allocations.length === 0) {
    return undefined;
  }

  const allocatedCostAmount = allocations.reduce((sum, allocation) => sum + allocation.allocatedCostAmount, 0);
  const netProceeds = roundToDecimal(trade.quantity * trade.unitPrice, 2) - trade.commissionAmount - trade.taxAmount;
  return roundToDecimal(netProceeds - allocatedCostAmount, 2);
}

export function syncTradeEventRealizedPnl(accounting: AccountingStore): void {
  for (const trade of accounting.facts.tradeEvents) {
    trade.realizedPnlAmount = deriveRealizedPnlForTrade(accounting, trade);
    trade.realizedPnlCurrency =
      trade.realizedPnlAmount === undefined
        ? undefined
        : (trade.priceCurrency ?? trade.feeSnapshot.commissionCurrency ?? "TWD");
  }
}

export function listInventoryLots(store: Store): Lot[] {
  return store.accounting.projections.lots;
}

export function replaceInventoryLots(store: Store, accountId: string, ticker: string, nextLots: Lot[]): void {
  store.accounting.projections.lots = [
    ...store.accounting.projections.lots.filter((lot) => lot.accountId !== accountId || lot.ticker !== ticker),
    ...nextLots,
  ];
  rebuildHoldingProjection(store);
}

export function listCorporateActions(store: Store): CorporateAction[] {
  return store.accounting.facts.corporateActions;
}

export function appendCorporateAction(store: Store, action: CorporateAction): void {
  store.accounting.facts.corporateActions.push(action);
}

export function upsertDividendLedgerEntry(store: Store, dividendLedgerEntry: DividendLedgerEntry): void {
  store.accounting.facts.dividendLedgerEntries = [
    ...store.accounting.facts.dividendLedgerEntries.filter((entry) => entry.id !== dividendLedgerEntry.id),
    dividendLedgerEntry,
  ].sort((left, right) => {
    const leftBookedAt = left.bookedAt ?? "";
    const rightBookedAt = right.bookedAt ?? "";
    return left.accountId.localeCompare(right.accountId) || leftBookedAt.localeCompare(rightBookedAt) || left.id.localeCompare(right.id);
  });
}

export function rebuildHoldingProjection(store: Store): HoldingProjection[] {
  const keyMap = new Map<string, HoldingProjection>();

  for (const lot of store.accounting.projections.lots) {
    if (lot.openQuantity <= 0) continue;
    const key = `${lot.accountId}:${lot.ticker}`;
    const current = keyMap.get(key) ?? {
      accountId: lot.accountId,
      ticker: lot.ticker,
      quantity: 0,
      costBasisAmount: 0,
      currency: lot.costCurrency,
    };
    current.quantity += lot.openQuantity;
    current.costBasisAmount += lot.totalCostAmount;
    keyMap.set(key, current);
  }

  store.accounting.projections.holdings = [...keyMap.values()].map((holding) => ({
    ...holding,
    costBasisAmount: roundToDecimal(holding.costBasisAmount, 2),
  }));
  return store.accounting.projections.holdings;
}
