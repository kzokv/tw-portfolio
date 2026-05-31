import { describe, expect, it } from "vitest";
import {
  calculateAppliedTaxComponents,
  calculateBuyFees,
  calculateSellFees,
  materializeFeeProfileTaxRules,
  projectLegacyFeeProfileTaxFields,
  type FeeProfile,
} from "../src/index.js";

const profile: FeeProfile = {
  id: "fp-1",
  name: "default",
  boardCommissionRate: 1.425,
  commissionDiscountPercent: 0,
  minimumCommissionAmount: 20,
  commissionCurrency: "TWD",
  commissionRoundingMode: "FLOOR",
  taxRoundingMode: "FLOOR",
  stockSellTaxRateBps: 30,
  stockDayTradeTaxRateBps: 15,
  etfSellTaxRateBps: 10,
  bondEtfSellTaxRateBps: 0,
  commissionChargeMode: "CHARGED_UPFRONT",
};

describe("fee calculation", () => {
  it("applies min commission", () => {
    const fee = calculateBuyFees(profile, 10_000, "TWD");
    expect(fee.commissionAmount).toBe(20);
  });

  it("supports the exact Taiwan default board rate", () => {
    const fee = calculateBuyFees(profile, 600_000, "TWD");
    expect(fee.commissionAmount).toBe(855);
  });

  it("applies percent-off discounts before rounding and minimums", () => {
    const discounted = calculateBuyFees(
      {
        ...profile,
        commissionDiscountPercent: 60,
        minimumCommissionAmount: 0,
      },
      600_000,
      "TWD",
    );
    expect(discounted.commissionAmount).toBe(342);
  });

  it("applies stock sell tax", () => {
    const fee = calculateSellFees(profile, {
      tradeValueAmount: 1_000_000,
      tradeCurrency: "TWD",
      instrumentType: "STOCK",
      isDayTrade: false,
    });
    expect(fee.taxAmount).toBe(3000);
    expect(fee.taxComponents).toEqual([
      expect.objectContaining({
        marketCode: "TW",
        tradeSide: "SELL",
        instrumentType: "STOCK",
        dayTradeScope: "NON_DAY_TRADE_ONLY",
        taxAmount: 3000,
      }),
    ]);
  });

  it("applies day trade sell tax", () => {
    const fee = calculateSellFees(profile, {
      tradeValueAmount: 1_000_000,
      tradeCurrency: "TWD",
      instrumentType: "STOCK",
      isDayTrade: true,
    });
    expect(fee.taxAmount).toBe(1500);
  });

  it("materializes normalized tax rules from legacy Taiwan fields", () => {
    expect(materializeFeeProfileTaxRules(profile)).toEqual([
      expect.objectContaining({
        id: "fp-1:tax-rule:stock-sell",
        instrumentType: "STOCK",
        dayTradeScope: "NON_DAY_TRADE_ONLY",
        rateBps: 30,
      }),
      expect.objectContaining({
        id: "fp-1:tax-rule:stock-day-trade-sell",
        instrumentType: "STOCK",
        dayTradeScope: "DAY_TRADE_ONLY",
        rateBps: 15,
      }),
      expect.objectContaining({
        id: "fp-1:tax-rule:etf-sell",
        instrumentType: "ETF",
        dayTradeScope: "ANY",
        rateBps: 10,
      }),
      expect.objectContaining({
        id: "fp-1:tax-rule:bond-etf-sell",
        instrumentType: "BOND_ETF",
        dayTradeScope: "ANY",
        rateBps: 0,
      }),
    ]);
  });

  it("projects Taiwan compatibility fields from normalized tax rules", () => {
    const projected = projectLegacyFeeProfileTaxFields([
      {
        id: "fp-1:tax-rule:stock-sell",
        marketCode: "TW",
        tradeSide: "SELL",
        instrumentType: "STOCK",
        dayTradeScope: "NON_DAY_TRADE_ONLY",
        taxComponentCode: "SECURITIES_TRANSACTION_TAX",
        calculationMethod: "RATE_BPS",
        rateBps: 40,
        sortOrder: 1,
      },
      {
        id: "fp-1:tax-rule:stock-day-trade-sell",
        marketCode: "TW",
        tradeSide: "SELL",
        instrumentType: "STOCK",
        dayTradeScope: "DAY_TRADE_ONLY",
        taxComponentCode: "SECURITIES_TRANSACTION_TAX",
        calculationMethod: "RATE_BPS",
        rateBps: 20,
        sortOrder: 2,
      },
      {
        id: "fp-1:tax-rule:etf-sell",
        marketCode: "TW",
        tradeSide: "SELL",
        instrumentType: "ETF",
        dayTradeScope: "ANY",
        taxComponentCode: "SECURITIES_TRANSACTION_TAX",
        calculationMethod: "RATE_BPS",
        rateBps: 10,
        sortOrder: 3,
      },
      {
        id: "fp-1:tax-rule:bond-etf-sell",
        marketCode: "TW",
        tradeSide: "SELL",
        instrumentType: "BOND_ETF",
        dayTradeScope: "ANY",
        taxComponentCode: "SECURITIES_TRANSACTION_TAX",
        calculationMethod: "RATE_BPS",
        rateBps: 0,
        sortOrder: 4,
      },
    ]);

    expect(projected).toEqual({
      stockSellTaxRateBps: 40,
      stockDayTradeTaxRateBps: 20,
      etfSellTaxRateBps: 10,
      bondEtfSellTaxRateBps: 0,
    });
  });

  it("supports tax profiles composed purely from normalized rules", () => {
    const normalizedProfile: FeeProfile = {
      ...profile,
      stockSellTaxRateBps: 0,
      stockDayTradeTaxRateBps: 0,
      etfSellTaxRateBps: 0,
      bondEtfSellTaxRateBps: 0,
      taxRules: [
        {
          id: "fp-1:tax-rule:stock-sell",
          marketCode: "TW",
          tradeSide: "SELL",
          instrumentType: "STOCK",
          dayTradeScope: "NON_DAY_TRADE_ONLY",
          taxComponentCode: "SECURITIES_TRANSACTION_TAX",
          calculationMethod: "RATE_BPS",
          rateBps: 45,
          sortOrder: 1,
        },
      ],
    };

    expect(calculateAppliedTaxComponents(normalizedProfile, {
      tradeValueAmount: 1_000_000,
      instrumentType: "STOCK",
      isDayTrade: false,
      marketCode: "TW",
    })).toEqual([
      expect.objectContaining({
        rateBps: 45,
        taxAmount: 4500,
      }),
    ]);
    expect(calculateSellFees(normalizedProfile, {
      tradeValueAmount: 1_000_000,
      tradeCurrency: "TWD",
      instrumentType: "STOCK",
      isDayTrade: false,
      marketCode: "TW",
    }).taxAmount).toBe(4500);
  });
});
