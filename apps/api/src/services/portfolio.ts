import {
  applyBuyToLots,
  allocateSellLots,
  calculateBuyFees,
  calculateSellFees,
  roundToDecimal,
  type FeeProfile,
  type Lot,
} from "@tw-portfolio/domain";
import { marketCodeFor } from "@tw-portfolio/shared-types";
import type { AccountDto, MarketCode } from "@tw-portfolio/shared-types";
import {
  appendCorporateAction,
  appendTradeEvent,
  deriveRealizedPnlForTrade,
  listInventoryLots,
  listTradeEvents,
  rebuildHoldingProjection,
  replaceLotAllocationsForTrade,
  replaceInventoryLots,
} from "./accountingStore.js";
import { bookCashLedgerEntry, buildTradeSettlementCashEntry } from "./cashLedgerService.js";
import { routeError } from "../lib/routeError.js";
import type {
  BookedTradeEvent,
  CorporateAction,
  LotAllocationProjection,
  Store,
  Transaction,
} from "../types/store.js";

// KZO-183: trade market guard — every trade booking must hit an instrument
// whose market matches the booking account's market (derived from
// account.defaultCurrency). 1:1 currency↔market mapping. The DB-level
// trigger on `trade_events` is defense-in-depth; this is the user-facing
// surface that produces the 400 error envelope.
export function assertTradeMarketMatchesAccount(
  account: Pick<AccountDto, "id" | "defaultCurrency">,
  tradeMarketCode: string,
): void {
  // marketCodeFor throws a plain Error if account.defaultCurrency falls outside
  // the closed TWD/USD/AUD set. Catch it here so callers see a stable 400
  // routeError envelope instead of a 500 (CHECK constraint on
  // accounts.default_currency makes this branch unreachable in practice; this
  // is defense-in-depth per service-error-pattern.md).
  let expected: string;
  try {
    expected = marketCodeFor(account.defaultCurrency);
  } catch {
    throw routeError(
      400,
      "trade_market_mismatch",
      `Account ${account.id} has unsupported defaultCurrency ${account.defaultCurrency}`,
    );
  }
  if (tradeMarketCode !== expected) {
    throw routeError(
      400,
      "trade_market_mismatch",
      `Trade market ${tradeMarketCode} does not match account ${account.id} market ${expected}`,
    );
  }
}

export interface CreateTransactionInput {
  id: string;
  accountId: string;
  ticker: string;
  // KZO-169: provided by the caller as part of the body payload — server
  // rejects mismatches via the `currency_mismatch` guard in the route handler.
  marketCode: MarketCode;
  quantity: number;
  unitPrice: number;
  priceCurrency: string;
  tradeDate: string;
  tradeTimestamp?: string;
  bookingSequence?: number;
  commissionAmount?: number;
  taxAmount?: number;
  type: "BUY" | "SELL";
  isDayTrade: boolean;
}

export interface HoldingsRow {
  accountId: string;
  ticker: string;
  quantity: number;
  costBasisAmount: number;
  currency: string;
}

export function createTransaction(
  store: Store,
  userId: string,
  input: CreateTransactionInput,
): Transaction {
  const account = store.accounts.find((item) => item.id === input.accountId && item.userId === userId);
  if (!account) throw routeError(404, "account_not_found", "Account not found");

  const instrument = store.instruments.find((item) => item.ticker === input.ticker && item.marketCode === input.marketCode);
  if (!instrument) throw routeError(400, "unsupported_ticker", "Unsupported ticker");
  if (instrument.type === null) throw routeError(400, "unclassified_instrument", "Cannot create trades for unclassified instruments");
  // KZO-183: enforce account market binding BEFORE running fee resolution
  // or any side effects. The instrument's market_code must match the
  // market derived from the booking account's defaultCurrency.
  assertTradeMarketMatchesAccount(account, instrument.marketCode);

  const profile = resolveFeeProfileForTransaction(
    store,
    account.id,
    input.ticker,
    account.feeProfileId,
  );
  if (input.priceCurrency !== profile.commissionCurrency) {
    throw routeError(400, "currency_mismatch", "Trade currency must match fee profile commission currency");
  }

  const tradeValueAmount = roundToDecimal(input.quantity * input.unitPrice, 2);
  assertTradeTimestampMatchesTradeDate(input.tradeDate, input.tradeTimestamp);
  assertBookedCharge(input.commissionAmount, "Commission must be a non-negative integer");
  assertBookedCharge(input.taxAmount, "Tax must be a non-negative integer");
  const bookingSequence = resolveBookingSequence(store, input.accountId, input.tradeDate, input.bookingSequence);
  const suggestedFees =
    input.type === "BUY"
      ? calculateBuyFees(profile, tradeValueAmount, input.priceCurrency)
      : calculateSellFees(profile, {
          tradeValueAmount,
          tradeCurrency: input.priceCurrency,
          instrumentType: instrument.type,
          isDayTrade: input.isDayTrade,
          marketCode: instrument.marketCode,
        });
  const commissionAmount = input.commissionAmount ?? suggestedFees.commissionAmount;
  const taxAmount = input.taxAmount ?? suggestedFees.taxAmount;

  const tx: Transaction = {
    id: input.id,
    userId,
    accountId: input.accountId,
    ticker: input.ticker,
    marketCode: instrument.marketCode,
    instrumentType: instrument.type,
    type: input.type,
    quantity: input.quantity,
    unitPrice: input.unitPrice,
    priceCurrency: input.priceCurrency,
    tradeDate: input.tradeDate,
    tradeTimestamp: input.tradeTimestamp ?? new Date(`${input.tradeDate}T00:00:00.000Z`).toISOString(),
    commissionAmount,
    taxAmount,
    isDayTrade: input.isDayTrade,
    feeSnapshot: { ...profile },
    bookingSequence,
    source: "portfolio_transaction_api",
    sourceReference: input.id,
    bookedAt: new Date().toISOString(),
  };

  applyToLots(store, tx);
  appendTradeEvent(store, tx);
  // KZO-167: route through cashLedgerService so the currency-match guard
  // fires on path 1 (initial trade booking) before delegating to
  // appendCashLedgerEntry.
  bookCashLedgerEntry(store, buildTradeSettlementCashEntry(tx));
  return tx;
}

