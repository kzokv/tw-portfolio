import type { Lot } from "@tw-portfolio/domain";
import type {
  AccountingPolicy,
  AccountingStore,
  BookedTradeEvent,
  CashLedgerEntry,
  CorporateAction,
  HoldingProjection,
  LotAllocationProjection,
  Store,
} from "../types/store.js";

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

  const allocatedCostNtd = allocations.reduce((sum, allocation) => sum + allocation.allocatedCostNtd, 0);
  const netProceeds = trade.quantity * trade.priceNtd - trade.commissionNtd - trade.taxNtd;
  return netProceeds - allocatedCostNtd;
}

export function syncTradeEventRealizedPnl(accounting: AccountingStore): void {
  for (const trade of accounting.facts.tradeEvents) {
    trade.realizedPnlNtd = deriveRealizedPnlForTrade(accounting, trade);
  }
}

export function listInventoryLots(store: Store): Lot[] {
  return store.accounting.projections.lots;
}

export function replaceInventoryLots(store: Store, accountId: string, symbol: string, nextLots: Lot[]): void {
  store.accounting.projections.lots = [
    ...store.accounting.projections.lots.filter((lot) => lot.accountId !== accountId || lot.symbol !== symbol),
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

export function rebuildHoldingProjection(store: Store): HoldingProjection[] {
  const keyMap = new Map<string, HoldingProjection>();

  for (const lot of store.accounting.projections.lots) {
    if (lot.openQuantity <= 0) continue;
    const key = `${lot.accountId}:${lot.symbol}`;
    const current = keyMap.get(key) ?? { accountId: lot.accountId, symbol: lot.symbol, quantity: 0, costNtd: 0 };
    current.quantity += lot.openQuantity;
    current.costNtd += lot.totalCostNtd;
    keyMap.set(key, current);
  }

  store.accounting.projections.holdings = [...keyMap.values()];
  return store.accounting.projections.holdings;
}
