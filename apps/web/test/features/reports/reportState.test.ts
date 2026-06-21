import { describe, expect, it } from "vitest";
import { REPORT_HOLDINGS_FILTER_LIMIT, parseReportRouteState, reportApiPath, reportRouteStateToSearchParams } from "../../../features/reports/reportState";

describe("report route state", () => {
  it("validates query params with predictable fallbacks", () => {
    const state = parseReportRouteState({
      tab: "unknown",
      scope: "US",
      currencyMode: "specified",
      currency: "USD",
      range: "5Y",
    });

    expect(state).toEqual({
      tab: "daily-review",
      scope: "US",
      range: "5Y",
    });
  });

  it("falls back from invalid range query params", () => {
    const state = parseReportRouteState({
      tab: "market",
      scope: "AU",
      currencyMode: "auto",
      currency: "AUD",
      range: "banana",
    });

    expect(state.range).toBe("1Y");
  });

  it("ignores legacy currency override query params", () => {
    const state = parseReportRouteState({
      currencyMode: "specified",
      currency: "AUD",
    });

    expect(state).toEqual({
      tab: "daily-review",
      scope: "all",
      range: "1Y",
    });
    expect(reportApiPath("portfolio", state)).toBe(`/reports/portfolio?scope=all&currencyMode=auto&range=1Y&limit=${REPORT_HOLDINGS_FILTER_LIMIT}`);
  });

  it("omits currency from the API query in auto mode", () => {
    const state = parseReportRouteState(new URLSearchParams("tab=market&scope=AU&currencyMode=auto&currency=AUD&range=1Y"));

    expect(reportApiPath("market", state)).toBe(`/reports/market?scope=AU&currencyMode=auto&range=1Y&limit=${REPORT_HOLDINGS_FILTER_LIMIT}`);
  });

  it("includes range in daily review API queries so shared summaries stay range-scoped", () => {
    const state = parseReportRouteState(new URLSearchParams("tab=daily-review&scope=TW&currencyMode=specified&currency=AUD&range=1Y"));

    expect(reportApiPath("daily-review", state)).toBe(`/reports/daily-review?scope=TW&currencyMode=auto&range=1Y&limit=${REPORT_HOLDINGS_FILTER_LIMIT}`);
  });

  it("serializes report URLs without currency overrides", () => {
    const state = parseReportRouteState({
      tab: "portfolio",
      scope: "all",
      currencyMode: "specified",
      currency: "AUD",
      range: "1Y",
    });

    expect(reportRouteStateToSearchParams(state).toString()).toBe("tab=portfolio&scope=all&range=1Y");
    expect(reportApiPath("portfolio", state)).toBe(`/reports/portfolio?scope=all&currencyMode=auto&range=1Y&limit=${REPORT_HOLDINGS_FILTER_LIMIT}`);
  });
});
