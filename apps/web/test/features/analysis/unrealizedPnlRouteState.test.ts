import { describe, expect, it } from "vitest";
import {
  ANALYSIS_DEFAULT_STATE,
  applyAnalysisPresentationDefaults,
  buildSelectedSeriesId,
  buildUnrealizedPnlApiPath,
  buildUnrealizedPnlRoutePath,
  canFetchUnrealizedPnlAnalysis,
  extractAnalysisPresentationDefaults,
  getExplicitAnalysisPreferenceKeys,
  mapPerformanceRangeToAnalysisRange,
  parseAnalysisPresentationDefaults,
  parseUnrealizedPnlRouteState,
  unrealizedPnlRouteStateToSearchParams,
} from "../../../features/analysis/unrealizedPnlRouteState";

describe("unrealizedPnlRouteState", () => {
  it("parses deterministic query state with sorted multi-select values", () => {
    const state = parseUnrealizedPnlRouteState({
      range: "ALL",
      granularity: "weekly",
      markets: "US,TW,US",
      accounts: "acc-2,acc-1",
      tickers: "nvda,2330",
      selection: "manual",
      selected: `${buildSelectedSeriesId("US", "NVDA")},${buildSelectedSeriesId("TW", "2330")}`,
      lines: "26",
      holdings: "include-sold",
      currency: "USD",
      provisional: "1",
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
      tickers: ["2330", "NVDA"],
      selectionMode: "manual",
      selected: [buildSelectedSeriesId("TW", "2330"), buildSelectedSeriesId("US", "NVDA")],
      lineCount: 20,
      holdingsState: "include-sold",
      reportingCurrency: "USD",
      includeProvisional: true,
      instrumentTypes: ["ETF", "STOCK"],
      focusDate: "2026-06-19",
      view: "compare",
    });
  });

  it("preserves custom date ranges and omits non-currency defaults from URLs", () => {
    const state = parseUnrealizedPnlRouteState({
      range: "CUSTOM",
      from: "2026-01-01",
      to: "2026-06-01",
      granularity: "monthly",
      lines: "7",
    });

    expect(state.range).toBe("CUSTOM");
    expect(state.from).toBe("2026-01-01");
    expect(state.to).toBe("2026-06-01");
    expect(unrealizedPnlRouteStateToSearchParams(state).toString()).toBe(
      "range=CUSTOM&fromDate=2026-01-01&toDate=2026-06-01&granularity=monthly&comparisonLineCount=7&reportingCurrency=TWD",
    );
  });

  it("maps report/dashboard ranges and route overrides through the shared analysis serializer", () => {
    expect(mapPerformanceRangeToAnalysisRange("2M")).toBe("3M");
    expect(mapPerformanceRangeToAnalysisRange("24M")).toBe("3Y");
    expect(mapPerformanceRangeToAnalysisRange("10Y")).toBe("5Y");
    expect(mapPerformanceRangeToAnalysisRange("ALL")).toBe("ALL");

    expect(buildUnrealizedPnlRoutePath({
      range: "1M",
      markets: ["US"],
      selected: [buildSelectedSeriesId("US", "NVDA")],
      selectionMode: "manual",
      reportingCurrency: "USD",
    })).toBe("/analysis/unrealized-pnl?range=1M&markets=US&selectionMode=manual&selectedTickers=US%3ANVDA&reportingCurrency=USD");
    expect(buildUnrealizedPnlRoutePath({ range: "ALL" })).toBe(
      "/analysis/unrealized-pnl?range=ALL&granularity=yearly&reportingCurrency=TWD",
    );
  });

  it("serializes explicit TWD reporting currency for deterministic analysis requests and deep links", () => {
    const state = {
      ...ANALYSIS_DEFAULT_STATE,
      range: "1M" as const,
      reportingCurrency: "TWD" as const,
    };

    expect(buildUnrealizedPnlRoutePath(state)).toBe(
      "/analysis/unrealized-pnl?range=1M&reportingCurrency=TWD",
    );
    expect(buildUnrealizedPnlApiPath(state)).toBe(
      "/analysis/unrealized-pnl?range=1M&reportingCurrency=TWD",
    );
  });

  it("keeps presentation-only focus and view out of strict API query strings", () => {
    const state = {
      ...ANALYSIS_DEFAULT_STATE,
      range: "1M" as const,
      selected: [buildSelectedSeriesId("US", "NVDA")],
      selectionMode: "manual" as const,
      focusDate: "2026-06-26",
      view: "compare" as const,
    };

    expect(buildUnrealizedPnlRoutePath(state)).toContain("focus=2026-06-26");
    expect(buildUnrealizedPnlRoutePath(state)).toContain("view=compare");
    expect(buildUnrealizedPnlApiPath(state)).toBe(
      "/analysis/unrealized-pnl?range=1M&selectionMode=manual&selectedTickers=US%3ANVDA&reportingCurrency=TWD",
    );
  });

  it("keeps incomplete custom ranges out of API fetches", () => {
    const incompleteCustomState = {
      ...ANALYSIS_DEFAULT_STATE,
      range: "CUSTOM" as const,
    };

    expect(canFetchUnrealizedPnlAnalysis(incompleteCustomState)).toBe(false);
    expect(buildUnrealizedPnlRoutePath(incompleteCustomState)).toBe("/analysis/unrealized-pnl?range=CUSTOM&reportingCurrency=TWD");
    expect(buildUnrealizedPnlApiPath(incompleteCustomState)).toBe("/analysis/unrealized-pnl?reportingCurrency=TWD");
    expect(canFetchUnrealizedPnlAnalysis({
      ...incompleteCustomState,
      from: "2026-01-01",
    })).toBe(true);
  });

  it("applies saved presentation defaults only when URL keys are absent", () => {
    const explicitKeys = getExplicitAnalysisPreferenceKeys({
      granularity: "daily",
      comparisonLineCount: "3",
      reportingCurrency: "USD",
    });
    const next = applyAnalysisPresentationDefaults(
      {
        ...ANALYSIS_DEFAULT_STATE,
        granularity: "daily",
        lineCount: 3,
        reportingCurrency: "USD",
      },
      {
        granularity: "monthly",
        lineCount: 8,
        holdingsState: "include-sold",
        reportingCurrency: "TWD",
        includeProvisional: true,
      },
      explicitKeys,
    );

    expect(next.granularity).toBe("daily");
    expect(next.lineCount).toBe(3);
    expect(next.reportingCurrency).toBe("USD");
    expect(next.holdingsState).toBe("include-sold");
    expect(next.includeProvisional).toBe(true);
  });

  it("parses and extracts bounded presentation preference payloads", () => {
    const parsed = parseAnalysisPresentationDefaults({
      granularity: "yearly",
      lineCount: 999,
      holdingsState: "include-sold",
      reportingCurrency: "AUD",
      includeProvisional: true,
      view: "ticker-detail",
    });

    expect(parsed).toEqual({
      granularity: "yearly",
      lineCount: 20,
      holdingsState: "include-sold",
      reportingCurrency: "AUD",
      includeProvisional: true,
    });
    expect(extractAnalysisPresentationDefaults({
      ...ANALYSIS_DEFAULT_STATE,
      granularity: "monthly",
      lineCount: 6,
      holdingsState: "include-sold",
      reportingCurrency: "USD",
      includeProvisional: true,
      focusDate: "2026-06-26",
    })).toEqual({
      granularity: "monthly",
      lineCount: 6,
      holdingsState: "include-sold",
      reportingCurrency: "USD",
      includeProvisional: true,
    });
  });
});
