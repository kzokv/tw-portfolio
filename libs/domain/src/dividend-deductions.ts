import type { CurrencyCode, InstrumentType } from "./types.js";

export interface DividendDeductionLikeEvent {
  cashDividendCurrency: CurrencyCode;
  cashDividendPerShare: number;
  stockDividendPerShare: number;
}

export interface SourceLineLike {
  amount: number;
}

export interface NhiPremiumPrefill {
  premiumBase: number;
  premiumAmount: number;
}

export const NHI_RATE = 0.0211;
export const NHI_THRESHOLD_TWD = 20_000;
export const DEFAULT_PAR_VALUE_TWD = 10;
export const SOURCE_LINE_RECONCILIATION_TOLERANCE_TWD = 1;

export function prefillNhiPremium(
  event: DividendDeductionLikeEvent,
  eligibleQty: number,
  instrumentType: InstrumentType,
): NhiPremiumPrefill | null {
  if (instrumentType === "ETF" || instrumentType === "BOND_ETF") {
    return null;
  }

  if (event.cashDividendCurrency !== "TWD") {
    return null;
  }

  const premiumBase =
    event.stockDividendPerShare > 0
      ? prefillStockPremiumBase(eligibleQty * event.stockDividendPerShare)
      : roundTwd(eligibleQty * event.cashDividendPerShare);

  if (premiumBase < NHI_THRESHOLD_TWD) {
    return null;
  }

  return {
    premiumBase,
    premiumAmount: roundTwd(premiumBase * NHI_RATE),
  };
}

export function prefillStockPremiumBase(eligibleQty: number, parValuePerShare: number = DEFAULT_PAR_VALUE_TWD): number {
  return roundTwd(eligibleQty * parValuePerShare);
}

export function validateSourceLineReconciliation(sourceLines: SourceLineLike[], gross: number): {
  ok: boolean;
  total: number;
  variance: number;
} {
  const total = roundTwd(sourceLines.reduce((sum, line) => sum + line.amount, 0));
  const variance = roundTwd(total - gross);
  return {
    ok: Math.abs(variance) <= SOURCE_LINE_RECONCILIATION_TOLERANCE_TWD,
    total,
    variance,
  };
}

function roundTwd(value: number): number {
  return Math.round(value + Number.EPSILON);
}
