import { randomUUID } from "node:crypto";
import { calculateBuyFees, calculateSellFees, type FeeProfile } from "@tw-portfolio/domain";
import { deriveRealizedPnlForTrade, listTradeEvents, replaceCashLedgerEntryForTrade } from "./accountingStore.js";
import type { CashLedgerEntry, RecomputeJob, RecomputePreviewItem, Store, Transaction } from "../types/store.js";

interface PreviewInput {
  userId: string;
  profileId?: string;
  accountId?: string;
  useFallbackBindings: boolean;
}

export function previewRecompute(store: Store, input: PreviewInput): RecomputeJob {
  const selectedProfile = input.profileId ? mustGetProfile(store, input.profileId) : undefined;
  const accountsById = new Map(store.accounts.map((account) => [account.id, account]));
  const candidates = listTradeEvents(store).filter(
    (tx) => tx.userId === input.userId && (!input.accountId || tx.accountId === input.accountId),
  );

  const items: RecomputePreviewItem[] = candidates.map((tx) => {
    const account = accountsById.get(tx.accountId);
    if (!account) {
      throw new Error(`Account not found for transaction ${tx.id}`);
    }

    const symbolBinding = input.useFallbackBindings
      ? store.feeProfileBindings.find((binding) => binding.accountId === tx.accountId && binding.symbol === tx.symbol)
      : undefined;
    const fallbackProfileId = selectedProfile?.id ?? account.feeProfileId;
    const profile = symbolBinding ? mustGetProfile(store, symbolBinding.feeProfileId) : mustGetProfile(store, fallbackProfileId);
    const tradeCurrency = tx.priceCurrency ?? profile.commissionCurrency ?? "TWD";

    const tradeValue = tx.unitPrice * tx.quantity;
    const next =
      tx.type === "BUY"
        ? calculateBuyFees(profile, tradeValue, tradeCurrency)
        : calculateSellFees(profile, {
            tradeValueAmount: tradeValue,
            tradeCurrency,
            instrumentType: tx.instrumentType,
            isDayTrade: tx.isDayTrade,
          });

    return {
      tradeEventId: tx.id,
      previousCommissionAmount: tx.commissionAmount,
      previousTaxAmount: tx.taxAmount,
      nextCommissionAmount: next.commissionAmount,
      nextTaxAmount: next.taxAmount,
    };
  });

  const job: RecomputeJob = {
    id: randomUUID(),
    userId: input.userId,
    accountId: input.accountId,
    profileId: selectedProfile?.id ?? "account-fallback",
    status: "PREVIEWED",
    createdAt: new Date().toISOString(),
    items,
  };

  store.recomputeJobs.push(job);
  return job;
}

export function confirmRecompute(store: Store, userId: string, jobId: string): RecomputeJob {
  const job = store.recomputeJobs.find((item) => item.id === jobId && item.userId === userId);
  if (!job) throw new Error("Recompute job not found");

  for (const item of job.items) {
    const tx = listTradeEvents(store).find((entry) => entry.id === item.tradeEventId);
    if (!tx) continue;

    tx.commissionAmount = item.nextCommissionAmount;
    tx.taxAmount = item.nextTaxAmount;
    replaceCashLedgerEntryForTrade(store, tx.id, buildTradeSettlementCashEntry(tx));

    if (tx.type === "SELL") {
      tx.realizedPnlAmount = deriveRealizedPnlForTrade(store.accounting, tx);
      tx.realizedPnlCurrency =
        tx.realizedPnlAmount === undefined
          ? undefined
          : (tx.priceCurrency ?? tx.feeSnapshot.commissionCurrency ?? "TWD");
    }
  }

  job.status = "CONFIRMED";
  return job;
}

function mustGetProfile(store: Store, profileId: string): FeeProfile {
  const profile = store.feeProfiles.find((item) => item.id === profileId);
  if (!profile) throw new Error("Fee profile not found");
  return profile;
}

function buildTradeSettlementCashEntry(tx: Transaction): CashLedgerEntry {
  const grossTradeValueAmount = tx.quantity * tx.unitPrice;
  const settlementAmount =
    tx.type === "BUY"
      ? -(grossTradeValueAmount + tx.commissionAmount + tx.taxAmount)
      : grossTradeValueAmount - tx.commissionAmount - tx.taxAmount;

  return {
    id: `cash-${tx.id}`,
    userId: tx.userId,
    accountId: tx.accountId,
    entryDate: tx.tradeDate,
    entryType: tx.type === "BUY" ? "TRADE_SETTLEMENT_OUT" : "TRADE_SETTLEMENT_IN",
    amount: settlementAmount,
    currency: tx.priceCurrency ?? tx.feeSnapshot.commissionCurrency ?? "TWD",
    relatedTradeEventId: tx.id,
    sourceType: "trade_settlement",
    sourceReference: tx.id,
    bookedAt: tx.bookedAt,
  };
}
