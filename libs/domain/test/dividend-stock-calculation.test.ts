import { describe, expect, it } from "vitest";
import {
  calculateDividendStockEntitlement,
  type DividendStockCalculationInput,
} from "../src/dividend-stock-calculation.js";

function calculate(input: DividendStockCalculationInput) {
  return calculateDividendStockEntitlement(input);
}

describe("dividend stock calculation", () => {
  it("uses an authoritative provider ratio directly", () => {
    expect(calculate({
      eligibleQuantity: 1_234,
      method: "provider_ratio",
      providerValue: "0.085",
      providerUnit: "RATIO",
    })).toEqual({
      method: "provider_ratio",
      ratio: "0.085",
      providerValue: "0.085",
      providerUnit: "RATIO",
      selectedParValue: null,
      theoreticalShares: "104.89",
      expectedWholeShares: 104,
      fractionalRemainder: "0.89",
      requiresHighRatioConfirmation: false,
    });
  });

  it("derives a ratio from par value only when the provider unit is TWD_PER_SHARE", () => {
    expect(calculate({
      eligibleQuantity: 2_000,
      method: "derived_from_par_value",
      providerValue: "1.5",
      providerUnit: "TWD_PER_SHARE",
      selectedParValue: "10",
    })).toEqual({
      method: "derived_from_par_value",
      ratio: "0.15",
      providerValue: "1.5",
      providerUnit: "TWD_PER_SHARE",
      selectedParValue: "10",
      theoreticalShares: "300",
      expectedWholeShares: 300,
      fractionalRemainder: "0",
      requiresHighRatioConfirmation: false,
    });
  });

  it("uses a custom ratio without provider input", () => {
    expect(calculate({
      eligibleQuantity: 500,
      method: "custom_ratio",
      customRatio: "0.333333",
    })).toEqual({
      method: "custom_ratio",
      ratio: "0.333333",
      providerValue: null,
      providerUnit: null,
      selectedParValue: null,
      theoreticalShares: "166.6665",
      expectedWholeShares: 166,
      fractionalRemainder: "0.6665",
      requiresHighRatioConfirmation: false,
    });
  });

  it("flags ratios above one for explicit confirmation", () => {
    expect(calculate({
      eligibleQuantity: 100,
      method: "custom_ratio",
      customRatio: "1.2",
    }).requiresHighRatioConfirmation).toBe(true);
  });

  it("rejects derived calculations when the provider unit is incompatible", () => {
    expect(() => calculate({
      eligibleQuantity: 100,
      method: "derived_from_par_value",
      providerValue: "0.15",
      providerUnit: "UNKNOWN",
      selectedParValue: "10",
    })).toThrow("provider_unit_incompatible");
  });

  it("rejects non-finite and non-positive numeric inputs", () => {
    expect(() => calculate({
      eligibleQuantity: 100,
      method: "custom_ratio",
      customRatio: "0",
    })).toThrow("ratio_must_be_positive");
    expect(() => calculate({
      eligibleQuantity: 100,
      method: "derived_from_par_value",
      providerValue: "NaN",
      providerUnit: "TWD_PER_SHARE",
      selectedParValue: "10",
    })).toThrow("provider_value_must_be_finite_positive");
  });

  it("rejects unsafe whole-share overflow", () => {
    expect(() => calculate({
      eligibleQuantity: Number.MAX_SAFE_INTEGER,
      method: "custom_ratio",
      customRatio: "2",
    })).toThrow("expected_whole_shares_overflow");
  });
});
