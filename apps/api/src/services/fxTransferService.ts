import { randomUUID } from "node:crypto";
import { roundToDecimal, type CurrencyCode } from "@tw-portfolio/domain";
import type { AccountDto } from "@tw-portfolio/shared-types";
import { routeError } from "../lib/routeError.js";
import type { AuditLogInput, Persistence } from "../persistence/types.js";
import type { CashLedgerEntry, Store } from "../types/store.js";
import { MissingFxRateError } from "./currencyWalletAccounting.js";

export const FX_TRANSFER_WARN_TOLERANCE_PCT = 2;
export const FX_TRANSFER_BLOCK_TOLERANCE_PCT = 10;
export const FX_TRANSFER_AMOUNT_RATE_EPSILON = 0.01;

type ToleranceState = "safe" | "warn" | "block";

export interface CreateFxTransferInput {
  fromAccountId: string;
  toAccountId: string;
  fromAmount: number;
  toAmount: number;
  effectiveRate: number;
  entryDate: string;
  notes?: string;
}

export interface UpdateFxTransferInput {
  fromAmount?: number;
  toAmount?: number;
  effectiveRate?: number;
  entryDate?: string;
  notes?: string | null;
}

export interface EstimateResult {
  realizedFxImpactUsd: number;
  midRate: number | null;
  midRateAvailable: boolean;
  midRateProvider: string | null;
  tolerancePct: number | null;
  toleranceState: ToleranceState;
  fromAccountAvailableBalance: number;
  insufficientBalance: boolean;
}

export interface CashBalanceChange {
  accountId: string;
  currency: CurrencyCode;
  delta: number;
}

interface MutationSideEffects {
  cashBalanceChanges: CashBalanceChange[];
}

export type CreateFxTransferResult = {
  fxTransferId: string;
  legOutId: string;
  legInId: string;
} & MutationSideEffects;

export type UpdateFxTransferResult = {
  fxTransferId: string;
  legOutId: string;
  legInId: string;
} & MutationSideEffects;

export type ReverseFxTransferResult = {
  reversalLegOutId: string;
  reversalLegInId: string;
  fxTransferIdReversed: string;
} & MutationSideEffects;

interface PreparedFxTransfer {
  fromAccount: AccountDto;
  toAccount: AccountDto;
  fromCurrency: CurrencyCode;
  toCurrency: CurrencyCode;
  midRate: number | null;
  midRateAvailable: boolean;
  tolerancePct: number | null;
  toleranceState: ToleranceState;
  outFxRateToUsd: number;
  inFxRateToUsd: number;
  availableBalance: number;
}

export function validateAmountRateEpsilon(
  fromAmount: number,
  toAmount: number,
  effectiveRate: number,
): void {
  if (Math.abs(effectiveRate * fromAmount - toAmount) >= FX_TRANSFER_AMOUNT_RATE_EPSILON) {
    throw routeError(
      400,
      "fx_transfer_amount_rate_mismatch",
      "Transfer amounts must match the effective exchange rate.",
    );
  }
}

export function validateMidRateTolerance(
  effectiveRate: number,
  midRate: number | null,
): { tolerancePct: number | null; state: ToleranceState } {
  if (midRate === null) {
    return { tolerancePct: null, state: "warn" };
  }
  const tolerancePct = Math.abs((effectiveRate - midRate) / midRate) * 100;
  if (tolerancePct >= FX_TRANSFER_BLOCK_TOLERANCE_PCT) {
    return { tolerancePct, state: "block" };
  }
  if (tolerancePct >= FX_TRANSFER_WARN_TOLERANCE_PCT) {
    return { tolerancePct, state: "warn" };
  }
  return { tolerancePct, state: "safe" };
}

