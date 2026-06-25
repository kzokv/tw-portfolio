import { describe, expect, it } from "vitest";
import {
  ACCOUNT_DEFAULT_CURRENCIES,
  JP_CATALOG_STOCK_TYPES,
  JP_CATALOG_STRICT_STOCK_TYPES,
  MARKET_CODES,
  REPORT_SCOPES,
  currencyFor,
  marketCodeFor,
} from "@vakwen/shared-types";
import { calculateSellFees, classifyInstrument, materializeFeeProfileTaxRules } from "@vakwen/domain";
import { createDefaultFeeProfile } from "../../src/services/store.js";

describe("JP shared market and currency contracts", () => {
  it("adds JP and JPY to the canonical market and currency sets", () => {
    expect(MARKET_CODES).toContain("JP");
    expect(ACCOUNT_DEFAULT_CURRENCIES).toContain("JPY");
    expect(REPORT_SCOPES).toContain("JP");
    expect(currencyFor("JP")).toBe("JPY");
    expect(marketCodeFor("JPY")).toBe("JP");
  });

  it("locks JP catalog stock types to the strict default subset plus optional depositary receipts", () => {
    expect(JP_CATALOG_STRICT_STOCK_TYPES).toEqual(["Common Stock", "Preferred Stock", "REIT"]);
    expect(JP_CATALOG_STOCK_TYPES).toEqual([
      "Common Stock",
      "Preferred Stock",
      "REIT",
      "Depositary Receipt",
    ]);
  });
});

describe("JP instrument classification", () => {
  it("maps JP ETF endpoint rows to ETF", () => {
    expect(classifyInstrument("ETF", "1306", "JP")).toBe("ETF");
    expect(classifyInstrument("ETF", "133A", "JP")).toBe("ETF");
  });

  it("maps JP stock-like rows to STOCK", () => {
    expect(classifyInstrument("Common Stock", "7203", "JP")).toBe("STOCK");
    expect(classifyInstrument("Preferred Stock", "7167", "JP")).toBe("STOCK");
    expect(classifyInstrument("REIT", "8951", "JP")).toBe("STOCK");
    expect(classifyInstrument(null, "7203", "JP")).toBe("STOCK");
  });
});

describe("JP fee defaults", () => {
  it("supports JPY commission currency without seeding built-in JP sell-tax rules", () => {
    const profile = createDefaultFeeProfile("acc-jp", "JPY", "fp-jp");

    expect(materializeFeeProfileTaxRules(profile).every((rule) => rule.marketCode !== "JP")).toBe(true);

    const sellFees = calculateSellFees(profile, {
      tradeValueAmount: 100_000,
      tradeCurrency: "JPY",
      instrumentType: "STOCK",
      isDayTrade: false,
      marketCode: "JP",
    });

    expect(sellFees.currency).toBe("JPY");
    expect(sellFees.commissionAmount).toBeGreaterThan(0);
    expect(sellFees.taxAmount).toBe(0);
    expect(sellFees.taxComponents).toEqual([]);
  });
});
