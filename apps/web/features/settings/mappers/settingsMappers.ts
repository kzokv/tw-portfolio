import type { AccountDto, FeeProfileBindingDto, FeeProfileDto, UserSettings } from "@tw-portfolio/shared-types";
import type { SaveSettingsRequest, SettingsFormModel, SettingsProfileModel } from "../types/settingsUi";

export function toSettingsProfileModel(profile: FeeProfileDto): SettingsProfileModel {
  return {
    id: profile.id,
    name: profile.name,
    commissionRateBps: profile.commissionRateBps,
    commissionDiscountBps: profile.commissionDiscountBps,
    minCommissionNtd: profile.minCommissionNtd,
    commissionRoundingMode: profile.commissionRoundingMode,
    taxRoundingMode: profile.taxRoundingMode,
    stockSellTaxRateBps: profile.stockSellTaxRateBps,
    stockDayTradeTaxRateBps: profile.stockDayTradeTaxRateBps,
    etfSellTaxRateBps: profile.etfSellTaxRateBps,
    bondEtfSellTaxRateBps: profile.bondEtfSellTaxRateBps,
  };
}

export function toSettingsFormModel(
  settings: UserSettings,
  accounts: AccountDto[],
  feeProfiles: FeeProfileDto[],
  feeProfileBindings: FeeProfileBindingDto[],
): SettingsFormModel {
  return {
    locale: settings.locale,
    costBasisMethod: settings.costBasisMethod,
    quotePollIntervalSeconds: settings.quotePollIntervalSeconds,
    feeProfiles: feeProfiles.map(toSettingsProfileModel),
    accounts: accounts.map((account) => ({
      id: account.id,
      feeProfileId: account.feeProfileId,
    })),
    feeProfileBindings: feeProfileBindings.map((binding) => ({
      accountId: binding.accountId,
      symbol: binding.symbol,
      feeProfileId: binding.feeProfileId,
    })),
  };
}

export function toSaveSettingsRequest(model: SettingsFormModel): SaveSettingsRequest {
  return {
    settings: {
      locale: model.locale,
      costBasisMethod: model.costBasisMethod,
      quotePollIntervalSeconds: model.quotePollIntervalSeconds,
    },
    feeProfiles: model.feeProfiles.map((profile) => {
      const payload = {
        name: profile.name,
        commissionRateBps: profile.commissionRateBps,
        commissionDiscountBps: profile.commissionDiscountBps,
        minCommissionNtd: profile.minCommissionNtd,
        commissionRoundingMode: profile.commissionRoundingMode,
        taxRoundingMode: profile.taxRoundingMode,
        stockSellTaxRateBps: profile.stockSellTaxRateBps,
        stockDayTradeTaxRateBps: profile.stockDayTradeTaxRateBps,
        etfSellTaxRateBps: profile.etfSellTaxRateBps,
        bondEtfSellTaxRateBps: profile.bondEtfSellTaxRateBps,
      };

      if (profile.id.startsWith("tmp-")) {
        return { ...payload, tempId: profile.id };
      }

      return { ...payload, id: profile.id };
    }),
    accounts: model.accounts.map((account) => ({
      id: account.id,
      feeProfileRef: account.feeProfileId,
    })),
    feeProfileBindings: model.feeProfileBindings.map((binding) => ({
      accountId: binding.accountId,
      symbol: binding.symbol,
      feeProfileRef: binding.feeProfileId,
    })),
  };
}
