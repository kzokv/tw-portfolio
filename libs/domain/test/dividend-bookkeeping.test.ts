import { describe, expect, it } from "vitest";
import {
  calculateDividendCashReconciliation,
  calculateExpectedStockQuantity,
  resolveDividendStockEntitlement,
  type TypedDividendDeductions,
} from "../src/dividend-bookkeeping.js";

describe("dividend bookkeeping", () => {
  describe("resolveDividendStockEntitlement", () => {
    it("resolves expected stock quantity from an authoritative normalized ratio", () => {
      expect(resolveDividendStockEntitlement({
        eligibleQuantity: 1_234,
        stockDistributionRatio: 0.085,
        stockDistributionRatioState: "authoritative",
      })).toEqual({
        expectedStockQuantity: 104,
        stockDistributionRatio: 0.085,
        stockDistributionRatioState: "authoritative",
        expectedStockCalcState: "resolved",
        needsActionReason: null,
      });
    });

    it("keeps stock entitlement unresolved when no authoritative ratio exists", () => {
      expect(resolveDividendStockEntitlement({
        eligibleQuantity: 1_234,
        stockDistributionRatio: null,
        stockDistributionRatioState: "unresolved",
      })).toEqual({
        expectedStockQuantity: 0,
        stockDistributionRatio: null,
        stockDistributionRatioState: "unresolved",
        expectedStockCalcState: "needs_action",
        needsActionReason: "stock_distribution_ratio_unresolved",
      });
    });

    it("keeps non-authoritative derived ratios unresolved for review", () => {
      expect(resolveDividendStockEntitlement({
        eligibleQuantity: 1_234,
        stockDistributionRatio: 0.085,
        stockDistributionRatioState: "derived_non_authoritative",
      })).toEqual({
        expectedStockQuantity: 0,
        stockDistributionRatio: 0.085,
        stockDistributionRatioState: "derived_non_authoritative",
        expectedStockCalcState: "needs_action",
        needsActionReason: "stock_distribution_ratio_unresolved",
      });
    });

    it("treats zero eligible quantity as resolved even when the ratio is unresolved", () => {
      expect(resolveDividendStockEntitlement({
        eligibleQuantity: 0,
        stockDistributionRatio: null,
        stockDistributionRatioState: "unresolved",
      })).toEqual({
        expectedStockQuantity: 0,
        stockDistributionRatio: null,
        stockDistributionRatioState: "unresolved",
        expectedStockCalcState: "resolved",
        needsActionReason: null,
      });
    });
  });

  describe("calculateExpectedStockQuantity", () => {
    it("floors eligible quantity multiplied by the normalized ratio", () => {
      expect(calculateExpectedStockQuantity(999, 0.1)).toBe(99);
      expect(calculateExpectedStockQuantity(999, 0.1009)).toBe(100);
    });
  });

  describe("calculateDividendCashReconciliation", () => {
    it("computes typed expected/actual net and signed variance", () => {
      const deductions: TypedDividendDeductions = {
        nhiAmount: 42,
        bankFeeAmount: 17,
        otherDeductionAmount: 9,
      };

      expect(calculateDividendCashReconciliation({
        expectedGrossAmount: 1_000,
        actualNetAmount: 940,
        deductions,
      })).toEqual({
        expectedGrossAmount: 1_000,
        expectedNetAmount: 932,
        actualNetAmount: 940,
        varianceAmount: 8,
        deductions,
      });
    });

    it("defaults missing typed deductions to zero", () => {
      expect(calculateDividendCashReconciliation({
        expectedGrossAmount: 500,
        actualNetAmount: 500,
      })).toEqual({
        expectedGrossAmount: 500,
        expectedNetAmount: 500,
        actualNetAmount: 500,
        varianceAmount: 0,
        deductions: {
          nhiAmount: 0,
          bankFeeAmount: 0,
          otherDeductionAmount: 0,
        },
      });
    });
  });
});