/**
 * KZO-168 D5: derive the per-leg `fx_rate_to_usd` stamp for the WAC engine.
 *
 * The math reduces to the same expression for both legs once each caller
 * passes `(otherLegAmount, midUsdPerOtherCurrency)` correctly:
 *   OUT leg (non-USD source): `(toAmount × midUsdPerToCurrency) / fromAmount`
 *   IN  leg (non-USD destination): `(fromAmount × midUsdPerSourceCurrency) / toAmount`
 * USD legs always carry `1.0` (KZO-166 D10 invariant — USD has no FX exposure
 * to itself).
 */
export function deriveFxRateToUsdForLeg(input: {
  legCurrency: CurrencyCode;
  legAmount: number;
  otherLegAmount: number;
  midUsdPerOtherCurrency: number;
}): number {
  if (input.legCurrency === "USD") return 1.0;
  return roundToDecimal((input.otherLegAmount * input.midUsdPerOtherCurrency) / input.legAmount, 8);
}

export function validateAccountPair(fromAccount: AccountDto, toAccount: AccountDto): void {
  if (fromAccount.id === toAccount.id) {
    throw routeError(400, "fx_transfer_same_account", "FX transfer requires two different accounts.");
  }
  if (fromAccount.defaultCurrency === toAccount.defaultCurrency) {
    throw routeError(400, "fx_transfer_same_currency", "FX transfer requires accounts with different currencies.");
  }
}

export async function estimateFxTransfer(
  persistence: Persistence,
  userId: string,
  input: CreateFxTransferInput,
): Promise<EstimateResult> {
  const store = await persistence.loadStore(userId);
  const prepared = await prepareFxTransfer(persistence, store, userId, input, { currentFromAmount: 0, mode: "estimate" });
  return {
    realizedFxImpactUsd: 0,
    midRate: prepared.midRate,
    midRateAvailable: prepared.midRateAvailable,
    midRateProvider: prepared.midRateAvailable ? "frankfurter" : null,
    tolerancePct: prepared.tolerancePct,
    toleranceState: prepared.toleranceState,
    fromAccountAvailableBalance: prepared.availableBalance,
    insufficientBalance: prepared.availableBalance < input.fromAmount,
  };
}

export async function createFxTransfer(
  persistence: Persistence,
  userId: string,
  input: CreateFxTransferInput,
): Promise<CreateFxTransferResult> {
  const store = await persistence.loadStore(userId);
  const draft = structuredClone(store);
  const prepared = await prepareFxTransfer(persistence, draft, userId, input, { currentFromAmount: 0, mode: "create" });

  const fxTransferId = randomUUID();
  const outLegId = randomUUID();
  const inLegId = randomUUID();
  const bookedAt = new Date().toISOString();

  const outLeg: CashLedgerEntry = {
    id: outLegId,
    userId,
    accountId: prepared.fromAccount.id,
    entryDate: input.entryDate,
    entryType: "FX_TRANSFER_OUT",
    amount: -roundToDecimal(input.fromAmount, 2),
    currency: prepared.fromCurrency,
    source: "fx_transfer",
    sourceReference: `${fxTransferId}:out`,
    note: input.notes?.trim() || undefined,
    bookedAt,
    fxRateToUsd: prepared.outFxRateToUsd,
    fxTransferId,
  };
  const inLeg: CashLedgerEntry = {
    id: inLegId,
    userId,
    accountId: prepared.toAccount.id,
    entryDate: input.entryDate,
    entryType: "FX_TRANSFER_IN",
    amount: roundToDecimal(input.toAmount, 2),
    currency: prepared.toCurrency,
    source: "fx_transfer",
    sourceReference: `${fxTransferId}:in`,
    note: input.notes?.trim() || undefined,
    bookedAt,
    fxRateToUsd: prepared.inFxRateToUsd,
    fxTransferId,
  };
  draft.accounting.facts.cashLedgerEntries.push(outLeg, inLeg);

  // KZO-168 D8: persist legs + audit row in a single DB transaction so a partial
  // failure can never leave cash entries without their lifecycle audit record.
  await persistence.saveAccountingStoreWithAudit(
    userId,
    draft.accounting,
    buildFxTransferAuditEntry(userId, "fx_transfer_created", {
      ...auditDetails(fxTransferId, prepared, input),
      decision: "accepted",
    }),
  );

  return {
    fxTransferId,
    legOutId: outLegId,
    legInId: inLegId,
    cashBalanceChanges: [
      { accountId: prepared.fromAccount.id, currency: prepared.fromCurrency, delta: -roundToDecimal(input.fromAmount, 2) },
      { accountId: prepared.toAccount.id, currency: prepared.toCurrency, delta: roundToDecimal(input.toAmount, 2) },
    ],
  };
}

