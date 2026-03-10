import {
  listDividendEvents,
  listDividendLedgerEntries,
  listInventoryLots,
  rebuildHoldingProjection,
  replaceCashLedgerEntriesForDividend,
  replaceDividendDeductionsForLedger,
  replaceInventoryLots,
  upsertDividendEvent,
  upsertDividendLedgerEntry,
} from "./accountingStore.js";
import type {
  CashLedgerEntry,
  DividendDeductionEntry,
  DividendDeductionType,
  DividendEvent,
  DividendEventType,
  DividendLedgerEntry,
  Store,
} from "../types/store.js";

export interface CreateDividendEventInput {
  id: string;
  symbol: string;
  eventType: DividendEventType;
  exDividendDate: string;
  paymentDate: string;
  cashDividendPerShare: number;
  stockDividendPerShare: number;
  sourceType: string;
  sourceReference?: string;
}

export interface PostDividendInput {
  id: string;
  accountId: string;
  dividendEventId: string;
  receivedCashAmountNtd: number;
  receivedStockQuantity: number;
  deductions: Array<{
    id: string;
    deductionType: DividendDeductionType;
    amount: number;
    withheldAtSource: boolean;
    sourceType: string;
    sourceReference?: string;
    note?: string;
  }>;
}

export interface DividendPostingComparison {
  expectedCashAmountNtd: number;
  actualCashEconomicAmountNtd: number;
  cashVarianceAmountNtd: number;
  expectedStockQuantity: number;
  actualStockQuantity: number;
  stockVarianceQuantity: number;
}

export interface PostDividendResult {
  dividendEvent: DividendEvent;
  dividendLedgerEntry: DividendLedgerEntry;
  dividendDeductionEntries: DividendDeductionEntry[];
  linkedCashLedgerEntries: CashLedgerEntry[];
  comparison: DividendPostingComparison;
}

export function createDividendEvent(store: Store, input: CreateDividendEventInput): DividendEvent {
  assertDividendEventShape(input);

  const dividendEvent: DividendEvent = {
    ...input,
    sourceReference: input.sourceReference,
    createdAt: new Date().toISOString(),
  };
  upsertDividendEvent(store, dividendEvent);
  return dividendEvent;
}

export function postDividend(store: Store, userId: string, input: PostDividendInput): PostDividendResult {
  if (input.receivedCashAmountNtd === 0 && input.receivedStockQuantity === 0 && input.deductions.length === 0) {
    throw new Error("Dividend posting must include cash, stock, or deductions");
  }

  const account = store.accounts.find((item) => item.id === input.accountId && item.userId === userId);
  if (!account) {
    throw new Error("Account not found");
  }

  const dividendEvent = listDividendEvents(store).find((entry) => entry.id === input.dividendEventId);
  if (!dividendEvent) {
    throw new Error("Dividend event not found");
  }

  const activeEntry = findActiveDividendLedgerEntry(store, input.accountId, input.dividendEventId);
  if (activeEntry && activeEntry.postingStatus !== "expected") {
    throw new Error("Dividend posting requires an active expected entry");
  }

  const expectedEntry = activeEntry ?? materializeExpectedDividendEntry(store, input.id, input.accountId, dividendEvent);
  const bookedAt = new Date().toISOString();
  const deductions = buildDividendDeductions(expectedEntry.id, bookedAt, input.deductions);

  const postedEntry: DividendLedgerEntry = {
    ...expectedEntry,
    receivedCashAmountNtd: input.receivedCashAmountNtd,
    receivedStockQuantity: input.receivedStockQuantity,
    postingStatus: expectedEntry.postingStatus === "expected" ? "posted" : expectedEntry.postingStatus,
    reconciliationStatus: "open",
    bookedAt,
  };
  upsertDividendLedgerEntry(store, postedEntry);
  replaceDividendDeductionsForLedger(store, postedEntry.id, deductions);

  const linkedCashLedgerEntries = buildDividendCashLedgerEntries(userId, account.id, dividendEvent, postedEntry, deductions);
  replaceCashLedgerEntriesForDividend(store, postedEntry.id, linkedCashLedgerEntries);

  if (postedEntry.receivedStockQuantity > 0) {
    upsertStockDividendLot(store, account.id, dividendEvent.symbol, dividendEvent.paymentDate, postedEntry);
  } else {
    rebuildHoldingProjection(store);
  }

  const actualCashEconomicAmountNtd =
    postedEntry.receivedCashAmountNtd +
    deductions.filter((entry) => entry.withheldAtSource).reduce((sum, entry) => sum + entry.amount, 0);

  return {
    dividendEvent,
    dividendLedgerEntry: postedEntry,
    dividendDeductionEntries: deductions,
    linkedCashLedgerEntries,
    comparison: {
      expectedCashAmountNtd: postedEntry.expectedCashAmountNtd,
      actualCashEconomicAmountNtd,
      cashVarianceAmountNtd: actualCashEconomicAmountNtd - postedEntry.expectedCashAmountNtd,
      expectedStockQuantity: postedEntry.expectedStockQuantity,
      actualStockQuantity: postedEntry.receivedStockQuantity,
      stockVarianceQuantity: postedEntry.receivedStockQuantity - postedEntry.expectedStockQuantity,
    },
  };
}

