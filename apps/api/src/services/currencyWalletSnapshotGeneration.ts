import { randomUUID } from "node:crypto";
import { roundToDecimal } from "@vakwen/domain";
import type {
  CashLedgerEntryForWalletReplay,
  CurrencyWalletSnapshot,
  Persistence,
} from "../persistence/types.js";
import {
  applyEntryToWalletState,
  type WalletState,
} from "./currencyWalletAccounting.js";

/**
 * KZO-166 currency wallet snapshot writer.
 *
 * Extends the KZO-165 stub to compute real WAC (weighted-average FX cost) and
 * realized FX P&L for each `(accountId, currency)` wallet.
 *
 * Algorithm:
 *   1. Fetch cash-ledger entries via getCashLedgerEntriesForWalletReplay:
 *      - Reversal pairs filtered out (both the original and its REVERSAL).
 *      - Ordered by (entry_date ASC, booked_at ASC, id ASC) for determinism.
 *   2. Walk entries; maintain a WalletState per `(accountId, currency)` key.
 *   3. Emit one snapshot per `(accountId, currency, date-with-activity)`.
 *   4. Stamping rules (D10/D11):
 *      - USD wallet rows: wacFxToUsd=1.0, realizedFxPnlLifetime=0, providerSource='frankfurter'.
 *      - Non-USD with computed WAC: wacFxToUsd=<computed>, providerSource='frankfurter'.
 *      - Non-USD without FX-rate-stamped entries: wacFxToUsd=null, realizedFxPnlLifetime=0,
 *        providerSource=null (KZO-165 stub backward compat).
 *
 * Typed errors propagate unwrapped — no inner try/catch around the per-entry
 * walk. Callers that wrap this in a recompute job must catch
 * WalletAccountingError and surface via the recompute-failed SSE path (KZO-168+).
 *
 * @see `.claude/rules/typed-transient-error-catch-audit.md`
 * @see `docs/004-notes/kzo-166/scope-todo-202604262100-currency-wallet-wac.md`
 */
export interface CurrencyWalletSnapshotGenerationOptions {
  generationRunId?: string;
}

export interface CurrencyWalletSnapshotGenerationResult {
  totalRows: number;
  generationRunId: string;
}

export async function generateCurrencyWalletSnapshots(
  userId: string,
  persistence: Persistence,
  options: CurrencyWalletSnapshotGenerationOptions = {},
): Promise<CurrencyWalletSnapshotGenerationResult> {
  const generationRunId = options.generationRunId ?? randomUUID();
  const generatedAt = new Date().toISOString();

  // Full-replace strategy mirrors `generateHoldingSnapshots`. Idempotent against itself.
  await persistence.deleteAllCurrencyWalletSnapshots(userId);

  const entries = await persistence.getCashLedgerEntriesForWalletReplay(userId);
  if (entries.length === 0) {
    return { totalRows: 0, generationRunId };
  }

  const snapshots = buildCurrencyWalletSnapshots(entries, {
    userId,
    generatedAt,
    generationRunId,
  });

  if (snapshots.length > 0) {
    await persistence.bulkUpsertCurrencyWalletSnapshots(userId, snapshots);
  }

  return { totalRows: snapshots.length, generationRunId };
}

interface SnapshotBuildContext {
  userId: string;
  generatedAt: string;
  generationRunId: string;
}

interface WalletGroupState {
  accountId: string;
  currency: string;
  walletState: WalletState;
  pendingDate: string | null;
}

const EMPTY_WALLET_STATE: WalletState = {
  balance: 0,
  wacFxToUsd: null,
  realizedFxPnlLifetime: 0,
};

function buildCurrencyWalletSnapshots(
  entries: CashLedgerEntryForWalletReplay[],
  context: SnapshotBuildContext,
): CurrencyWalletSnapshot[] {
  const snapshots: CurrencyWalletSnapshot[] = [];

  // State map keyed by `${accountId}|${currency}`.
  // Each group tracks the running WalletState and the pending snapshot date.
  const groups = new Map<string, WalletGroupState>();

  for (const entry of entries) {
    const key = `${entry.accountId}|${entry.currency}`;
    let group = groups.get(key);

    if (!group) {
      group = {
        accountId: entry.accountId,
        currency: entry.currency,
        walletState: { ...EMPTY_WALLET_STATE },
        pendingDate: null,
      };
      groups.set(key, group);
    }

    // If this entry is on a new date for this group, flush the prior pending snapshot.
    if (group.pendingDate !== null && entry.entryDate !== group.pendingDate) {
      snapshots.push(buildSnapshot({
        userId: context.userId,
        accountId: group.accountId,
        currency: group.currency,
        date: group.pendingDate,
        state: group.walletState,
        generatedAt: context.generatedAt,
        generationRunId: context.generationRunId,
      }));
    }

    // Apply entry to the wallet state. WalletAccountingError propagates
    // unwrapped per typed-transient-error-catch-audit.md.
    group.walletState = applyEntryToWalletState(group.walletState, {
      amount: entry.amount,
      fxRateToUsd: entry.fxRateToUsd,
      entryDate: entry.entryDate,
      currency: entry.currency,
      accountId: entry.accountId,
    });

    group.pendingDate = entry.entryDate;
  }

  // Final flush — emit the last pending snapshot for each group.
  for (const group of groups.values()) {
    if (group.pendingDate !== null) {
      snapshots.push(buildSnapshot({
        userId: context.userId,
        accountId: group.accountId,
        currency: group.currency,
        date: group.pendingDate,
        state: group.walletState,
        generatedAt: context.generatedAt,
        generationRunId: context.generationRunId,
      }));
    }
  }

  return snapshots;
}

function buildSnapshot(params: {
  userId: string;
  accountId: string;
  currency: string;
  date: string;
  state: WalletState;
  generatedAt: string;
  generationRunId: string;
}): CurrencyWalletSnapshot {
  const isUsd = params.currency === "USD";

  // D10: USD wallet rows always carry wacFxToUsd=1.0, realizedFxPnlLifetime=0, providerSource='frankfurter'.
  // D11: Non-USD rows with computed WAC carry providerSource='frankfurter'.
  //      Non-USD rows without FX inflow → null/0/null (KZO-165 stub backward compat).
  const wacFxToUsd = isUsd
    ? 1.0
    : params.state.wacFxToUsd !== null
      ? roundToDecimal(params.state.wacFxToUsd, 8)
      : null;

  const realizedFxPnlLifetime = isUsd
    ? 0
    : roundToDecimal(params.state.realizedFxPnlLifetime, 2);

  const providerSource = isUsd
    ? "frankfurter"
    : params.state.wacFxToUsd !== null
      ? "frankfurter"
      : null;

  return {
    userId: params.userId,
    accountId: params.accountId,
    currency: params.currency,
    date: params.date,
    balanceNative: roundToDecimal(params.state.balance, 2),
    wacFxToUsd,
    realizedFxPnlLifetime,
    providerSource,
    generatedAt: params.generatedAt,
    generationRunId: params.generationRunId,
  };
}