export async function updateFxTransfer(
  persistence: Persistence,
  userId: string,
  fxTransferId: string,
  patch: UpdateFxTransferInput,
): Promise<UpdateFxTransferResult> {
  const economicCount = [patch.fromAmount, patch.toAmount, patch.effectiveRate]
    .filter((field) => field !== undefined).length;
  if (economicCount > 0 && economicCount < 3) {
    throw routeError(400, "invalid_input", "fromAmount, toAmount, and effectiveRate must be provided together.");
  }
  const existing = await requireExistingFxTransfer(persistence, userId, fxTransferId);
  if (existing.reversed) {
    throw routeError(409, "fx_transfer_already_reversed", "FX transfer has already been reversed.");
  }
  const { outLeg, inLeg } = originalLegPair(existing.legs);
  const currentFromAmount = Math.abs(outLeg.amount);
  const currentToAmount = inLeg.amount;
  // `currentFromAmount > 0` is an invariant: create-time validation rejects
  // non-positive amounts, the partial UNIQUE index forbids two non-reversal
  // OUT legs sharing a transfer id, and the wallet-state CHECK constraint
  // (`FX_TRANSFER_OUT AND amount < 0`) prevents zero-amount rows from being
  // hand-inserted. Division below is therefore safe.
  const nextInput: CreateFxTransferInput = {
    fromAccountId: outLeg.accountId,
    toAccountId: inLeg.accountId,
    fromAmount: patch.fromAmount ?? currentFromAmount,
    toAmount: patch.toAmount ?? currentToAmount,
    effectiveRate: patch.effectiveRate ?? roundToDecimal(currentToAmount / currentFromAmount, 8),
    entryDate: patch.entryDate ?? outLeg.entryDate,
    notes: patch.notes === undefined ? outLeg.note : patch.notes ?? undefined,
  };

  const store = await persistence.loadStore(userId);
  const draft = structuredClone(store);
  const prepared = await prepareFxTransfer(persistence, draft, userId, nextInput, {
    currentFromAmount,
    mode: "create",
  });
  const draftOut = requireCashEntry(draft, outLeg.id);
  const draftIn = requireCashEntry(draft, inLeg.id);
  const before = {
    fromAmount: currentFromAmount,
    toAmount: currentToAmount,
    effectiveRate: roundToDecimal(currentToAmount / currentFromAmount, 8),
    entryDate: outLeg.entryDate,
    notes: outLeg.note ?? null,
  };
  const after = {
    fromAmount: nextInput.fromAmount,
    toAmount: nextInput.toAmount,
    effectiveRate: nextInput.effectiveRate,
    entryDate: nextInput.entryDate,
    notes: nextInput.notes ?? null,
  };

  draftOut.amount = -roundToDecimal(nextInput.fromAmount, 2);
  draftOut.entryDate = nextInput.entryDate;
  draftOut.note = nextInput.notes?.trim() || undefined;
  draftOut.fxRateToUsd = prepared.outFxRateToUsd;
  draftIn.amount = roundToDecimal(nextInput.toAmount, 2);
  draftIn.entryDate = nextInput.entryDate;
  draftIn.note = nextInput.notes?.trim() || undefined;
  draftIn.fxRateToUsd = prepared.inFxRateToUsd;

  await persistence.saveAccountingStoreWithAudit(
    userId,
    draft.accounting,
    buildFxTransferAuditEntry(userId, "fx_transfer_updated", {
      ...auditDetails(fxTransferId, prepared, nextInput),
      decision: "accepted",
      diff: buildDiff(before, after),
    }),
  );

  return {
    fxTransferId,
    legOutId: outLeg.id,
    legInId: inLeg.id,
    cashBalanceChanges: [
      {
        accountId: prepared.fromAccount.id,
        currency: prepared.fromCurrency,
        delta: roundToDecimal(currentFromAmount - nextInput.fromAmount, 2),
      },
      {
        accountId: prepared.toAccount.id,
        currency: prepared.toCurrency,
        delta: roundToDecimal(nextInput.toAmount - currentToAmount, 2),
      },
    ],
  };
}

