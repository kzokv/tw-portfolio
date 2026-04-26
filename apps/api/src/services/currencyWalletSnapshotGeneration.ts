import { randomUUID } from "node:crypto";
import { roundToDecimal } from "@tw-portfolio/domain";
import type {
  CashLedgerEntryForBalance,
  CurrencyWalletSnapshot,
  Persistence,
} from "../persistence/types.js";

/**
 * KZO-165 currency wallet snapshot stub writer.
 *
 * Walks the user's cash ledger entries, grouping by `(accountId, currency)`, and emits
 * one wallet snapshot row per `(accountId, currency, date-with-activity)` carrying the
 * running balance.
 *
 * **Out of scope for KZO-165 (owned by KZO-166):**
 * - WAC (`wac_fx_to_usd`) computation — always written as `null` here.
 * - Realized FX P&L crystallization (`realized_fx_pnl_lifetime`) — always written as `0`.
 * - Provider source attribution (`provider_source`) — always written as `null` until
 *   KZO-166 wires real FX rates and stamps the provider that supplied them.
 *
 * The service goes through the persistence interface; no raw SQL inline. This keeps the
 * Postgres / Memory boundaries narrow and makes the writer trivially testable on Memory.
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

  const entries = await persistence.getCashLedgerEntriesForBalances(userId);
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
  runningBalance: number;
  pendingDate: string | null;
}

function buildCurrencyWalletSnapshots(
  entries: CashLedgerEntryForBalance[],
  context: SnapshotBuildContext,
): CurrencyWalletSnapshot[] {
  const snapshots: CurrencyWalletSnapshot[] = [];
  let group: WalletGroupState | null = null;

  // Persistence returns rows sorted (accountId ASC, currency ASC, entryDate ASC),
  // so this can stream without an extra sort. Within a group it emits one row per
  // distinct activity date with the cumulative balance through that date.
  for (const entry of entries) {
    if (!group || !isSameGroup(group, entry)) {
      flushPendingSnapshot(snapshots, group, context);
      group = startGroup(entry);
    } else if (group.pendingDate !== null && entry.entryDate !== group.pendingDate) {
      flushPendingSnapshot(snapshots, group, context);
    }

    group.runningBalance = roundToDecimal(group.runningBalance + entry.amount, 2);
    group.pendingDate = entry.entryDate;
  }

  flushPendingSnapshot(snapshots, group, context);
  return snapshots;
}

function startGroup(entry: CashLedgerEntryForBalance): WalletGroupState {
  return {
    accountId: entry.accountId,
    currency: entry.currency,
    runningBalance: 0,
    pendingDate: null,
  };
}

function isSameGroup(group: WalletGroupState, entry: CashLedgerEntryForBalance): boolean {
  return group.accountId === entry.accountId && group.currency === entry.currency;
}

function flushPendingSnapshot(
  snapshots: CurrencyWalletSnapshot[],
  group: WalletGroupState | null,
  context: SnapshotBuildContext,
): void {
  if (group === null || group.pendingDate === null) return;
  snapshots.push(buildSnapshot({
    userId: context.userId,
    accountId: group.accountId,
    currency: group.currency,
    date: group.pendingDate,
    balance: group.runningBalance,
    generatedAt: context.generatedAt,
    generationRunId: context.generationRunId,
  }));
}

function buildSnapshot(params: {
  userId: string;
  accountId: string;
  currency: string;
  date: string;
  balance: number;
  generatedAt: string;
  generationRunId: string;
}): CurrencyWalletSnapshot {
  return {
    userId: params.userId,
    accountId: params.accountId,
    currency: params.currency,
    date: params.date,
    balanceNative: params.balance,
    // KZO-166 will populate. Always null/0/null on KZO-165 stub rows.
    wacFxToUsd: null,
    realizedFxPnlLifetime: 0,
    providerSource: null,
    generatedAt: params.generatedAt,
    generationRunId: params.generationRunId,
  };
}
