import type { SettingsFormModel, SettingsProfileModel } from "../types/settingsUi";

export function cloneSettingsForm(input: SettingsFormModel): SettingsFormModel {
  return {
    locale: input.locale,
    costBasisMethod: input.costBasisMethod,
    quotePollIntervalSeconds: input.quotePollIntervalSeconds,
    feeProfiles: input.feeProfiles.map((profile) => ({ ...profile })),
    accounts: input.accounts.map((account) => ({ ...account })),
    feeProfileBindings: input.feeProfileBindings.map((binding) => ({ ...binding })),
  };
}

export function serializeSettingsForm(input: SettingsFormModel): string {
  const sortedProfiles = [...input.feeProfiles].sort((left, right) => left.id.localeCompare(right.id));
  const sortedAccounts = [...input.accounts].sort((left, right) => left.id.localeCompare(right.id));
  const sortedBindings = [...input.feeProfileBindings].sort((left, right) =>
    `${left.accountId}:${left.ticker}`.localeCompare(`${right.accountId}:${right.ticker}`),
  );

  return JSON.stringify({
    ...input,
    feeProfiles: sortedProfiles,
    accounts: sortedAccounts,
    feeProfileBindings: sortedBindings,
  });
}

// KZO-183: profiles now belong to a specific account. Callers pass the
// owning account id; the legacy single-arg signature is retained as a
// type-checked fallback so existing call sites compile until they migrate.
export function createDraftProfile(seed: number, accountId = ""): SettingsProfileModel {
  return {
    id: `tmp-${seed}`,
    accountId,
    name: "New Fee Profile",
    boardCommissionRate: 1.425,
    commissionDiscountPercent: 100,
    minimumCommissionAmount: 20,
    commissionCurrency: "TWD",
    commissionRoundingMode: "FLOOR",
    taxRoundingMode: "FLOOR",
    stockSellTaxRateBps: 30,
    stockDayTradeTaxRateBps: 15,
    etfSellTaxRateBps: 10,
    bondEtfSellTaxRateBps: 0,
    commissionChargeMode: "CHARGED_UPFRONT",
  };
}

export function normalizeSettingsForm(input: SettingsFormModel): SettingsFormModel {
  return {
    ...input,
    feeProfiles: input.feeProfiles.map((profile) => ({
      ...profile,
      commissionCurrency: profile.commissionCurrency.trim().toUpperCase(),
    })),
    feeProfileBindings: input.feeProfileBindings.map((binding) => ({
      ...binding,
      ticker: binding.ticker.trim().toUpperCase(),
    })),
  };
}

export function removeProfileFromSettingsForm(input: SettingsFormModel, profileId: string): SettingsFormModel {
  // KZO-183: profiles are account-scoped, so the fallback for an account
  // whose default got removed must come from another profile owned by the
  // same account. Per-symbol overrides pointing at the removed profile are
  // dropped (any account they belonged to no longer has a valid target).
  const remainingProfiles = input.feeProfiles.filter((profile) => profile.id !== profileId);
  const fallbackByAccount = new Map<string, string>();
  for (const profile of remainingProfiles) {
    if (!fallbackByAccount.has(profile.accountId)) {
      fallbackByAccount.set(profile.accountId, profile.id);
    }
  }

  return {
    ...input,
    feeProfiles: remainingProfiles,
    accounts: input.accounts.map((account) => {
      if (account.feeProfileId !== profileId) return { ...account };
      const fallback = fallbackByAccount.get(account.id) ?? "";
      return { ...account, feeProfileId: fallback };
    }),
    feeProfileBindings: input.feeProfileBindings
      .filter((binding) => binding.feeProfileId !== profileId)
      .map((binding) => ({ ...binding })),
  };
}