export async function reverseFxTransfer(
  persistence: Persistence,
  userId: string,
  fxTransferId: string,
  opts: { reason?: string },
): Promise<ReverseFxTransferResult> {
  const existing = await requireExistingFxTransfer(persistence, userId, fxTransferId);
  if (existing.reversed) {
    throw routeError(409, "fx_transfer_already_reversed", "FX transfer has already been reversed.");
  }
  const { outLeg, inLeg } = originalLegPair(existing.legs);
  const store = await persistence.loadStore(userId);
  const draft = structuredClone(store);
  const reversalDate = new Date().toISOString().slice(0, 10);
  const bookedAt = new Date().toISOString();
  const reversalOutId = randomUUID();
  const reversalInId = randomUUID();

  const outReversal: CashLedgerEntry = {
    id: reversalOutId,
    userId,
    accountId: outLeg.accountId,
    entryDate: reversalDate,
    entryType: "REVERSAL",
    amount: roundToDecimal(-outLeg.amount, 2),
    currency: outLeg.currency,
    source: "fx_transfer_reversal",
    sourceReference: `${fxTransferId}:reverse:${outLeg.id}`,
    note: opts.reason?.trim() || undefined,
    bookedAt,
    reversalOfCashLedgerEntryId: outLeg.id,
    fxRateToUsd: outLeg.fxRateToUsd ?? null,
    fxTransferId,
  };
  const inReversal: CashLedgerEntry = {
    id: reversalInId,
    userId,
    accountId: inLeg.accountId,
    entryDate: reversalDate,
    entryType: "REVERSAL",
    amount: roundToDecimal(-inLeg.amount, 2),
    currency: inLeg.currency,
    source: "fx_transfer_reversal",
    sourceReference: `${fxTransferId}:reverse:${inLeg.id}`,
    note: opts.reason?.trim() || undefined,
    bookedAt,
    reversalOfCashLedgerEntryId: inLeg.id,
    fxRateToUsd: inLeg.fxRateToUsd ?? null,
    fxTransferId,
  };
  draft.accounting.facts.cashLedgerEntries.push(outReversal, inReversal);

  await persistence.saveAccountingStoreWithAudit(
    userId,
    draft.accounting,
    buildFxTransferAuditEntry(userId, "fx_transfer_reversed", {
      fxTransferId,
      fromAccountId: outLeg.accountId,
      toAccountId: inLeg.accountId,
      fromCurrency: outLeg.currency,
      toCurrency: inLeg.currency,
      fromAmount: Math.abs(outLeg.amount),
      toAmount: inLeg.amount,
      effectiveRate: roundToDecimal(inLeg.amount / Math.abs(outLeg.amount), 8),
      reason: opts.reason?.trim() || null,
      decision: "accepted",
    }),
  );

  return {
    reversalLegOutId: reversalOutId,
    reversalLegInId: reversalInId,
    fxTransferIdReversed: fxTransferId,
    cashBalanceChanges: [
      { accountId: outLeg.accountId, currency: outLeg.currency, delta: roundToDecimal(-outLeg.amount, 2) },
      { accountId: inLeg.accountId, currency: inLeg.currency, delta: roundToDecimal(-inLeg.amount, 2) },
    ],
  };
}

