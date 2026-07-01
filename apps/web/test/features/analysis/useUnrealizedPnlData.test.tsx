import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ANALYSIS_DEFAULT_STATE } from "../../../features/analysis/unrealizedPnlRouteState";
import { useUnrealizedPnlData } from "../../../features/analysis/hooks/useUnrealizedPnlData";
import { fetchUnrealizedPnlAnalysis } from "../../../features/analysis/services/unrealizedPnlService";
import type { UnrealizedPnlAnalysisDto, UnrealizedPnlAnalysisRouteState } from "../../../features/analysis/unrealizedPnlTypes";

vi.mock("../../../features/analysis/services/unrealizedPnlService", () => ({
  fetchUnrealizedPnlAnalysis: vi.fn(),
}));

let result: ReturnType<typeof useUnrealizedPnlData>;

const loadedAnalysis = {
  query: {
    range: "3M",
    from: null,
    to: null,
    startDate: "2026-01-01",
    endDate: "2026-01-31",
    granularity: "weekly",
    markets: [],
    accounts: [],
    tickerIds: [],
    selection: "topDrivers",
    tickerMode: "allEligible",
    drivers: 5,
    positionStatus: "openOnly",
    reportingCurrency: "TWD",
    includeProvisional: false,
    instrumentTypes: [],
  },
  availableFilters: {
    markets: [],
    accounts: [],
    tickers: [],
    reportingCurrencies: [],
    instrumentTypes: [],
  },
  requestedTickerAvailability: [],
  warningFacts: {
    candidateLimitApplied: false,
    candidateLimit: 200,
    omittedEligibleCount: 0,
    noisyChart: false,
    renderedCandidateCount: 0,
    noisyChartLineThreshold: 20,
  },
  summary: {
    totalUnrealized: { label: "Unrealized", value: 100, currency: "TWD", detail: "Loaded" },
    periodChange: { label: "Change", value: 10, currency: "TWD", detail: "Loaded" },
    bestDriver: null,
    worstDriver: null,
    startDate: "2026-01-31",
    endDate: "2026-01-31",
  },
  dataHealth: {
    status: "complete",
    title: "Complete",
    detail: "Complete",
    provisionalIncluded: false,
    stalePriceCount: 0,
    missingPriceCount: 0,
    source: "api",
  },
  portfolioSeries: [{ date: "2026-01-31", unrealizedPnl: 100 }],
  tickerSeries: [],
  ranking: [],
  tickerSelection: [],
  tickerComposition: [],
  selectedSeriesIds: [],
  reportsPreview: {
    currentUnrealized: 100,
    topGainLabel: null,
    topGainValue: null,
    topLossLabel: null,
    topLossValue: null,
    openHref: "/analysis/unrealized-pnl",
  },
  deepLink: "/analysis/unrealized-pnl",
  generatedAt: "2026-01-31T00:00:00.000Z",
} satisfies UnrealizedPnlAnalysisDto;

function Harness({
  initialData,
  state,
}: {
  initialData: UnrealizedPnlAnalysisDto | null;
  state: UnrealizedPnlAnalysisRouteState;
}) {
  result = useUnrealizedPnlData({
    cachePolicy: null,
    cacheScope: "test-user",
    contextRefreshSignal: 0,
    initialData,
    locale: "en",
    state,
  });
  return null;
}

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

describe("useUnrealizedPnlData", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.mocked(fetchUnrealizedPnlAnalysis).mockReset();
    window.sessionStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) {
      act(() => root.unmount());
    }
    container?.remove();
    window.sessionStorage.clear();
  });

  it("clears stale loaded data when a custom range becomes incomplete", () => {
    const validState = { ...ANALYSIS_DEFAULT_STATE };
    const incompleteCustomState = {
      ...ANALYSIS_DEFAULT_STATE,
      range: "CUSTOM",
      from: null,
      to: null,
    } satisfies UnrealizedPnlAnalysisRouteState;

    act(() => {
      root.render(createElement(Harness, { initialData: loadedAnalysis, state: validState }));
    });
    expect(result.data).toBe(loadedAnalysis);
    expect(result.cacheStatus).toBe("fresh");

    act(() => {
      root.render(createElement(Harness, { initialData: null, state: incompleteCustomState }));
    });

    expect(result.data).toBeNull();
    expect(result.cacheStatus).toBeNull();
    expect(result.isBootstrapping).toBe(false);
    expect(result.isRefreshing).toBe(false);
    expect(result.errorMessage).toBe("");
  });

  it("keeps mismatched initial reporting-currency data visible without caching it under the selected currency", async () => {
    const audAnalysis = {
      ...loadedAnalysis,
      query: {
        ...loadedAnalysis.query,
        reportingCurrency: "AUD" as const,
      },
      summary: {
        ...loadedAnalysis.summary,
        totalUnrealized: { ...loadedAnalysis.summary.totalUnrealized, currency: "AUD" as const },
        periodChange: { ...loadedAnalysis.summary.periodChange, currency: "AUD" as const },
      },
    } satisfies UnrealizedPnlAnalysisDto;
    vi.mocked(fetchUnrealizedPnlAnalysis).mockResolvedValue(audAnalysis);

    await act(async () => {
      root.render(createElement(Harness, { initialData: audAnalysis, state: ANALYSIS_DEFAULT_STATE }));
      await Promise.resolve();
    });

    expect(result.data).toBe(audAnalysis);
    expect(result.cacheStatus).toBeNull();
    expect(fetchUnrealizedPnlAnalysis).toHaveBeenCalledWith(ANALYSIS_DEFAULT_STATE, expect.objectContaining({
      signal: expect.any(AbortSignal),
    }));
    expect(window.sessionStorage.length).toBe(0);
  });
});