function materializeExpectedDividendEntry(
  store: Store,
  id: string,
  accountId: string,
  dividendEvent: DividendEvent,
): DividendLedgerEntry {
  const eligibleQuantity = deriveEligibleQuantity(store, accountId, dividendEvent.symbol, dividendEvent.exDividendDate);
  const expectedEntry: DividendLedgerEntry = {
    id,
    accountId,
    dividendEventId: dividendEvent.id,
    eligibleQuantity,
    expectedCashAmountNtd: calculateExpectedCashAmountNtd(eligibleQuantity, dividendEvent.cashDividendPerShare),
    expectedStockQuantity: calculateExpectedStockQuantity(eligibleQuantity, dividendEvent.stockDividendPerShare),
    receivedCashAmountNtd: 0,
    receivedStockQuantity: 0,
    postingStatus: "expected",
    reconciliationStatus: "open",
    bookedAt: new Date().toISOString(),
  };
  upsertDividendLedgerEntry(store, expectedEntry);
  return expectedEntry;
}

function findActiveDividendLedgerEntry(
  store: Store,
  accountId: string,
  dividendEventId: string,
): DividendLedgerEntry | undefined {
  const supersededIds = new Set(
    listDividendLedgerEntries(store)
      .map((entry) => entry.reversalOfDividendLedgerEntryId)
      .filter((entry): entry is string => Boolean(entry)),
  );

  return listDividendLedgerEntries(store).find(
    (entry) =>
      entry.accountId === accountId &&
      entry.dividendEventId === dividendEventId &&
      !entry.reversalOfDividendLedgerEntryId &&
      !entry.supersededAt &&
      !supersededIds.has(entry.id),
  );
}

function buildDividendDeductions(
  dividendLedgerEntryId: string,
  bookedAt: string,
  deductions: PostDividendInput["deductions"],
): DividendDeductionEntry[] {
  return deductions.map((entry) => ({
    id: entry.id,
    dividendLedgerEntryId,
    deductionType: entry.deductionType,
    amount: entry.amount,
    currencyCode: "TWD",
    withheldAtSource: entry.withheldAtSource,
    sourceType: entry.sourceType,
    sourceReference: entry.sourceReference,
    note: entry.note,
    bookedAt,
  }));
}

