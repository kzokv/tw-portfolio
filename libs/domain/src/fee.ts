import { applyRounding, bpsAmount, permilleAmount } from "./money.js";
import type { FeeProfile, InstrumentType } from "./types.js";

export interface TradeFeeInput {
  tradeValueNtd: number;
  instrumentType: InstrumentType;
  isDayTrade: boolean;
}

export interface TradeFeeResult {
  commissionNtd: number;
  taxNtd: number;
}

export function calculateBuyFees(profile: FeeProfile, tradeValueNtd: number): TradeFeeResult {
  const discountMultiplier = 1 - profile.commissionDiscountPercent / 100;
  const rawCommission = permilleAmount(tradeValueNtd, profile.boardCommissionRate) * discountMultiplier;
  const roundedCommission = applyRounding(rawCommission, profile.commissionRoundingMode);
  return {
    commissionNtd: Math.max(profile.minCommissionNtd, roundedCommission),
    taxNtd: 0,
  };
}

export function calculateSellFees(profile: FeeProfile, input: TradeFeeInput): TradeFeeResult {
  const buyLike = calculateBuyFees(profile, input.tradeValueNtd);
  const taxRateBps = resolveSellTaxRateBps(profile, input.instrumentType, input.isDayTrade);
  const rawTax = bpsAmount(input.tradeValueNtd, taxRateBps);
  return {
    commissionNtd: buyLike.commissionNtd,
    taxNtd: applyRounding(rawTax, profile.taxRoundingMode),
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
