import { randomUUID } from "node:crypto";
import { calculateBuyFees, calculateSellFees, roundToDecimal, type FeeProfile } from "@tw-portfolio/domain";
import { routeError } from "../lib/routeError.js";
import { deriveRealizedPnlForTrade, listTradeEvents } from "./accountingStore.js";
import { bookTradeSettlementRecompute } from "./cashLedgerService.js";
import type { RecomputeJob, RecomputePreviewItem, Store } from "../types/store.js";

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
      throw routeError(404, "account_not_found", `Account not found for transaction ${tx.id}`);
    }

    // KZO-183: bindings no longer carry `marketCode` — the market is derived
    // from the binding's account.defaultCurrency. Resolution is keyed solely
    // by (accountId, ticker).
    const symbolBinding = input.useFallbackBindings
      ? store.feeProfileBindings.find(
          (binding) => binding.accountId === tx.accountId && binding.ticker === tx.ticker,
        )
      : undefined;
    const fallbackProfileId = selectedProfile?.id ?? account.feeProfileId;
    const profile = symbolBinding ? mustGetProfile(store, symbolBinding.feeProfileId) : mustGetProfile(store, fallbackProfileId);
    const tradeCurrency = tx.priceCurrency ?? profile.commissionCurrency ?? "TWD";

    const tradeValue = roundToDecimal(tx.unitPrice * tx.quantity, 2);
    const next =
      tx.type === "BUY"
        ? calculateBuyFees(profile, tradeValue, tradeCurrency)
        : calculateSellFees(profile, {
            tradeValueAmount: tradeValue,
            tradeCurrency,
            instrumentType: tx.instrumentType,
            isDayTrade: tx.isDayTrade,
            // KZO-169: marketCode is required on BookedTradeEvent — the
            // legacy `?? "TW"` was provider-stamping audit (G1) target.
            marketCode: tx.marketCode,
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
  if (!job) throw routeError(404, "job_not_found", "Recompute job not found");

  for (const item of job.items) {
    const tx = listTradeEvents(store).find((entry) => entry.id === item.tradeEventId);
    if (!tx) continue;

    tx.commissionAmount = item.nextCommissionAmount;
    tx.taxAmount = item.nextTaxAmount;
    // KZO-167: route through cashLedgerService so the currency-match guard
    // fires on path 3 (fee-profile recompute single-trade replacement)
    // before delegating to replaceCashLedgerEntryForTrade.
    bookTradeSettlementRecompute(store, tx);

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
  if (!profile) throw routeError(404, "fee_profile_not_found", `Fee profile ${profileId} not found`);
  return profile;
}

// KZO-167: `buildTradeSettlementCashEntry` lives in `cashLedgerService.ts`
// and `bookTradeSettlementRecompute` (imported above) wraps it with the
// currency-match guard. The local copy was removed to consolidate the
// builder shared with `portfolio.ts`.
