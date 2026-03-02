import type { AppDictionary } from "../../../lib/i18n";
import type { SettingsFormModel } from "../types/settingsUi";

export function validateSettingsForm(model: SettingsFormModel, dict: AppDictionary): string {
  if (!Number.isInteger(model.quotePollIntervalSeconds) || model.quotePollIntervalSeconds <= 0) {
    return dict.settings.validationQuotePoll;
  }

  if (model.feeProfiles.length === 0) {
    return dict.settings.validationAtLeastOneProfile;
  }

  const profileIds = new Set(model.feeProfiles.map((profile) => profile.id));

  for (const profile of model.feeProfiles) {
    if (!profile.name.trim()) {
      return dict.settings.validationProfileName;
    }

    const numericValues = [
      profile.commissionRateBps,
      profile.commissionDiscountBps,
      profile.minCommissionNtd,
      profile.stockSellTaxRateBps,
      profile.stockDayTradeTaxRateBps,
      profile.etfSellTaxRateBps,
      profile.bondEtfSellTaxRateBps,
    ];

    if (numericValues.some((value) => !Number.isInteger(value) || value < 0)) {
      return dict.settings.validationProfileNumbers;
    }

    if (profile.commissionDiscountBps <= 0) {
      return dict.settings.validationDiscount;
    }
  }

  for (const account of model.accounts) {
    if (!profileIds.has(account.feeProfileId)) {
      return dict.settings.validationAccountProfile;
    }
  }

  for (const binding of model.feeProfileBindings) {
    if (!/^[A-Z0-9]{1,16}$/.test(binding.symbol)) {
      return dict.settings.validationBindingSymbol;
    }

    if (!model.accounts.some((account) => account.id === binding.accountId)) {
      return dict.settings.validationBindingAccount;
    }

    if (!profileIds.has(binding.feeProfileId)) {
      return dict.settings.validationBindingProfile;
    }
  }

  return "";
}
