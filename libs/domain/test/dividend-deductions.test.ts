import { describe, expect, it } from "vitest";
import {
  DEFAULT_PAR_VALUE_TWD,
  NHI_RATE,
  NHI_THRESHOLD_TWD,
  NHI_SUBJECT_BUCKETS,
  SOURCE_LINE_RECONCILIATION_TOLERANCE_TWD,
  prefillNhiPremium,
  prefillStockPremiumBase,
  validateSourceLineReconciliation,
} from "../src/dividend-deductions.js";

describe("dividend deductions", () => {
  describe("prefillNhiPremium — non-ETF (STOCK)", () => {
    it("prefills NHI for TWD cash dividends at or above threshold → exact", () => {
      const result = prefillNhiPremium(
        { cashDividendCurrency: "TWD", cashDividendPerShare: 20, stockDividendPerShare: 0 },
        1_000,
        "STOCK",
      );
      expect(result).toEqual({ kind: "exact", premiumBase: NHI_THRESHOLD_TWD, premiumAmount: 422 });
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

    it("uses stock dividend premium base when stockDividendPerShare > 0 → exact", () => {
      // 1000 shares * 0.5 stock div = 500 shares * 10 par = 5000 ... below threshold → null
      // Need above threshold: 2000 * 1.5 = 3000 shares * 10 par = 30000
      const result = prefillNhiPremium(
        { cashDividendCurrency: "TWD", cashDividendPerShare: 0, stockDividendPerShare: 1.5 },
        2_000,
        "STOCK",
      );
      expect(result).toEqual({ kind: "exact", premiumBase: 30_000, premiumAmount: Math.round(30_000 * NHI_RATE) });
    });
  });

  describe("prefillNhiPremium — ETF / BOND_ETF", () => {
    it("ETF + unknown_pending_disclosure → estimate", () => {
      const result = prefillNhiPremium(
        { cashDividendCurrency: "TWD", cashDividendPerShare: 25, stockDividendPerShare: 0 },
        1_000,
        "ETF",
        undefined,
        "unknown_pending_disclosure",
      );
      expect(result).toEqual({ kind: "estimate", premiumBase: 0, premiumAmount: 0 });
    });

    it("BOND_ETF + unknown_pending_disclosure → estimate", () => {
      const result = prefillNhiPremium(
        { cashDividendCurrency: "TWD", cashDividendPerShare: 25, stockDividendPerShare: 0 },
        1_000,
        "BOND_ETF",
        undefined,
        "unknown_pending_disclosure",
      );
      expect(result).toEqual({ kind: "estimate", premiumBase: 0, premiumAmount: 0 });
    });

    it("ETF + provided + NHI-subject sum ≥ threshold → exact", () => {
      const result = prefillNhiPremium(
        { cashDividendCurrency: "TWD", cashDividendPerShare: 25, stockDividendPerShare: 0 },
        1_000,
        "ETF",
        [
          { amount: 15_000, sourceBucket: "DIVIDEND_INCOME" },
          { amount: 8_000, sourceBucket: "INTEREST_INCOME" },
        ],
        "provided",
      );
      // NHI-subject sum = 15000 + 8000 = 23000 ≥ 20000
      expect(result).toEqual({
        kind: "exact",
        premiumBase: 23_000,
        premiumAmount: Math.round(23_000 * 0.0211),
      });
    });

    it("ETF + provided + all non-NHI buckets → null", () => {
      const result = prefillNhiPremium(
        { cashDividendCurrency: "TWD", cashDividendPerShare: 25, stockDividendPerShare: 0 },
        1_000,
        "ETF",
        [
          { amount: 5_000, sourceBucket: "REVENUE_EQUALIZATION" },
          { amount: 3_000, sourceBucket: "CAPITAL_RETURN" },
        ],
        "provided",
      );
      expect(result).toBeNull();
    });

    it("ETF + provided + sum < threshold → null", () => {
      const result = prefillNhiPremium(
        { cashDividendCurrency: "TWD", cashDividendPerShare: 25, stockDividendPerShare: 0 },
        1_000,
        "ETF",
        [
          { amount: 5_000, sourceBucket: "DIVIDEND_INCOME" },
          { amount: 3_000, sourceBucket: "INTEREST_INCOME" },
        ],
        "provided",
      );
      // NHI-subject sum = 8000 < 20000
      expect(result).toBeNull();
    });

    it("canonical 00919 case — small ETF distribution mostly non-NHI → null", () => {
      const result = prefillNhiPremium(
        { cashDividendCurrency: "TWD", cashDividendPerShare: 0.15, stockDividendPerShare: 0 },
        10_000,
        "ETF",
        [
          { amount: 900, sourceBucket: "DIVIDEND_INCOME" },
          { amount: 300, sourceBucket: "INTEREST_INCOME" },
          { amount: 200, sourceBucket: "REVENUE_EQUALIZATION" },
          { amount: 100, sourceBucket: "CAPITAL_RETURN" },
        ],
        "provided",
      );
      // NHI-subject = 900 + 300 = 1200 < 20000
      expect(result).toBeNull();
    });

    it("canonical 0056 case — large ETF distribution with NHI-subject ≥ threshold → exact", () => {
      const result = prefillNhiPremium(
        { cashDividendCurrency: "TWD", cashDividendPerShare: 2.7, stockDividendPerShare: 0 },
        10_000,
        "ETF",
        [
          { amount: 18_000, sourceBucket: "DIVIDEND_INCOME" },
          { amount: 9_000, sourceBucket: "INTEREST_INCOME" },
        ],
        "provided",
      );
      // NHI-subject = 18000 + 9000 = 27000 ≥ 20000
      expect(result).toEqual({
        kind: "exact",
        premiumBase: 27_000,
        premiumAmount: Math.round(27_000 * 0.0211),
      });
    });

    it("ETF + no sourceCompositionStatus (legacy) → null", () => {
      const result = prefillNhiPremium(
        { cashDividendCurrency: "TWD", cashDividendPerShare: 25, stockDividendPerShare: 0 },
        1_000,
        "ETF",
      );
      expect(result).toBeNull();
    });

    it("ETF + non-TWD → null regardless of source composition", () => {
      const result = prefillNhiPremium(
        { cashDividendCurrency: "USD", cashDividendPerShare: 25, stockDividendPerShare: 0 },
        1_000,
        "ETF",
        [{ amount: 25_000, sourceBucket: "DIVIDEND_INCOME" }],
        "provided",
      );
      expect(result).toBeNull();
    });
  });

  describe("NHI_SUBJECT_BUCKETS", () => {
    it("includes DIVIDEND_INCOME and INTEREST_INCOME", () => {
      expect(NHI_SUBJECT_BUCKETS.has("DIVIDEND_INCOME")).toBe(true);
      expect(NHI_SUBJECT_BUCKETS.has("INTEREST_INCOME")).toBe(true);
    });

    it("excludes non-NHI buckets", () => {
      expect(NHI_SUBJECT_BUCKETS.has("REVENUE_EQUALIZATION")).toBe(false);
      expect(NHI_SUBJECT_BUCKETS.has("CAPITAL_RETURN")).toBe(false);
      expect(NHI_SUBJECT_BUCKETS.has("CAPITAL_EQUALIZATION")).toBe(false);
      expect(NHI_SUBJECT_BUCKETS.has("SECURITIES_GAIN_INCOME")).toBe(false);
      expect(NHI_SUBJECT_BUCKETS.has("OTHER")).toBe(false);
    });
  });

  describe("prefillStockPremiumBase", () => {
    it("uses default par value for stock dividend premium base", () => {
      expect(prefillStockPremiumBase(123)).toBe(123 * DEFAULT_PAR_VALUE_TWD);
    });
  });

  describe("validateSourceLineReconciliation", () => {
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
});
