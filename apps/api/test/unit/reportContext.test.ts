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

  it("honors all-scope specified mode for direct API and MCP callers", () => {
    expect(resolveReportContext({
      scope: "all",
      currencyMode: "specified",
      currency: "AUD",
      defaultReportingCurrency: "USD",
    })).toEqual({
      scope: "all",
      currencyMode: "specified",
      currency: "AUD",
      reportingCurrency: "AUD",
      nativeCurrency: null,
    });
  });

  it("normalizes single-market specified mode to the market's native currency", () => {
    expect(resolveReportContext({
      scope: "US",
      currencyMode: "specified",
      currency: "TWD",
      defaultReportingCurrency: "AUD",
    })).toEqual({
      scope: "US",
      currencyMode: "auto",
      currency: null,
      reportingCurrency: "USD",
      nativeCurrency: "USD",
    });
  });

  it("ignores specified mode without a currency because manual overrides are not authoritative", () => {
    expect(resolveReportContext({
      scope: "KR",
      currencyMode: "specified",
      defaultReportingCurrency: "TWD",
    })).toEqual({
      scope: "KR",
      currencyMode: "auto",
      currency: null,
      reportingCurrency: "KRW",
      nativeCurrency: "KRW",
    });
  });

  it("uses JPY as the native reporting currency for JP scope", () => {
    expect(resolveReportContext({
      scope: "JP",
      defaultReportingCurrency: "USD",
    })).toEqual({
      scope: "JP",
      currencyMode: "auto",
      currency: null,
      reportingCurrency: "JPY",
      nativeCurrency: "JPY",
    });
  });

  it("rejects unsupported scope values", () => {
    expect(() => resolveReportContext({
      scope: "EU",
      defaultReportingCurrency: "TWD",
    })).toThrow(/scope must be all, TW, US, AU, KR, or JP/);
  });
});
