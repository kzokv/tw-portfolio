import { applyRounding, bpsAmount, permilleAmount } from "./money.js";
import type {
  AppliedTaxComponent,
  CurrencyCode,
  DayTradeScope,
  FeeProfile,
  FeeProfileTaxRule,
  InstrumentType,
  MarketCode,
} from "./types.js";

export interface TradeFeeInput {
  tradeValueAmount: number;
  tradeCurrency: CurrencyCode;
  instrumentType: InstrumentType;
  isDayTrade: boolean;
  marketCode?: MarketCode;
}

export interface TradeFeeResult {
  commissionAmount: number;
  taxAmount: number;
  currency: CurrencyCode;
  taxComponents: AppliedTaxComponent[];
}

export function calculateBuyFees(
  profile: FeeProfile,
  tradeValueAmount: number,
  tradeCurrency: CurrencyCode,
): TradeFeeResult {
  const commissionCurrency = profile.commissionCurrency ?? "TWD";
  if (tradeCurrency !== commissionCurrency) {
    throw new Error("Trade currency must match fee profile commission currency");
  }

  const discountMultiplier = 1 - profile.commissionDiscountPercent / 100;
  const rawCommission = permilleAmount(tradeValueAmount, profile.boardCommissionRate) * discountMultiplier;
  const roundedCommission = applyRounding(rawCommission, profile.commissionRoundingMode);
  return {
    commissionAmount: Math.max(profile.minimumCommissionAmount, roundedCommission),
    taxAmount: 0,
    currency: tradeCurrency,
    taxComponents: [],
  };
}

export function calculateSellFees(profile: FeeProfile, input: TradeFeeInput): TradeFeeResult {
  const commissionCurrency = profile.commissionCurrency ?? "TWD";
  if (input.tradeCurrency !== commissionCurrency) {
    throw new Error("Trade currency must match fee profile commission currency");
  }

  const buyLike = calculateBuyFees(profile, input.tradeValueAmount, input.tradeCurrency);
  const taxComponents = calculateAppliedTaxComponents(profile, input);
  return {
    commissionAmount: buyLike.commissionAmount,
    taxAmount: taxComponents.reduce((total, component) => total + component.taxAmount, 0),
    currency: input.tradeCurrency,
    taxComponents,
  };
}

export function materializeFeeProfileTaxRules(profile: FeeProfile): FeeProfileTaxRule[] {
  if (profile.taxRules?.length) {
    return [...profile.taxRules].sort((left, right) => left.sortOrder - right.sortOrder);
  }

  return [
    buildLegacyRule(profile.id, "stock-sell", "STOCK", "NON_DAY_TRADE_ONLY", profile.stockSellTaxRateBps, 1),
    buildLegacyRule(profile.id, "stock-day-trade-sell", "STOCK", "DAY_TRADE_ONLY", profile.stockDayTradeTaxRateBps, 2),
    buildLegacyRule(profile.id, "etf-sell", "ETF", "ANY", profile.etfSellTaxRateBps, 3),
    buildLegacyRule(profile.id, "bond-etf-sell", "BOND_ETF", "ANY", profile.bondEtfSellTaxRateBps, 4),
  ];
}

export function projectLegacyFeeProfileTaxFields(rules: FeeProfileTaxRule[]): Pick<
  FeeProfile,
  "stockSellTaxRateBps" | "stockDayTradeTaxRateBps" | "etfSellTaxRateBps" | "bondEtfSellTaxRateBps"
> {
  const materialized = [...rules].sort((left, right) => left.sortOrder - right.sortOrder);

  return {
    stockSellTaxRateBps: findLegacyRate(materialized, "STOCK", "NON_DAY_TRADE_ONLY"),
    stockDayTradeTaxRateBps: findLegacyRate(materialized, "STOCK", "DAY_TRADE_ONLY"),
    etfSellTaxRateBps: findLegacyRate(materialized, "ETF", "ANY"),
    bondEtfSellTaxRateBps: findLegacyRate(materialized, "BOND_ETF", "ANY"),
  };
}

export function resolveApplicableSellTaxRules(
  profile: FeeProfile,
  instrumentType: InstrumentType,
  isDayTrade: boolean,
  marketCode: MarketCode = "TW",
): FeeProfileTaxRule[] {
  const dayTradeScope: DayTradeScope = instrumentType === "STOCK" ? (isDayTrade ? "DAY_TRADE_ONLY" : "NON_DAY_TRADE_ONLY") : "ANY";

  return materializeFeeProfileTaxRules(profile).filter(
    (rule) =>
      rule.tradeSide === "SELL" &&
      rule.marketCode === marketCode &&
      rule.instrumentType === instrumentType &&
      rule.dayTradeScope === dayTradeScope,
  );
}

export function calculateAppliedTaxComponents(
  profile: FeeProfile,
  input: Pick<TradeFeeInput, "tradeValueAmount" | "instrumentType" | "isDayTrade" | "marketCode">,
): AppliedTaxComponent[] {
  return resolveApplicableSellTaxRules(profile, input.instrumentType, input.isDayTrade, input.marketCode).map((rule) => ({
    ...rule,
    taxAmount: applyRounding(calculateTaxAmountForRule(input.tradeValueAmount, rule), profile.taxRoundingMode),
  }));
}

function calculateTaxAmountForRule(tradeValueAmount: number, rule: FeeProfileTaxRule): number {
  if (rule.calculationMethod !== "RATE_BPS") {
    throw new Error(`Unsupported tax calculation method ${rule.calculationMethod}`);
  }

  return bpsAmount(tradeValueAmount, rule.rateBps);
}

function buildLegacyRule(
  profileId: string,
  suffix: string,
  instrumentType: InstrumentType,
  dayTradeScope: DayTradeScope,
  rateBps: number,
  sortOrder: number,
): FeeProfileTaxRule {
  return {
    id: `${profileId}:tax-rule:${suffix}`,
    marketCode: "TW",
    tradeSide: "SELL",
    instrumentType,
    dayTradeScope,
    taxComponentCode: "SECURITIES_TRANSACTION_TAX",
    calculationMethod: "RATE_BPS",
    rateBps,
    sortOrder,
  };
}

function findLegacyRate(
  rules: FeeProfileTaxRule[],
  instrumentType: InstrumentType,
  dayTradeScope: DayTradeScope,
): number {
  return (
    rules.find(
      (rule) =>
        rule.tradeSide === "SELL" &&
        rule.marketCode === "TW" &&
        rule.instrumentType === instrumentType &&
        rule.dayTradeScope === dayTradeScope,
    )?.rateBps ?? 0
  );
}