function applyToLots(store: Store, tx: Transaction): void {
  const relevantLots = listInventoryLots(store).filter((lot) => lot.accountId === tx.accountId && lot.ticker === tx.ticker);

  if (tx.type === "BUY") {
    const lot: Lot = {
      id: `lot-${tx.id}`,
      accountId: tx.accountId,
      ticker: tx.ticker,
      openQuantity: tx.quantity,
      totalCostAmount: roundToDecimal(tx.unitPrice * tx.quantity, 2) + tx.commissionAmount + tx.taxAmount,
      costCurrency: tx.priceCurrency,
      openedAt: tx.tradeDate,
      openedSequence: tx.bookingSequence,
    };
    const applied = applyBuyToLots(relevantLots, lot);
    replaceLots(store, tx.accountId, tx.ticker, applied.updatedLots);
    return;
  }

  const lots = relevantLots.filter((lot) => lot.openQuantity > 0);
  const allocation = allocateSellLots(lots, tx.quantity);

  replaceLots(store, tx.accountId, tx.ticker, allocation.updatedLots);
  replaceLotAllocationsForTrade(store, tx.id, buildLotAllocationProjections(tx, allocation.matchedAllocations));
  tx.realizedPnlAmount = deriveRealizedPnlForTrade(store.accounting, tx);
  tx.realizedPnlCurrency = tx.priceCurrency;
}

function mustGetFeeProfile(store: Store, profileId: string): FeeProfile {
  const profile = store.feeProfiles.find((item) => item.id === profileId);
  if (!profile) throw routeError(404, "fee_profile_not_found", `Fee profile ${profileId} not found`);
  return profile;
}

function resolveFeeProfileForTransaction(
  store: Store,
  accountId: string,
  ticker: string,
  fallbackProfileId: string,
): FeeProfile {
  // KZO-183: bindings no longer carry `marketCode` — resolution is keyed
  // solely by (accountId, ticker). Market enforcement happens at the trade
  // booking guard, not in fee-profile resolution.
  const symbolBinding = store.feeProfileBindings.find(
    (binding) => binding.accountId === accountId && binding.ticker === ticker,
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
    throw routeError(400, "invalid_split_ratio", "Invalid split ratio");
  }

  for (const lot of listInventoryLots(store)) {
    if (lot.accountId !== action.accountId || lot.ticker !== action.ticker || lot.openQuantity <= 0) continue;

    const splitRatio = action.numerator / action.denominator;
    const nextQty = Math.floor(lot.openQuantity * splitRatio);
    lot.openQuantity = nextQty;
  }

  appendCorporateAction(store, action);
  rebuildHoldingProjection(store);
  return action;
}

function replaceLots(store: Store, accountId: string, ticker: string, nextLots: Lot[]): void {
  replaceInventoryLots(store, accountId, ticker, nextLots);
}

function buildLotAllocationProjections(
  tx: BookedTradeEvent,
  matchedAllocations: Array<{
    lotId: string;
    quantity: number;
    allocatedCostAmount: number;
    costCurrency: string;
    openedAt: string;
    openedSequence?: number;
  }>,
): LotAllocationProjection[] {
  return matchedAllocations.map((allocation) => ({
    id: `${tx.id}:${allocation.lotId}`,
    userId: tx.userId,
    accountId: tx.accountId,
    tradeEventId: tx.id,
    ticker: tx.ticker,
    lotId: allocation.lotId,
    lotOpenedAt: allocation.openedAt,
    lotOpenedSequence: allocation.openedSequence ?? 1,
    allocatedQuantity: allocation.quantity,
    allocatedCostAmount: allocation.allocatedCostAmount,
    costCurrency: allocation.costCurrency,
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
    throw routeError(409, "duplicate_booking_sequence", "Booking sequence already exists for the same account and trade date");
  }

  return requestedSequence;
}

function assertTradeTimestampMatchesTradeDate(tradeDate: string, tradeTimestamp?: string): void {
  if (!tradeTimestamp) return;
  if (tradeTimestamp.slice(0, 10) !== tradeDate) {
    throw routeError(400, "timestamp_date_mismatch", "Trade timestamp must match trade date");
  }
}

function assertBookedCharge(value: number | undefined, message: string): void {
  if (value === undefined) return;
  if (!Number.isInteger(value) || value < 0) {
    throw routeError(400, "invalid_charge", message);
  }
}

// KZO-167: `buildTradeSettlementCashEntry` lives in `cashLedgerService.ts`
// and is imported above. The local copy was removed to consolidate the
// builder shared with `recompute.ts`.
