import type { CurrencyCode, DividendSourceBucket, InstrumentType, SourceCompositionStatus } from "./types.js";

export interface DividendDeductionLikeEvent {
  cashDividendCurrency: CurrencyCode;
  cashDividendPerShare: number;
  stockDividendPerShare: number;
  stockDistributionRatio?: number | null;
  stockDistributionRatioState?: "authoritative" | "derived_non_authoritative" | "unresolved";
  stockParValueAmount?: number | null;
}

export interface SourceLineLike {
  amount: number;
  sourceBucket?: DividendSourceBucket;
}

export type NhiPremiumPrefillResult =
  | { kind: "exact"; premiumBase: number; premiumAmount: number }
  | { kind: "estimate"; premiumBase: number; premiumAmount: number };

export const NHI_RATE = 0.0211;
export const NHI_THRESHOLD_TWD = 20_000;
export const SOURCE_LINE_RECONCILIATION_TOLERANCE_TWD = 1;

export const NHI_SUBJECT_BUCKETS = new Set<DividendSourceBucket>(["DIVIDEND_INCOME", "INTEREST_INCOME"]);

export function prefillNhiPremium(
  event: DividendDeductionLikeEvent,
  eligibleQty: number,
  instrumentType: InstrumentType,
  sourceLines?: SourceLineLike[],
  sourceCompositionStatus?: SourceCompositionStatus,
): NhiPremiumPrefillResult | null {
  if (event.cashDividendCurrency !== "TWD") {
    return null;
  }

  if (instrumentType === "ETF" || instrumentType === "BOND_ETF") {
    if (sourceCompositionStatus === "unknown_pending_disclosure") {
      return { kind: "estimate", premiumBase: 0, premiumAmount: 0 };
    }

    if (sourceCompositionStatus === "provided" && sourceLines) {
      const nhiSubjectSum = roundTwd(
        sourceLines
          .filter((line) => line.sourceBucket != null && NHI_SUBJECT_BUCKETS.has(line.sourceBucket))
          .reduce((sum, line) => sum + line.amount, 0),
      );

      if (nhiSubjectSum < NHI_THRESHOLD_TWD) {
        return null;
      }

      return {
        kind: "exact",
        premiumBase: nhiSubjectSum,
        premiumAmount: roundTwd(nhiSubjectSum * NHI_RATE),
      };
    }

    // No sourceLines / no status → legacy behavior: null
    return null;
  }

  // Non-ETF: existing logic
  const cashPremiumBase = roundTwd(eligibleQty * event.cashDividendPerShare);
  let premiumBase = cashPremiumBase;
  if (event.stockDividendPerShare > 0) {
    if (
      event.stockDistributionRatioState !== "authoritative"
      || event.stockDistributionRatio == null
      || event.stockParValueAmount == null
    ) {
      return {
        kind: "estimate",
        premiumBase: cashPremiumBase,
        premiumAmount: cashPremiumBase >= NHI_THRESHOLD_TWD ? roundTwd(cashPremiumBase * NHI_RATE) : 0,
      };
    }
    const expectedStockQuantity = Math.floor(eligibleQty * event.stockDistributionRatio);
    premiumBase += prefillStockPremiumBase(expectedStockQuantity, event.stockParValueAmount);
  }

  if (premiumBase < NHI_THRESHOLD_TWD) {
    return null;
  }

  return {
    kind: "exact",
    premiumBase,
    premiumAmount: roundTwd(premiumBase * NHI_RATE),
  };
}

export function prefillStockPremiumBase(eligibleQty: number, parValuePerShare: number): number {
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