async function prepareFxTransfer(
  persistence: Persistence,
  store: Store,
  userId: string,
  input: CreateFxTransferInput,
  // `mode: "estimate"` returns block-tolerance and missing-bridge-rate as
  // data instead of throwing, so the form's gauge + summary can render those
  // states. `mode: "create"` enforces them as 400-level rejections.
  opts: { currentFromAmount: number; mode: "estimate" | "create" },
): Promise<PreparedFxTransfer> {
  assertPositiveAmounts(input);
  assertNotFutureDate(input.entryDate);
  validateAmountRateEpsilon(input.fromAmount, input.toAmount, input.effectiveRate);

  const fromAccount = requireOwnedAccount(store, userId, input.fromAccountId);
  const toAccount = requireOwnedAccount(store, userId, input.toAccountId);
  validateAccountPair(fromAccount, toAccount);
  const fromCurrency = fromAccount.defaultCurrency as CurrencyCode;
  const toCurrency = toAccount.defaultCurrency as CurrencyCode;

  const availableBalance = await persistence.getAccountAvailableBalance(userId, fromAccount.id, fromCurrency);
  const spendableBalance = roundToDecimal(availableBalance + opts.currentFromAmount, 2);
  if (opts.mode === "create" && spendableBalance < input.fromAmount) {
    throw routeError(400, "fx_transfer_insufficient_balance", "Insufficient source-account balance for FX transfer.");
  }

  const midRate = await persistence.getFxRate(fromCurrency, toCurrency, input.entryDate);
  const tolerance = validateMidRateTolerance(input.effectiveRate, midRate);
  if (opts.mode === "create" && tolerance.state === "block") {
    throw routeError(400, "fx_transfer_rate_out_of_tolerance", "FX transfer rate is too far from the available mid-market rate.");
  }

  // USD-bridge rates are required to derive `fx_rate_to_usd` for create.
  // Estimate can degrade to `null` so the form surfaces the missing-rate
  // state without a 400 round-trip.
  const usdPerSource = opts.mode === "estimate"
    ? await getUsdPerCurrencyOrNull(persistence, fromCurrency, input.entryDate)
    : await getUsdPerCurrency(persistence, fromCurrency, input.entryDate);
  const usdPerDest = opts.mode === "estimate"
    ? await getUsdPerCurrencyOrNull(persistence, toCurrency, input.entryDate)
    : await getUsdPerCurrency(persistence, toCurrency, input.entryDate);
  // Estimate degrades to 0 stamps when the bridge rate is missing — the
  // value is informational only (the gauge already surfaces the missing
  // direct rate via `midRateAvailable`). Create-mode never sees null here
  // because `getUsdPerCurrency` throws.
  const outFxRateToUsd = usdPerDest === null
    ? 0
    : deriveFxRateToUsdForLeg({
        legCurrency: fromCurrency,
        legAmount: input.fromAmount,
        otherLegAmount: input.toAmount,
        midUsdPerOtherCurrency: usdPerDest,
      });
  const inFxRateToUsd = usdPerSource === null
    ? 0
    : deriveFxRateToUsdForLeg({
        legCurrency: toCurrency,
        legAmount: input.toAmount,
        otherLegAmount: input.fromAmount,
        midUsdPerOtherCurrency: usdPerSource,
      });

  return {
    fromAccount,
    toAccount,
    fromCurrency,
    toCurrency,
    midRate,
    midRateAvailable: midRate !== null,
    tolerancePct: tolerance.tolerancePct,
    toleranceState: tolerance.state,
    outFxRateToUsd,
    inFxRateToUsd,
    availableBalance: spendableBalance,
  };
}

function assertPositiveAmounts(input: CreateFxTransferInput): void {
  if (input.fromAmount <= 0 || input.toAmount <= 0 || input.effectiveRate <= 0) {
    throw routeError(400, "invalid_input", "FX transfer amounts and rate must be positive.");
  }
}

function assertNotFutureDate(entryDate: string): void {
  const today = new Date().toISOString().slice(0, 10);
  if (entryDate > today) {
    throw routeError(400, "fx_transfer_future_date", "FX transfer date cannot be in the future.");
  }
}

