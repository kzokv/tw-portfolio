// KZO-180 — Pure-helper tests for `resolveReportingCurrency`.
//
// `resolveEffectiveRanges` is exercised via the integration suite
// (`apps/api/test/integration/user-preferences.integration.test.ts`); we
// keep the new pure resolver isolated here because it has no persistence
// dependency.

import { describe, it, expect } from "vitest";
import { resolvePriceColorConvention, resolveReportingCurrency } from "../../src/services/userPreferences.js";

describe("resolveReportingCurrency", () => {
  it("returns TWD when the key is missing", () => {
    expect(resolveReportingCurrency({})).toBe("TWD");
  });

  it("passes through valid TWD", () => {
    expect(resolveReportingCurrency({ reportingCurrency: "TWD" })).toBe("TWD");
  });

  it("passes through valid USD", () => {
    expect(resolveReportingCurrency({ reportingCurrency: "USD" })).toBe("USD");
  });

  it("passes through valid AUD", () => {
    expect(resolveReportingCurrency({ reportingCurrency: "AUD" })).toBe("AUD");
  });

  it("passes through valid KRW", () => {
    expect(resolveReportingCurrency({ reportingCurrency: "KRW" })).toBe("KRW");
  });

  it("defaults to TWD on an invalid string", () => {
    // EUR is not in the AccountDefaultCurrency union; should fall through.
    expect(resolveReportingCurrency({ reportingCurrency: "EUR" })).toBe("TWD");
  });

  it("defaults to TWD on a lowercased valid code", () => {
    // Case-sensitive — matches Zod enum behavior.
    expect(resolveReportingCurrency({ reportingCurrency: "twd" })).toBe("TWD");
  });

  it("defaults to TWD on a number value", () => {
    expect(resolveReportingCurrency({ reportingCurrency: 123 })).toBe("TWD");
  });

  it("defaults to TWD on null", () => {
    expect(resolveReportingCurrency({ reportingCurrency: null })).toBe("TWD");
  });

  it("defaults to TWD on undefined value", () => {
    expect(resolveReportingCurrency({ reportingCurrency: undefined })).toBe("TWD");
  });

  it("defaults to TWD on an object value", () => {
    expect(
      resolveReportingCurrency({ reportingCurrency: { code: "USD" } }),
    ).toBe("TWD");
  });

  it("defaults to TWD on an array value", () => {
    expect(resolveReportingCurrency({ reportingCurrency: ["USD"] })).toBe("TWD");
  });

  it("ignores unrelated sibling keys (e.g. dashboardPerformanceRanges)", () => {
    expect(
      resolveReportingCurrency({
        dashboardPerformanceRanges: ["1M", "3M", "YTD", "1Y"],
        reportingCurrency: "USD",
      }),
    ).toBe("USD");
  });
});

describe("resolvePriceColorConvention", () => {
  it("returns gain_green_loss_red when the key is missing", () => {
    expect(resolvePriceColorConvention({})).toBe("gain_green_loss_red");
  });

  it("passes through gain_green_loss_red", () => {
    expect(resolvePriceColorConvention({ priceColorConvention: "gain_green_loss_red" })).toBe("gain_green_loss_red");
  });

  it("passes through gain_red_loss_green", () => {
    expect(resolvePriceColorConvention({ priceColorConvention: "gain_red_loss_green" })).toBe("gain_red_loss_green");
  });

  it("defaults on an invalid string", () => {
    expect(resolvePriceColorConvention({ priceColorConvention: "western" })).toBe("gain_green_loss_red");
  });

  it("defaults on null, objects, arrays, and numbers", () => {
    expect(resolvePriceColorConvention({ priceColorConvention: null })).toBe("gain_green_loss_red");
    expect(resolvePriceColorConvention({ priceColorConvention: { value: "gain_red_loss_green" } })).toBe("gain_green_loss_red");
    expect(resolvePriceColorConvention({ priceColorConvention: ["gain_red_loss_green"] })).toBe("gain_green_loss_red");
    expect(resolvePriceColorConvention({ priceColorConvention: 1 })).toBe("gain_green_loss_red");
  });

  it("ignores unrelated sibling keys", () => {
    expect(resolvePriceColorConvention({
      reportingCurrency: "USD",
      priceColorConvention: "gain_red_loss_green",
    })).toBe("gain_red_loss_green");
  });
});
