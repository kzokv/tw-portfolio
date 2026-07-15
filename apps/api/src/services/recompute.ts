import { createHash, randomUUID } from "node:crypto";
import { calculateBuyFees, calculateSellFees, roundToDecimal, type FeeProfile } from "@vakwen/domain";
import type { RecomputeFeeMode } from "@vakwen/shared-types";
import { routeError } from "../lib/routeError.js";
import { MemoryPersistence } from "../persistence/memory.js";
import type { BookedTradeEvent, RecomputeJob, RecomputePreviewItem, Store } from "../types/store.js";
import { canonicalJsonStringify } from "./canonicalJson.js";
import { listTradeEvents } from "./accountingStore.js";
import { replayPositionHistory } from "./replayPositionHistory.js";
import { recomputeFeeConfigFingerprint } from "./recomputeFeeConfigFingerprint.js";

export const RECOMPUTE_PREVIEW_TTL_MS = 15 * 60 * 1000;

interface PreviewInput {
  userId: string;
  profileId?: string;
  accountId?: string;
  useFallbackBindings: boolean;
  mode?: RecomputeFeeMode;
  accountRevisions?: Record<string, number>;
  now?: Date;
}

interface BuiltPreview {
  items: RecomputePreviewItem[];
  counts: RecomputeJob["counts"];
  impactsByCurrency: RecomputeJob["impactsByCurrency"];
  fingerprint: string;
  feeConfigFingerprint: string;
}

interface ConfirmLifecycle {
  onRunning?: (job: RecomputeJob) => Promise<void>;
  onFailed?: (job: RecomputeJob) => Promise<void>;
}

export function previewRecompute(store: Store, input: PreviewInput): RecomputeJob {
  const now = input.now ?? new Date();
  const mode = input.mode ?? "KEEP_RECORDED";
  const selectedProfile = input.profileId ? mustGetProfile(store, input.profileId) : undefined;
  const built = buildPreview(store, {
    ...input,
    mode,
    profileId: selectedProfile?.id,
  });
  const createdAt = now.toISOString();
  const job: RecomputeJob = {
    id: randomUUID(),
    userId: input.userId,
    accountId: input.accountId,
    profileId: selectedProfile?.id ?? "account-fallback",
    useFallbackBindings: input.useFallbackBindings,
    status: "PREVIEWED",
    mode,
    fingerprint: built.fingerprint,
    expiresAt: new Date(now.getTime() + RECOMPUTE_PREVIEW_TTL_MS).toISOString(),
    counts: built.counts,
    impactsByCurrency: built.impactsByCurrency,
    accountRevisions: input.accountRevisions ?? {},
    feeConfigFingerprint: built.feeConfigFingerprint,
    createdAt,
    items: built.items,
  };

  store.recomputeJobs.push(job);
  return job;
}

