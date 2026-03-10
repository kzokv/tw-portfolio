import {
  applyBuyToLots,
  allocateSellLots,
  calculateBuyFees,
  calculateSellFees,
  type FeeProfile,
  type Lot,
} from "@tw-portfolio/domain";
import {
  appendCashLedgerEntry,
  appendCorporateAction,
  appendTradeEvent,
  deriveRealizedPnlForTrade,
  listInventoryLots,
  listTradeEvents,
  rebuildHoldingProjection,
  replaceLotAllocationsForTrade,
  replaceInventoryLots,
} from "./accountingStore.js";
import type {
  BookedTradeEvent,
  CashLedgerEntry,
  CorporateAction,
  LotAllocationProjection,
  Store,
  Transaction,
} from "../types/store.js";

export interface CreateTransactionInput {
  id: string;
  accountId: string;
  symbol: string;
  quantity: number;
  priceNtd: number;
  tradeDate: string;
  tradeTimestamp?: string;
  bookingSequence?: number;
  commissionNtd?: number;
  taxNtd?: number;
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
  assertTradeTimestampMatchesTradeDate(input.tradeDate, input.tradeTimestamp);
  assertBookedCharge(input.commissionNtd, "Commission must be a non-negative integer");
  assertBookedCharge(input.taxNtd, "Tax must be a non-negative integer");
  const bookingSequence = resolveBookingSequence(store, input.accountId, input.tradeDate, input.bookingSequence);
  const suggestedFees =
    input.type === "BUY"
      ? calculateBuyFees(profile, tradeValueNtd)
      : calculateSellFees(profile, {
          tradeValueNtd,
          instrumentType: instrument.type,
          isDayTrade: input.isDayTrade,
        });
  const commissionNtd = input.commissionNtd ?? suggestedFees.commissionNtd;
  const taxNtd = input.taxNtd ?? suggestedFees.taxNtd;

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
    tradeTimestamp: input.tradeTimestamp ?? new Date(`${input.tradeDate}T00:00:00.000Z`).toISOString(),
    commissionNtd,
    taxNtd,
    isDayTrade: input.isDayTrade,
    feeSnapshot: { ...profile },
    bookingSequence,
    sourceType: "portfolio_transaction_api",
    sourceReference: input.id,
    bookedAt: new Date().toISOString(),
  };

  applyToLots(store, tx);
  appendTradeEvent(store, tx);
  appendCashLedgerEntry(store, buildTradeSettlementCashEntry(tx));
  return tx;
}

function applyToLots(store: Store, tx: Transaction): void {
  const relevantLots = listInventoryLots(store).filter((lot) => lot.accountId === tx.accountId && lot.symbol === tx.symbol);

  if (tx.type === "BUY") {
    const lot: Lot = {
      id: `lot-${tx.id}`,
      accountId: tx.accountId,
      symbol: tx.symbol,
      openQuantity: tx.quantity,
      totalCostNtd: tx.priceNtd * tx.quantity + tx.commissionNtd + tx.taxNtd,
      openedAt: tx.tradeDate,
      openedSequence: tx.bookingSequence,
    };
    const applied = applyBuyToLots(relevantLots, lot);
    replaceLots(store, tx.accountId, tx.symbol, applied.updatedLots);
    return;
  }

  const lots = relevantLots.filter((lot) => lot.openQuantity > 0);
  const allocation = allocateSellLots(lots, tx.quantity);

  replaceLots(store, tx.accountId, tx.symbol, allocation.updatedLots);
  replaceLotAllocationsForTrade(store, tx.id, buildLotAllocationProjections(tx, allocation.matchedAllocations));
  tx.realizedPnlNtd = deriveRealizedPnlForTrade(store.accounting, tx);
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
  return store.accounting.projections.holdings.filter((holding) => accountIds.has(holding.accountId));
}

