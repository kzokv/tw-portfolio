import type { CostBasisMethod, CurrencyCode, LocaleCode } from "@tw-portfolio/shared-types";

export interface SettingsProfileModel {
  id: string;
  // KZO-183: every fee profile is owned by exactly one account. The form
  // model carries the discriminator flat (mirrors the wire DTO) and the
  // per-account expandable cards filter on it. Backend B2 lands the same
  // field on `FeeProfileDto`; until then the mapper casts at the boundary.
  accountId: string;
  name: string;
  boardCommissionRate: number;
  commissionDiscountPercent: number;
  minimumCommissionAmount: number;
  commissionCurrency: CurrencyCode;
  commissionRoundingMode: "FLOOR" | "ROUND" | "CEIL";
  taxRoundingMode: "FLOOR" | "ROUND" | "CEIL";
  stockSellTaxRateBps: number;
  stockDayTradeTaxRateBps: number;
  etfSellTaxRateBps: number;
  bondEtfSellTaxRateBps: number;
  commissionChargeMode: "CHARGED_UPFRONT" | "CHARGED_UPFRONT_REBATED_LATER";
}

export interface SettingsAccountBindingModel {
  id: string;
  feeProfileId: string;
}

export interface SettingsSecurityBindingModel {
  accountId: string;
  ticker: string;
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

// KZO-183: "fees" tab removed; per-account fee-profile UX moves into the
// Accounts tab.
export type SettingsTab = "profile" | "general" | "accounts" | "tickers" | "display";

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
  // KZO-183: profile→account ownership flows through the wire shape too.
  accounts: Array<{
    id: string;
    feeProfileRef: string;
  }>;
  feeProfileBindings: Array<{
    accountId: string;
    ticker: string;
    feeProfileRef: string;
  }>;
}