export async function confirmRecompute(
  store: Store,
  userId: string,
  jobId: string,
  reviewedFingerprint: string,
  now: Date = new Date(),
  lifecycle: ConfirmLifecycle = {},
): Promise<RecomputeJob> {
  const job = store.recomputeJobs.find((item) => item.id === jobId && item.userId === userId);
  if (!job) throw routeError(404, "job_not_found", "Recompute job not found");
  if (job.status !== "PREVIEWED") {
    throw routeError(409, "recompute_preview_consumed", "Recompute preview is no longer confirmable");
  }
  if (new Date(job.expiresAt).getTime() <= now.getTime()) {
    throw routeError(409, "recompute_preview_expired", "Recompute preview expired");
  }
  if (reviewedFingerprint !== job.fingerprint) {
    throw routeError(409, "recompute_preview_fingerprint_mismatch", "Recompute confirmation does not match the reviewed preview");
  }

  const rebuilt = buildPreview(store, {
    userId,
    accountId: job.accountId,
    profileId: job.profileId === "account-fallback" ? undefined : job.profileId,
    useFallbackBindings: job.useFallbackBindings,
    mode: job.mode,
    accountRevisions: job.accountRevisions,
  });
  if (rebuilt.fingerprint !== job.fingerprint) {
    throw routeError(409, "recompute_preview_drift", "Underlying trades or fee profiles changed after preview");
  }

  job.status = "RUNNING";
  job.startedAt = now.toISOString();
  delete job.errorCode;
  delete job.errorMessage;

  let ownsRunningJob = false;
  try {
    if (lifecycle.onRunning) {
      await lifecycle.onRunning(job);
      ownsRunningJob = true;
    }
    const simulatedStore = structuredClone(store);
    const simulatedJob = simulatedStore.recomputeJobs.find((item) => item.id === job.id)!;
    const tradeById = new Map(listTradeEvents(simulatedStore).map((trade) => [trade.id, trade]));
    const scopes = new Map<string, { accountId: string; ticker: string; marketCode: BookedTradeEvent["marketCode"] }>();

    for (const item of simulatedJob.items) {
      const trade = tradeById.get(item.tradeEventId);
      if (!trade) throw routeError(409, "recompute_preview_drift", `Trade ${item.tradeEventId} no longer exists`);
      trade.commissionAmount = item.nextCommissionAmount;
      trade.taxAmount = item.nextTaxAmount;
      if (item.appliedFeeProfile) trade.feeSnapshot = structuredClone(item.appliedFeeProfile);
      scopes.set(`${trade.accountId}\u0000${trade.ticker}\u0000${trade.marketCode}`, {
        accountId: trade.accountId,
        ticker: trade.ticker,
        marketCode: trade.marketCode,
      });
    }

    const simulation = new MemoryPersistence();
    await simulation.init();
    await simulation.saveStore(simulatedStore);
    await simulation.saveRecomputeJob(simulatedJob);
    for (const scope of [...scopes.values()].sort(compareScopes)) {
      await replayPositionHistory(simulation, userId, scope.accountId, scope.ticker, { marketCode: scope.marketCode });
    }

    const completedStore = await simulation.loadStore(userId);
    const completedJob = completedStore.recomputeJobs.find((item) => item.id === job.id)!;
    completedJob.status = "CONFIRMED";
    completedJob.completedAt = new Date().toISOString();
    Object.assign(store, completedStore);
    return completedJob;
  } catch (error) {
    job.status = "FAILED";
    job.completedAt = new Date().toISOString();
    job.errorCode = errorCode(error);
    job.errorMessage = error instanceof Error ? error.message : String(error);
    if (ownsRunningJob) await lifecycle.onFailed?.(job).catch(() => undefined);
    throw error;
  }
}