export function applyCorporateAction(store: Store, action: CorporateAction): CorporateAction {
  if (action.actionType === "DIVIDEND") {
    appendCorporateAction(store, action);
    return action;
  }

  if (action.denominator <= 0 || action.numerator <= 0) {
    throw new Error("Invalid split ratio");
  }

  for (const lot of listInventoryLots(store)) {
    if (lot.accountId !== action.accountId || lot.symbol !== action.symbol || lot.openQuantity <= 0) continue;

    const splitRatio = action.numerator / action.denominator;
    const nextQty = Math.floor(lot.openQuantity * splitRatio);
    lot.openQuantity = nextQty;
  }

  appendCorporateAction(store, action);
  rebuildHoldingProjection(store);
  return action;
}

function replaceLots(store: Store, accountId: string, symbol: string, nextLots: Lot[]): void {
  replaceInventoryLots(store, accountId, symbol, nextLots);
}

function buildLotAllocationProjections(
  tx: BookedTradeEvent,
  matchedAllocations: Array<{
    lotId: string;
    quantity: number;
    allocatedCostNtd: number;
    openedAt: string;
    openedSequence?: number;
  }>,
): LotAllocationProjection[] {
  return matchedAllocations.map((allocation) => ({
    id: `${tx.id}:${allocation.lotId}`,
    userId: tx.userId,
    accountId: tx.accountId,
    tradeEventId: tx.id,
    symbol: tx.symbol,
    lotId: allocation.lotId,
    lotOpenedAt: allocation.openedAt,
    lotOpenedSequence: allocation.openedSequence ?? 1,
    allocatedQuantity: allocation.quantity,
    allocatedCostNtd: allocation.allocatedCostNtd,
    createdAt: tx.bookedAt,
  }));
}

function nextBookingSequence(store: Store, accountId: string, tradeDate: string): number {
  const sameDayTrades = listTradeEvents(store).filter(
    (trade) => trade.accountId === accountId && trade.tradeDate === tradeDate,
  );

  const highestSequence = sameDayTrades.reduce((max, trade) => Math.max(max, trade.bookingSequence ?? 0), 0);
  return highestSequence + 1;
}

function resolveBookingSequence(
  store: Store,
  accountId: string,
  tradeDate: string,
  requestedSequence?: number,
): number {
  if (requestedSequence === undefined) {
    return nextBookingSequence(store, accountId, tradeDate);
  }

  const collides = listTradeEvents(store).some(
    (trade) =>
      trade.accountId === accountId && trade.tradeDate === tradeDate && trade.bookingSequence === requestedSequence,
  );
  if (collides) {
    throw new Error("Invalid booking sequence: already exists for the same account and trade date");
  }

  return requestedSequence;
}

function assertTradeTimestampMatchesTradeDate(tradeDate: string, tradeTimestamp?: string): void {
  if (!tradeTimestamp) return;
  if (tradeTimestamp.slice(0, 10) !== tradeDate) {
    throw new Error("Trade timestamp must match trade date");
  }
}

function assertBookedCharge(value: number | undefined, message: string): void {
  if (value === undefined) return;
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(message);
  }
}

function buildTradeSettlementCashEntry(tx: Transaction): CashLedgerEntry {
  const grossTradeValueNtd = tx.quantity * tx.priceNtd;
  const settlementAmountNtd =
    tx.type === "BUY"
      ? -(grossTradeValueNtd + tx.commissionNtd + tx.taxNtd)
      : grossTradeValueNtd - tx.commissionNtd - tx.taxNtd;

  return {
    id: `cash-${tx.id}`,
    userId: tx.userId,
    accountId: tx.accountId,
    entryDate: tx.tradeDate,
    entryType: tx.type === "BUY" ? "TRADE_SETTLEMENT_OUT" : "TRADE_SETTLEMENT_IN",
    amountNtd: settlementAmountNtd,
    currency: "TWD",
    relatedTradeEventId: tx.id,
    sourceType: "trade_settlement",
    sourceReference: tx.id,
    bookedAt: tx.bookedAt,
  };
}
