import { describe, expect, it } from "vitest";
import {
  ANALYSIS_DEFAULT_STATE,
  applyAnalysisSettings,
  buildSelectedSeriesId,
  buildUnrealizedPnlApiPath,
  buildUnrealizedPnlRoutePath,
  canFetchUnrealizedPnlAnalysis,
  getExplicitAnalysisPreferenceKeys,
  mapPerformanceRangeToAnalysisRange,
  parseAnalysisSettings,
  parseAnalysisSettingsFromPreferences,
  parseUnrealizedPnlRouteState,
  unrealizedPnlRouteStateToSearchParams,
} from "../../../features/analysis/unrealizedPnlRouteState";

describe("unrealizedPnlRouteState", () => {
  it("parses and serializes the hard-cut query model", () => {
    const state = parseUnrealizedPnlRouteState({
      range: "ALL",
      granularity: "weekly",
      markets: "US,TW,US",
      accountIds: "acc-2,acc-1",
      selection: "manualTickers",
      tickerMode: "custom",
      tickerIds: `${buildSelectedSeriesId("US", "NVDA")},${buildSelectedSeriesId("TW", "2330")}`,
      drivers: "20",
      positionStatus: "includeClosed",
      reportingCurrency: "USD",
      includeProvisional: "true",
      instrumentTypes: "ETF,STOCK",
      focus: "2026-06-19",
      view: "compare",
    });

    expect(state).toEqual({
      ...ANALYSIS_DEFAULT_STATE,
      range: "5Y",
      granularity: "weekly",
      markets: ["TW", "US"],
      accounts: ["acc-1", "acc-2"],
      selection: "manualTickers",
      tickerMode: "custom",
      tickerIds: [buildSelectedSeriesId("TW", "2330"), buildSelectedSeriesId("US", "NVDA")],
      drivers: 20,
      positionStatus: "includeClosed",
      reportingCurrency: "USD",
      includeProvisional: true,
      instrumentTypes: ["ETF", "STOCK"],
      focusDate: "2026-06-19",
      view: "compare",
    });
    expect(unrealizedPnlRouteStateToSearchParams(state).toString()).toContain("selection=manualTickers");
    expect(buildUnrealizedPnlApiPath(state)).toContain("tickerIds=TW%3A2330%2CUS%3ANVDA");
  });

  it("ignores legacy query params and falls back to defaults", () => {
    const state = parseUnrealizedPnlRouteState({
      selectionMode: "manual",
      selectedTickers: "US:NVDA",
      comparisonLineCount: "10",
      holdingsState: "include_sold_out",
    });

    expect(state.selection).toBe("topDrivers");
    expect(state.tickerMode).toBe("allEligible");
    expect(state.tickerIds).toEqual([]);
    expect(state.drivers).toBe(5);
    expect(state.positionStatus).toBe("openOnly");
  });

  it("keeps presentation-only focus and view out of API query strings", () => {
    const state = {
      ...ANALYSIS_DEFAULT_STATE,
      range: "1M" as const,
      selection: "manualTickers" as const,
      tickerMode: "custom" as const,
      tickerIds: [buildSelectedSeriesId("US", "NVDA")],
      focusDate: "2026-06-26",
      view: "compare" as const,
    };

    expect(buildUnrealizedPnlRoutePath(state)).toContain("focus=2026-06-26");
    expect(buildUnrealizedPnlRoutePath(state)).toContain("view=compare");
    expect(buildUnrealizedPnlApiPath(state)).toBe(
      "/analysis/unrealized-pnl?range=1M&selection=manualTickers&tickerMode=custom&tickerIds=US%3ANVDA&reportingCurrency=TWD",
    );
  });

  it("keeps incomplete custom ranges out of API fetches", () => {
    const incompleteCustomState = {
      ...ANALYSIS_DEFAULT_STATE,
      range: "CUSTOM" as const,
    };

    expect(canFetchUnrealizedPnlAnalysis(incompleteCustomState)).toBe(false);
    expect(buildUnrealizedPnlApiPath(incompleteCustomState)).toBe("/analysis/unrealized-pnl?reportingCurrency=TWD");
    expect(canFetchUnrealizedPnlAnalysis({ ...incompleteCustomState, from: "2026-01-01" })).toBe(true);
  });

  it("repairs invalid settings fields without discarding the full object", () => {
    const parsed = parseAnalysisSettings({
      version: 99,
      selection: "manualTickers",
      granularity: "bad",
      reportingCurrency: "USD",
      includeProvisional: true,
      detailLayout: "table",
      topDrivers: { positionStatus: "includeClosed", tickerMode: "allEligible", tickerIds: ["BAD"], drivers: 10 },
      manualTickers: { positionStatus: "bad", tickerMode: "custom", tickerIds: ["US:NVDA", "broken"] },
    });

    expect(parsed).toMatchObject({
      version: 1,
      selection: "manualTickers",
      granularity: ANALYSIS_DEFAULT_STATE.granularity,
      reportingCurrency: "USD",
      includeProvisional: true,
      detailLayout: "table",
      topDrivers: { positionStatus: "includeClosed", tickerMode: "allEligible", tickerIds: [], drivers: 10 },
      manualTickers: { positionStatus: "openOnly", tickerMode: "custom", tickerIds: ["US:NVDA"] },
    });
  });

  it("applies query-explicit fields ahead of repaired settings", () => {
    const explicitKeys = getExplicitAnalysisPreferenceKeys({
      granularity: "daily",
      drivers: "20",
      reportingCurrency: "USD",
    });
    const settings = parseAnalysisSettingsFromPreferences({
      reportingCurrency: "AUD",
      analysisUnrealizedPnlSettings: {
        version: 1,
        selection: "topDrivers",
        granularity: "monthly",
        reportingCurrency: "TWD",
        includeProvisional: true,
        detailLayout: "cards",
        topDrivers: { positionStatus: "includeClosed", tickerMode: "allEligible", tickerIds: [], drivers: 10 },
        manualTickers: { positionStatus: "openOnly", tickerMode: "custom", tickerIds: ["US:NVDA"] },
      },
    });

    const next = applyAnalysisSettings({
      ...ANALYSIS_DEFAULT_STATE,
      granularity: "daily",
      drivers: 20,
      reportingCurrency: "USD",
    }, settings, explicitKeys);

    expect(next.granularity).toBe("daily");
    expect(next.drivers).toBe(20);
    expect(next.reportingCurrency).toBe("USD");
    expect(next.positionStatus).toBe("includeClosed");
    expect(next.includeProvisional).toBe(true);
    expect(next.detailLayout).toBe("cards");
  });

  it("maps report/dashboard ranges through the shared serializer", () => {
    expect(mapPerformanceRangeToAnalysisRange("2M")).toBe("3M");
    expect(mapPerformanceRangeToAnalysisRange("24M")).toBe("3Y");
    expect(mapPerformanceRangeToAnalysisRange("10Y")).toBe("5Y");
    expect(mapPerformanceRangeToAnalysisRange("ALL")).toBe("ALL");
  });
});