function buildPreview(
  store: Store,
  input: Omit<PreviewInput, "mode"> & { mode: RecomputeFeeMode },
): BuiltPreview {
  const selectedProfile = input.profileId ? mustGetProfile(store, input.profileId) : undefined;
  const accountsById = new Map(store.accounts.map((account) => [account.id, account]));
  const candidates = listTradeEvents(store)
    .filter((trade) => trade.userId === input.userId && (!input.accountId || trade.accountId === input.accountId))
    .sort((left, right) => left.id.localeCompare(right.id));

  const reviewed: unknown[] = [];
  const referencedProfileIds = new Set<string>();
  if (input.profileId) referencedProfileIds.add(input.profileId);
  const items = candidates.map((trade): RecomputePreviewItem => {
    const account = accountsById.get(trade.accountId);
    if (!account) throw routeError(404, "account_not_found", `Account not found for transaction ${trade.id}`);
    const binding = input.useFallbackBindings
      ? store.feeProfileBindings.find((item) => item.accountId === trade.accountId && item.ticker === trade.ticker)
      : undefined;
    const fallbackProfileId = selectedProfile?.id ?? account.feeProfileId;
    const resolvedProfile = binding
      ? mustGetProfile(store, binding.feeProfileId)
      : mustGetProfile(store, fallbackProfileId);
    referencedProfileIds.add(resolvedProfile.id);
    const feesSource = trade.feesSource ?? "CALCULATED";
    const shouldRecalculate = input.mode === "RECALCULATE_CALCULATED" && feesSource === "CALCULATED";
    const currency = trade.priceCurrency ?? resolvedProfile.commissionCurrency ?? "TWD";
    const next = shouldRecalculate
      ? calculateTradeFees(trade, resolvedProfile, currency)
      : { commissionAmount: trade.commissionAmount, taxAmount: trade.taxAmount };

    reviewed.push({
      id: trade.id,
      accountId: trade.accountId,
      ticker: trade.ticker,
      marketCode: trade.marketCode,
      instrumentType: trade.instrumentType,
      type: trade.type,
      quantity: trade.quantity,
      unitPrice: trade.unitPrice,
      priceCurrency: trade.priceCurrency,
      tradeDate: trade.tradeDate,
      isDayTrade: trade.isDayTrade,
      commissionAmount: trade.commissionAmount,
      taxAmount: trade.taxAmount,
      feesSource,
      feeSnapshot: trade.feeSnapshot,
      accountFeeProfileId: account.feeProfileId,
      bindingFeeProfileId: binding?.feeProfileId ?? null,
      resolvedProfile,
    });

    return {
      tradeEventId: trade.id,
      currency,
      feesSource,
      previousCommissionAmount: trade.commissionAmount,
      previousTaxAmount: trade.taxAmount,
      nextCommissionAmount: next.commissionAmount,
      nextTaxAmount: next.taxAmount,
      appliedProfileId: shouldRecalculate ? resolvedProfile.id : null,
      appliedFeeProfile: shouldRecalculate ? structuredClone(resolvedProfile) : null,
    };
  });

  const counts = {
    total: items.length,
    calculated: items.filter((item) => item.feesSource === "CALCULATED").length,
    preserved: items.filter((item) => input.mode === "KEEP_RECORDED" || item.feesSource !== "CALCULATED").length,
    changed: items.filter(hasFeeChange).length,
  };
  const currencies = [...new Set(items.map((item) => item.currency))].sort();
  const impactsByCurrency = currencies.map((currency) => ({
    currency,
    commissionDelta: roundToDecimal(items
      .filter((item) => item.currency === currency)
      .reduce((sum, item) => sum + item.nextCommissionAmount - item.previousCommissionAmount, 0), 4),
    taxDelta: roundToDecimal(items
      .filter((item) => item.currency === currency)
      .reduce((sum, item) => sum + item.nextTaxAmount - item.previousTaxAmount, 0), 4),
  }));
  const selectedAccountIds = [...new Set(candidates.map((trade) => trade.accountId))].sort();
  const feeConfigFingerprint = recomputeFeeConfigFingerprint({
    accounts: store.accounts,
    feeProfiles: store.feeProfiles,
    bindings: store.feeProfileBindings,
  }, selectedAccountIds, [...referencedProfileIds].sort());
  const fingerprint = createHash("sha256").update(canonicalJsonStringify({
    mode: input.mode,
    accountId: input.accountId ?? null,
    profileId: input.profileId ?? null,
    useFallbackBindings: input.useFallbackBindings,
    reviewed,
    accountRevisions: input.accountRevisions ?? {},
    feeConfigFingerprint,
  })).digest("hex");
  return { items, counts, impactsByCurrency, fingerprint, feeConfigFingerprint };
}

function calculateTradeFees(trade: BookedTradeEvent, profile: FeeProfile, tradeCurrency: string) {
  const tradeValue = roundToDecimal(trade.unitPrice * trade.quantity, 2);
  return trade.type === "BUY"
    ? calculateBuyFees(profile, tradeValue, tradeCurrency)
    : calculateSellFees(profile, {
        tradeValueAmount: tradeValue,
        tradeCurrency,
        instrumentType: trade.instrumentType,
        isDayTrade: trade.isDayTrade,
        marketCode: trade.marketCode,
      });
}

function hasFeeChange(item: RecomputePreviewItem): boolean {
  return roundToDecimal(item.previousCommissionAmount, 4) !== roundToDecimal(item.nextCommissionAmount, 4)
    || roundToDecimal(item.previousTaxAmount, 4) !== roundToDecimal(item.nextTaxAmount, 4);
}

function compareScopes(
  left: { accountId: string; ticker: string; marketCode: string },
  right: { accountId: string; ticker: string; marketCode: string },
): number {
  return left.accountId.localeCompare(right.accountId)
    || left.ticker.localeCompare(right.ticker)
    || left.marketCode.localeCompare(right.marketCode);
}

function errorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string") return error.code;
  return "recompute_failed";
}

function mustGetProfile(store: Store, profileId: string): FeeProfile {
  const profile = store.feeProfiles.find((item) => item.id === profileId);
  if (!profile) throw routeError(404, "fee_profile_not_found", `Fee profile ${profileId} not found`);
  return profile;
}
