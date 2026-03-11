import { describe, expect, it } from "vitest";
import { calculateBuyFees, calculateSellFees, type FeeProfile } from "../src/index.js";

const profile: FeeProfile = {
  id: "fp-1",
  name: "default",
  boardCommissionRate: 1.425,
  commissionDiscountPercent: 0,
  minCommissionNtd: 20,
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
    const fee = calculateBuyFees(profile, 10_000);
    expect(fee.commissionNtd).toBe(20);
  });

  it("supports the exact Taiwan default board rate", () => {
    const fee = calculateBuyFees(profile, 600_000);
    expect(fee.commissionNtd).toBe(855);
  });

  it("applies percent-off discounts before rounding and minimums", () => {
    const discounted = calculateBuyFees(
      {
        ...profile,
        commissionDiscountPercent: 60,
        minCommissionNtd: 0,
      },
      600_000,
    );
    expect(discounted.commissionNtd).toBe(342);
  });

  it("applies stock sell tax", () => {
    const fee = calculateSellFees(profile, {
      tradeValueNtd: 1_000_000,
      instrumentType: "STOCK",
      isDayTrade: false,
    });
    expect(fee.taxNtd).toBe(3000);
  });

  it("applies day trade sell tax", () => {
    const fee = calculateSellFees(profile, {
      tradeValueNtd: 1_000_000,
      instrumentType: "STOCK",
      isDayTrade: true,
    });
    expect(fee.taxNtd).toBe(1500);
  });
});
