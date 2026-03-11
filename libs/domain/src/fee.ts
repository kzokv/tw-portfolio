import { applyRounding, bpsAmount, permilleAmount } from "./money.js";
import type { CurrencyCode, FeeProfile, InstrumentType } from "./types.js";

export interface TradeFeeInput {
  tradeValueAmount: number;
  tradeCurrency: CurrencyCode;
  instrumentType: InstrumentType;
  isDayTrade: boolean;
}

export interface TradeFeeResult {
  commissionAmount: number;
  taxAmount: number;
  currency: CurrencyCode;
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
  };
}

export function calculateSellFees(profile: FeeProfile, input: TradeFeeInput): TradeFeeResult {
  const commissionCurrency = profile.commissionCurrency ?? "TWD";
  if (input.tradeCurrency !== commissionCurrency) {
    throw new Error("Trade currency must match fee profile commission currency");
  }

  const buyLike = calculateBuyFees(profile, input.tradeValueAmount, input.tradeCurrency);
  const taxRateBps = resolveSellTaxRateBps(profile, input.instrumentType, input.isDayTrade);
  const rawTax = bpsAmount(input.tradeValueAmount, taxRateBps);
  return {
    commissionAmount: buyLike.commissionAmount,
    taxAmount: applyRounding(rawTax, profile.taxRoundingMode),
    currency: input.tradeCurrency,
  };
}

function resolveSellTaxRateBps(
  profile: FeeProfile,
  instrumentType: InstrumentType,
  isDayTrade: boolean,
): number {
  if (instrumentType === "STOCK") return isDayTrade ? profile.stockDayTradeTaxRateBps : profile.stockSellTaxRateBps;
  if (instrumentType === "ETF") return profile.etfSellTaxRateBps;
  return profile.bondEtfSellTaxRateBps;
}
