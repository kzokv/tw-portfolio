import { describe, expect, it } from "vitest";
import {
  DEFAULT_PAR_VALUE_TWD,
  NHI_THRESHOLD_TWD,
  SOURCE_LINE_RECONCILIATION_TOLERANCE_TWD,
  prefillNhiPremium,
  prefillStockPremiumBase,
  validateSourceLineReconciliation,
} from "../src/dividend-deductions.js";

describe("dividend deductions", () => {
  it("prefills NHI for TWD cash dividends at or above threshold", () => {
    expect(
      prefillNhiPremium(
        { cashDividendCurrency: "TWD", cashDividendPerShare: 20, stockDividendPerShare: 0 },
        1_000,
        "STOCK",
      ),
    ).toEqual({ premiumBase: NHI_THRESHOLD_TWD, premiumAmount: 422 });
  });

  it("returns null below threshold", () => {
    expect(
      prefillNhiPremium(
        { cashDividendCurrency: "TWD", cashDividendPerShare: 19.999, stockDividendPerShare: 0 },
        1_000,
        "STOCK",
      ),
    ).toBeNull();
  });

  it("returns null for non-TWD", () => {
    expect(
      prefillNhiPremium(
        { cashDividendCurrency: "USD", cashDividendPerShare: 25, stockDividendPerShare: 0 },
        1_000,
        "STOCK",
      ),
    ).toBeNull();
  });

  it("returns null for ETFs", () => {
    expect(
      prefillNhiPremium(
        { cashDividendCurrency: "TWD", cashDividendPerShare: 25, stockDividendPerShare: 0 },
        1_000,
        "ETF",
      ),
    ).toBeNull();
  });

  it("uses default par value for stock dividend premium base", () => {
    expect(prefillStockPremiumBase(123)).toBe(123 * DEFAULT_PAR_VALUE_TWD);
  });

  it("accepts exact source line reconciliation", () => {
    expect(validateSourceLineReconciliation([{ amount: 60 }, { amount: 40 }], 100)).toEqual({
      ok: true,
      total: 100,
      variance: 0,
    });
  });

  it("accepts source line reconciliation within tolerance", () => {
    expect(validateSourceLineReconciliation([{ amount: 101 }], 100)).toEqual({
      ok: true,
      total: 101,
      variance: SOURCE_LINE_RECONCILIATION_TOLERANCE_TWD,
    });
  });

  it("rejects source line reconciliation beyond tolerance", () => {
    expect(validateSourceLineReconciliation([{ amount: 102 }], 100)).toEqual({
      ok: false,
      total: 102,
      variance: 2,
    });
  });
});
