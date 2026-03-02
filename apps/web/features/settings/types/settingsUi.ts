import type { CostBasisMethod, LocaleCode } from "@tw-portfolio/shared-types";

export interface SettingsProfileModel {
  id: string;
  name: string;
  commissionRateBps: number;
  commissionDiscountBps: number;
  minCommissionNtd: number;
  commissionRoundingMode: "FLOOR" | "ROUND" | "CEIL";
  taxRoundingMode: "FLOOR" | "ROUND" | "CEIL";
  stockSellTaxRateBps: number;
  stockDayTradeTaxRateBps: number;
  etfSellTaxRateBps: number;
  bondEtfSellTaxRateBps: number;
}

export interface SettingsAccountBindingModel {
  id: string;
  feeProfileId: string;
}

export interface SettingsSecurityBindingModel {
  accountId: string;
  symbol: string;
  feeProfileId: string;
}

export interface SettingsFormModel {
  locale: LocaleCode;
  costBasisMethod: CostBasisMethod;
  quotePollIntervalSeconds: number;
  feeProfiles: SettingsProfileModel[];
  accounts: SettingsAccountBindingModel[];
  feeProfileBindings: SettingsSecurityBindingModel[];
}

export type SettingsTab = "general" | "fees";

export interface SaveSettingsRequest {
  settings: {
    locale: LocaleCode;
    costBasisMethod: CostBasisMethod;
    quotePollIntervalSeconds: number;
  };
  feeProfiles: Array<
    | ({
        id: string;
      } & Omit<SettingsProfileModel, "id">)
    | ({
        tempId: string;
      } & Omit<SettingsProfileModel, "id">)
  >;
  accounts: Array<{
    id: string;
    feeProfileRef: string;
  }>;
  feeProfileBindings: Array<{
    accountId: string;
    symbol: string;
    feeProfileRef: string;
  }>;
}
