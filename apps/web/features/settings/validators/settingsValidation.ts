import type { AppDictionary } from "../../../lib/i18n";
import type { SettingsFormModel } from "../types/settingsUi";

export function validateSettingsForm(model: SettingsFormModel, dict: AppDictionary): string {
  if (!Number.isInteger(model.quotePollIntervalSeconds) || model.quotePollIntervalSeconds <= 0) {
    return dict.settings.validationQuotePoll;
  }

  if (model.feeProfiles.length === 0) {
    return dict.settings.validationAtLeastOneProfile;
  }

  const profilesById = new Map(model.feeProfiles.map((profile) => [profile.id, profile]));
  const accountIds = new Set(model.accounts.map((account) => account.id));

  for (const profile of model.feeProfiles) {
    if (!profile.name.trim()) {
      return dict.settings.validationProfileName;
    }

    // KZO-183: profile must be owned by an account in the form.
    if (!accountIds.has(profile.accountId)) {
      return dict.settings.validationAccountProfile;
    }

    if (!/^[A-Z]{3}$/.test(profile.commissionCurrency)) {
      return dict.settings.validationProfileCurrency;
    }

    const numericValues = [
      profile.boardCommissionRate,
      profile.minimumCommissionAmount,
      profile.stockSellTaxRateBps,
      profile.stockDayTradeTaxRateBps,
      profile.etfSellTaxRateBps,
      profile.bondEtfSellTaxRateBps,
    ];

    if (numericValues.some((value) => !Number.isFinite(value) || value < 0)) {
      return dict.settings.validationProfileNumbers;
    }

    if (!Number.isFinite(profile.commissionDiscountPercent) || profile.commissionDiscountPercent < 0 || profile.commissionDiscountPercent > 100) {
      return dict.settings.validationDiscount;
    }
  }

  for (const account of model.accounts) {
    const profile = profilesById.get(account.feeProfileId);
    // KZO-183: every account's default profile must exist AND be owned by
    // that same account (mirrors the composite-FK invariant in Postgres).
    if (!profile || profile.accountId !== account.id) {
      return dict.settings.validationAccountProfile;
    }
  }

  for (const binding of model.feeProfileBindings) {
    if (!/^[A-Z0-9]{1,16}$/.test(binding.ticker)) {
      return dict.settings.validationBindingTicker;
    }

    if (!accountIds.has(binding.accountId)) {
      return dict.settings.validationBindingAccount;
    }

    const profile = profilesById.get(binding.feeProfileId);
    // KZO-183: per-symbol overrides must point at a profile owned by the
    // binding's account.
    if (!profile || profile.accountId !== binding.accountId) {
      return dict.settings.validationBindingProfile;
    }
  }

  return "";
}
