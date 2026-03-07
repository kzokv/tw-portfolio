import type { Lot } from "@tw-portfolio/domain";
import type {
  AccountingPolicy,
  BookedTradeEvent,
  CashLedgerEntry,
  CorporateAction,
  HoldingProjection,
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
