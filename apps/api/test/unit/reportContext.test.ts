import { describe, expect, it } from "vitest";
import { resolveReportContext } from "../../src/services/reportContext.js";

describe("resolveReportContext", () => {
  it("uses the user reporting currency for all-scope auto mode", () => {
    expect(resolveReportContext({
      defaultReportingCurrency: "USD",
    })).toEqual({
      scope: "all",
      currencyMode: "auto",
      currency: null,
      reportingCurrency: "USD",
      nativeCurrency: null,
    });
  });

  it("uses the native market currency for single-market auto mode", () => {
    expect(resolveReportContext({
      scope: "TW",
      defaultReportingCurrency: "USD",
    })).toEqual({
      scope: "TW",
      currencyMode: "auto",
      currency: null,
      reportingCurrency: "TWD",
      nativeCurrency: "TWD",
    });
  });

  it("requires an explicit currency for specified mode", () => {
    expect(() => resolveReportContext({
      scope: "US",
      currencyMode: "specified",
      defaultReportingCurrency: "TWD",
    })).toThrow(/currency is required when currencyMode=specified/);
  });

  it("rejects unsupported scope values", () => {
    expect(() => resolveReportContext({
      scope: "EU",
      defaultReportingCurrency: "TWD",
    })).toThrow(/scope must be all, TW, US, AU, or KR/);
  });
});
