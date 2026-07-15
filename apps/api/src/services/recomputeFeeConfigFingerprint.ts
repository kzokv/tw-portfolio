import { createHash } from "node:crypto";
import type { FeeProfile } from "@vakwen/domain";
import { canonicalJsonStringify } from "./canonicalJson.js";

interface FeeConfigFingerprintInput {
  accounts: readonly { id: string; feeProfileId: string }[];
  feeProfiles: readonly FeeProfile[];
  bindings: readonly { accountId: string; ticker: string; feeProfileId: string }[];
}

interface RecomputeProfileReferences {
  profileId: string;
  items: readonly { appliedProfileId: string | null }[];
}

export function recomputeReferencedProfileIds(job: RecomputeProfileReferences): string[] {
  const profileIds = new Set(job.items.flatMap((item) => item.appliedProfileId ? [item.appliedProfileId] : []));
  if (job.profileId !== "account-fallback") profileIds.add(job.profileId);
  return [...profileIds].sort();
}

export function recomputeFeeConfigFingerprint(
  input: FeeConfigFingerprintInput,
  selectedAccountIds: readonly string[],
  referencedProfileIds: readonly string[] = [],
): string {
  const accountIds = new Set(selectedAccountIds);
  const profileIds = new Set(referencedProfileIds);
  return createHash("sha256").update(canonicalJsonStringify({
    accounts: input.accounts
      .filter((account) => accountIds.has(account.id))
      .map((account) => ({ id: account.id, feeProfileId: account.feeProfileId }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    feeProfiles: input.feeProfiles
      .filter((profile) => accountIds.has(profile.accountId) || profileIds.has(profile.id))
      .sort((left, right) => left.id.localeCompare(right.id)),
    bindings: input.bindings
      .filter((binding) => accountIds.has(binding.accountId))
      .sort((left, right) => left.accountId.localeCompare(right.accountId) || left.ticker.localeCompare(right.ticker)),
  })).digest("hex");
}
