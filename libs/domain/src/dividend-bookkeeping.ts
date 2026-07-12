export type StockDistributionRatioState = "authoritative" | "derived_non_authoritative" | "unresolved";
export type ExpectedStockCalcState = "resolved" | "needs_action";

export interface TypedDividendDeductions {
  nhiAmount?: number;
  bankFeeAmount?: number;
  otherDeductionAmount?: number;
}

export interface DividendCashReconciliationInput {
  expectedGrossAmount: number;
  actualNetAmount: number;
  deductions?: TypedDividendDeductions;
}

export interface DividendCashReconciliation {
  expectedGrossAmount: number;
  expectedNetAmount: number;
  actualNetAmount: number;
  varianceAmount: number;
  deductions: Required<TypedDividendDeductions>;
}

export interface ResolveDividendStockEntitlementInput {
  eligibleQuantity: number;
  stockEntitlementRequired: boolean;
  stockDistributionRatio: number | null;
  stockDistributionRatioState: StockDistributionRatioState;
}

export interface ResolvedDividendStockEntitlement {
  expectedStockQuantity: number;
  stockDistributionRatio: number | null;
  stockDistributionRatioState: StockDistributionRatioState;
  expectedStockCalcState: ExpectedStockCalcState;
  needsActionReason: "stock_distribution_ratio_unresolved" | null;
}

export function calculateExpectedStockQuantity(
  eligibleQuantity: number,
  stockDistributionRatio: number,
): number {
  return Math.floor(eligibleQuantity * stockDistributionRatio);
}

export function resolveDividendStockEntitlement(
  input: ResolveDividendStockEntitlementInput,
): ResolvedDividendStockEntitlement {
  const normalizedEligibleQuantity = Math.max(0, Math.trunc(input.eligibleQuantity));
  const normalizedRatio = normalizeOptionalNonNegativeNumber(input.stockDistributionRatio);
  const ratioIsUsable = normalizedRatio != null && input.stockDistributionRatioState === "authoritative";

  if (!input.stockEntitlementRequired) {
    return {
      expectedStockQuantity: 0,
      stockDistributionRatio: null,
      stockDistributionRatioState: input.stockDistributionRatioState,
      expectedStockCalcState: "resolved",
      needsActionReason: null,
    };
  }

  if (normalizedEligibleQuantity === 0) {
    return {
      expectedStockQuantity: 0,
      stockDistributionRatio: normalizedRatio,
      stockDistributionRatioState: input.stockDistributionRatioState,
      expectedStockCalcState: "resolved",
      needsActionReason: null,
    };
  }

  if (!ratioIsUsable) {
    return {
      expectedStockQuantity: 0,
      stockDistributionRatio: normalizedRatio,
      stockDistributionRatioState: input.stockDistributionRatioState,
      expectedStockCalcState: "needs_action",
      needsActionReason: "stock_distribution_ratio_unresolved",
    };
  }

  return {
    expectedStockQuantity: calculateExpectedStockQuantity(normalizedEligibleQuantity, normalizedRatio),
    stockDistributionRatio: normalizedRatio,
    stockDistributionRatioState: input.stockDistributionRatioState,
    expectedStockCalcState: "resolved",
    needsActionReason: null,
  };
}

export function calculateDividendCashReconciliation(
  input: DividendCashReconciliationInput,
): DividendCashReconciliation {
  const deductions: Required<TypedDividendDeductions> = {
    nhiAmount: normalizeNonNegativeNumber(input.deductions?.nhiAmount ?? 0),
    bankFeeAmount: normalizeNonNegativeNumber(input.deductions?.bankFeeAmount ?? 0),
    otherDeductionAmount: normalizeNonNegativeNumber(input.deductions?.otherDeductionAmount ?? 0),
  };
  const expectedGrossAmount = normalizeNumber(input.expectedGrossAmount);
  const actualNetAmount = normalizeNumber(input.actualNetAmount);
  const expectedNetAmount = expectedGrossAmount - deductions.nhiAmount - deductions.bankFeeAmount - deductions.otherDeductionAmount;
  return {
    expectedGrossAmount,
    expectedNetAmount,
    actualNetAmount,
    varianceAmount: actualNetAmount - expectedNetAmount,
    deductions,
  };
}

function normalizeOptionalNonNegativeNumber(value: number | null): number | null {
  if (value == null) return null;
  return normalizeNonNegativeNumber(value);
}

function normalizeNonNegativeNumber(value: number): number {
  return Math.max(0, normalizeNumber(value));
}

function normalizeNumber(value: number): number {
  return Number.isFinite(value) ? value : 0;
}
