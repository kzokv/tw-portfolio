import {
  applyBuyToLots,
  allocateSellLots,
  calculateBuyFees,
  calculateSellFees,
  type FeeProfile,
  type Lot,
} from "@tw-portfolio/domain";
import type { CorporateAction, Store, Transaction } from "../types/store.js";

export interface CreateTransactionInput {
  id: string;
  accountId: string;
  symbol: string;
  quantity: number;
  priceNtd: number;
  tradeDate: string;
  type: "BUY" | "SELL";
  isDayTrade: boolean;
}

export interface HoldingsRow {
  accountId: string;
  symbol: string;
  quantity: number;
  costNtd: number;
}

export function createTransaction(
  store: Store,
  userId: string,
  input: CreateTransactionInput,
): Transaction {
  const account = store.accounts.find((item) => item.id === input.accountId && item.userId === userId);
  if (!account) throw new Error("Account not found");

  const profile = resolveFeeProfileForTransaction(store, account.id, input.symbol, account.feeProfileId);
  const instrument = store.symbols.find((item) => item.ticker === input.symbol);
  if (!instrument) throw new Error("Unsupported symbol");

  const tradeValueNtd = input.quantity * input.priceNtd;
  const fees =
    input.type === "BUY"
      ? calculateBuyFees(profile, tradeValueNtd)
      : calculateSellFees(profile, {
          tradeValueNtd,
          instrumentType: instrument.type,
          isDayTrade: input.isDayTrade,
        });

  const tx: Transaction = {
    id: input.id,
    userId,
    accountId: input.accountId,
    symbol: input.symbol,
    instrumentType: instrument.type,
    type: input.type,
    quantity: input.quantity,
    priceNtd: input.priceNtd,
    tradeDate: input.tradeDate,
    commissionNtd: fees.commissionNtd,
    taxNtd: fees.taxNtd,
    isDayTrade: input.isDayTrade,
    feeSnapshot: { ...profile },
  };

  applyToLots(store, tx);
  store.transactions.push(tx);
  return tx;
}

function applyToLots(store: Store, tx: Transaction): void {
  const relevantLots = store.lots.filter((lot) => lot.accountId === tx.accountId && lot.symbol === tx.symbol);

  if (tx.type === "BUY") {
    const lot: Lot = {
      id: `lot-${tx.id}`,
      accountId: tx.accountId,
      symbol: tx.symbol,
      openQuantity: tx.quantity,
      totalCostNtd: tx.priceNtd * tx.quantity + tx.commissionNtd,
      openedAt: tx.tradeDate,
    };
    const applied = applyBuyToLots(relevantLots, lot);
    replaceLots(store, tx.accountId, tx.symbol, applied.updatedLots);
    return;
  }

  const lots = relevantLots.filter((lot) => lot.openQuantity > 0);
  const allocation = allocateSellLots(lots, tx.quantity);

  const netProceeds = tx.priceNtd * tx.quantity - tx.commissionNtd - tx.taxNtd;
  tx.realizedPnlNtd = netProceeds - allocation.allocatedCostNtd;

  replaceLots(store, tx.accountId, tx.symbol, allocation.updatedLots);
}

function mustGetFeeProfile(store: Store, profileId: string): FeeProfile {
  const profile = store.feeProfiles.find((item) => item.id === profileId);
  if (!profile) throw new Error("Fee profile missing");
  return profile;
}

function resolveFeeProfileForTransaction(
  store: Store,
  accountId: string,
  symbol: string,
  fallbackProfileId: string,
): FeeProfile {
  const symbolBinding = store.feeProfileBindings.find(
    (binding) => binding.accountId === accountId && binding.symbol === symbol,
  );

  if (symbolBinding) {
    return mustGetFeeProfile(store, symbolBinding.feeProfileId);
  }

  return mustGetFeeProfile(store, fallbackProfileId);
}

export function listHoldings(store: Store, userId: string): HoldingsRow[] {
  const accountIds = new Set(store.accounts.filter((item) => item.userId === userId).map((item) => item.id));
  const keyMap = new Map<string, HoldingsRow>();

  for (const lot of store.lots) {
    if (!accountIds.has(lot.accountId) || lot.openQuantity <= 0) continue;
    const key = `${lot.accountId}:${lot.symbol}`;
    const current = keyMap.get(key) ?? { accountId: lot.accountId, symbol: lot.symbol, quantity: 0, costNtd: 0 };
    current.quantity += lot.openQuantity;
    current.costNtd += lot.totalCostNtd;
    keyMap.set(key, current);
  }

  return [...keyMap.values()];
}

export function applyCorporateAction(store: Store, action: CorporateAction): CorporateAction {
  if (action.actionType === "DIVIDEND") {
    store.corporateActions.push(action);
    return action;
  }

  if (action.denominator <= 0 || action.numerator <= 0) {
    throw new Error("Invalid split ratio");
  }

  for (const lot of store.lots) {
    if (lot.accountId !== action.accountId || lot.symbol !== action.symbol || lot.openQuantity <= 0) continue;

    const splitRatio = action.numerator / action.denominator;
    const nextQty = Math.floor(lot.openQuantity * splitRatio);
    lot.openQuantity = nextQty;
  }

  store.corporateActions.push(action);
  return action;
}

function replaceLots(store: Store, accountId: string, symbol: string, nextLots: Lot[]): void {
  store.lots = [
    ...store.lots.filter((lot) => lot.accountId !== accountId || lot.symbol !== symbol),
    ...nextLots,
  ];
}
