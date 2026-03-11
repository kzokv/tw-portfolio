import { applyRounding, bpsAmount, permilleAmount } from "./money.js";
export function calculateBuyFees(profile, tradeValueNtd) {
    const rawCommission = permilleAmount(tradeValueNtd, profile.boardCommissionRate) * (profile.commissionDiscountBps / 10_000);
    const roundedCommission = applyRounding(rawCommission, profile.commissionRoundingMode);
    return {
        commissionNtd: Math.max(profile.minCommissionNtd, roundedCommission),
        taxNtd: 0,
    };
}
export function calculateSellFees(profile, input) {
    const buyLike = calculateBuyFees(profile, input.tradeValueNtd);
    const taxRateBps = resolveSellTaxRateBps(profile, input.instrumentType, input.isDayTrade);
    const rawTax = bpsAmount(input.tradeValueNtd, taxRateBps);
    return {
        commissionNtd: buyLike.commissionNtd,
        taxNtd: applyRounding(rawTax, profile.taxRoundingMode),
    };
}
function resolveSellTaxRateBps(profile, instrumentType, isDayTrade) {
    if (instrumentType === "STOCK")
        return isDayTrade ? profile.stockDayTradeTaxRateBps : profile.stockSellTaxRateBps;
    if (instrumentType === "ETF")
        return profile.etfSellTaxRateBps;
    return profile.bondEtfSellTaxRateBps;
}
//# sourceMappingURL=fee.js.map
