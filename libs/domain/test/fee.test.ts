import { describe, expect, it } from "vitest";
import { calculateBuyFees, calculateSellFees, type FeeProfile } from "../src/index.js";

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
});