function requireOwnedAccount(store: Store, userId: string, accountId: string): AccountDto {
  const account = store.accounts.find((candidate) => candidate.id === accountId && candidate.userId === userId);
  if (!account) {
    throw routeError(404, "account_not_found", "Account not found.");
  }
  return account;
}

async function getUsdPerCurrency(
  persistence: Persistence,
  currency: CurrencyCode,
  entryDate: string,
): Promise<number> {
  if (currency === "USD") return 1.0;
  const rate = await persistence.getFxRate(currency, "USD", entryDate);
  if (rate === null) {
    throw new MissingFxRateError({ base: currency, quote: "USD", asOfDate: entryDate });
  }
  return rate;
}

async function getUsdPerCurrencyOrNull(
  persistence: Persistence,
  currency: CurrencyCode,
  entryDate: string,
): Promise<number | null> {
  if (currency === "USD") return 1.0;
  return persistence.getFxRate(currency, "USD", entryDate);
}

function auditDetails(
  fxTransferId: string,
  prepared: PreparedFxTransfer,
  input: CreateFxTransferInput,
): Record<string, unknown> {
  return {
    fxTransferId,
    fromAccountId: prepared.fromAccount.id,
    toAccountId: prepared.toAccount.id,
    fromCurrency: prepared.fromCurrency,
    toCurrency: prepared.toCurrency,
    fromAmount: input.fromAmount,
    toAmount: input.toAmount,
    effectiveRate: input.effectiveRate,
    entryDate: input.entryDate,
    notes: input.notes ?? null,
    midRate: prepared.midRate,
    midRateAvailable: prepared.midRateAvailable,
    midRateProvider: prepared.midRateAvailable ? "frankfurter" : null,
    tolerancePct: prepared.tolerancePct,
    toleranceState: prepared.toleranceState,
  };
}

function buildFxTransferAuditEntry(
  userId: string,
  action: "fx_transfer_created" | "fx_transfer_updated" | "fx_transfer_reversed",
  details: Record<string, unknown>,
): AuditLogInput {
  return {
    actorUserId: userId,
    targetUserId: userId,
    action,
    metadata: details,
  };
}

async function requireExistingFxTransfer(
  persistence: Persistence,
  userId: string,
  fxTransferId: string,
): Promise<{ legs: CashLedgerEntry[]; reversed: boolean }> {
  const existing = await persistence.getFxTransferById(userId, fxTransferId);
  if (!existing) {
    throw routeError(404, "fx_transfer_not_found", "FX transfer not found.");
  }
  return existing;
}

function originalLegPair(legs: CashLedgerEntry[]): { outLeg: CashLedgerEntry; inLeg: CashLedgerEntry } {
  const originals = legs.filter((leg) => !leg.reversalOfCashLedgerEntryId);
  const outLeg = originals.find((leg) => leg.entryType === "FX_TRANSFER_OUT");
  const inLeg = originals.find((leg) => leg.entryType === "FX_TRANSFER_IN");
  if (!outLeg || !inLeg) {
    throw routeError(409, "fx_transfer_invalid_state", "FX transfer is missing one of its original legs.");
  }
  return { outLeg, inLeg };
}

function requireCashEntry(store: Store, cashEntryId: string): CashLedgerEntry {
  const entry = store.accounting.facts.cashLedgerEntries.find((candidate) => candidate.id === cashEntryId);
  if (!entry) {
    throw routeError(409, "fx_transfer_invalid_state", "FX transfer leg is missing from the accounting store.");
  }
  return entry;
}

function buildDiff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, { before: unknown; after: unknown }> {
  const diff: Record<string, { before: unknown; after: unknown }> = {};
  for (const [key, beforeValue] of Object.entries(before)) {
    const afterValue = after[key];
    if (beforeValue !== afterValue) {
      diff[key] = { before: beforeValue, after: afterValue };
    }
  }
  return diff;
}