function buildDividendCashLedgerEntries(
  userId: string,
  accountId: string,
  dividendEvent: DividendEvent,
  dividendLedgerEntry: DividendLedgerEntry,
  deductions: DividendDeductionEntry[],
): CashLedgerEntry[] {
  const entries: CashLedgerEntry[] = [];
  const entryDate = dividendEvent.paymentDate;
  const bookedAt = dividendLedgerEntry.bookedAt ?? new Date(`${entryDate}T00:00:00.000Z`).toISOString();

  if (dividendLedgerEntry.receivedCashAmountNtd > 0) {
    entries.push({
      id: `${dividendLedgerEntry.id}:receipt`,
      userId,
      accountId,
      entryDate,
      entryType: "DIVIDEND_RECEIPT",
      amountNtd: dividendLedgerEntry.receivedCashAmountNtd,
      currency: "TWD",
      relatedDividendLedgerEntryId: dividendLedgerEntry.id,
      sourceType: "dividend_posting",
      sourceReference: dividendLedgerEntry.id,
      bookedAt,
    });
  }

  for (const deduction of deductions) {
    entries.push({
      id: `${dividendLedgerEntry.id}:deduction:${deduction.id}`,
      userId,
      accountId,
      entryDate,
      entryType: "DIVIDEND_DEDUCTION",
      amountNtd: -deduction.amount,
      currency: "TWD",
      relatedDividendLedgerEntryId: dividendLedgerEntry.id,
      sourceType: deduction.sourceType,
      sourceReference: deduction.sourceReference ?? deduction.id,
      note: deduction.note,
      bookedAt,
    });
  }

  return entries;
}

function upsertStockDividendLot(
  store: Store,
  accountId: string,
  symbol: string,
  paymentDate: string,
  dividendLedgerEntry: DividendLedgerEntry,
): void {
  const relevantLots = listInventoryLots(store).filter((lot) => lot.accountId === accountId && lot.symbol === symbol);
  const nextSequence =
    relevantLots
      .filter((lot) => lot.openedAt === paymentDate)
      .reduce((max, lot) => Math.max(max, lot.openedSequence ?? 0), 0) + 1;

  replaceInventoryLots(store, accountId, symbol, [
    ...relevantLots.filter((lot) => lot.id !== `lot-${dividendLedgerEntry.id}`),
    {
      id: `lot-${dividendLedgerEntry.id}`,
      accountId,
      symbol,
      openQuantity: dividendLedgerEntry.receivedStockQuantity,
      totalCostNtd: 0,
      openedAt: paymentDate,
      openedSequence: nextSequence,
    },
  ]);
}

function deriveEligibleQuantity(store: Store, accountId: string, symbol: string, exDividendDate: string): number {
  return Math.max(
    0,
    store.accounting.facts.tradeEvents
      .filter((entry) => entry.accountId === accountId && entry.symbol === symbol && entry.tradeDate < exDividendDate)
      .reduce((sum, entry) => sum + (entry.type === "BUY" ? entry.quantity : -entry.quantity), 0),
  );
}

function calculateExpectedCashAmountNtd(eligibleQuantity: number, cashDividendPerShare: number): number {
  return roundCurrencyAmount(eligibleQuantity * cashDividendPerShare);
}

function calculateExpectedStockQuantity(eligibleQuantity: number, stockDividendPerShare: number): number {
  return Math.floor(eligibleQuantity * stockDividendPerShare);
}

function roundCurrencyAmount(value: number): number {
  return Math.max(0, Math.round(value + Number.EPSILON));
}

function assertDividendEventShape(input: CreateDividendEventInput): void {
  if (input.paymentDate < input.exDividendDate) {
    throw new Error("Payment date must not be earlier than ex-dividend date");
  }

  if (input.cashDividendPerShare < 0 || input.stockDividendPerShare < 0) {
    throw new Error("Dividend per-share values must be non-negative");
  }

  const hasCash = input.cashDividendPerShare > 0;
  const hasStock = input.stockDividendPerShare > 0;

  if (input.eventType === "CASH" && (!hasCash || hasStock)) {
    throw new Error("Cash dividend events must only include cash per-share value");
  }

  if (input.eventType === "STOCK" && (hasCash || !hasStock)) {
    throw new Error("Stock dividend events must only include stock per-share value");
  }

  if (input.eventType === "CASH_AND_STOCK" && (!hasCash || !hasStock)) {
    throw new Error("Cash-and-stock dividend events must include both per-share values");
  }
}
