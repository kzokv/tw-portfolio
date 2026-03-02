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
    `${left.accountId}:${left.symbol}`.localeCompare(`${right.accountId}:${right.symbol}`),
  );

  return JSON.stringify({
    ...input,
    feeProfiles: sortedProfiles,
    accounts: sortedAccounts,
    feeProfileBindings: sortedBindings,
  });
}

export function createDraftProfile(seed: number): SettingsProfileModel {
  return {
    id: `tmp-${seed}`,
    name: "New Fee Profile",
    commissionRateBps: 14,
    commissionDiscountBps: 10000,
    minCommissionNtd: 20,
    commissionRoundingMode: "FLOOR",
    taxRoundingMode: "FLOOR",
    stockSellTaxRateBps: 30,
    stockDayTradeTaxRateBps: 15,
    etfSellTaxRateBps: 10,
    bondEtfSellTaxRateBps: 0,
  };
}

export function normalizeSettingsForm(input: SettingsFormModel): SettingsFormModel {
  return {
    ...input,
    feeProfileBindings: input.feeProfileBindings.map((binding) => ({
      ...binding,
      symbol: binding.symbol.trim().toUpperCase(),
    })),
  };
}

export function removeProfileFromSettingsForm(input: SettingsFormModel, profileId: string): SettingsFormModel {
  const remainingProfiles = input.feeProfiles.filter((profile) => profile.id !== profileId);
  const fallbackProfileId = remainingProfiles[0]?.id ?? "";

  return {
    ...input,
    feeProfiles: remainingProfiles,
    accounts: input.accounts.map((account) => ({
      ...account,
      feeProfileId: account.feeProfileId === profileId ? fallbackProfileId : account.feeProfileId,
    })),
    feeProfileBindings: input.feeProfileBindings
      .filter((binding) => binding.feeProfileId !== profileId)
      .map((binding) => ({ ...binding })),
  };
}
