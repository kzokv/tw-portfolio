import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/api", () => ({
  getJson: vi.fn(),
}));

import { getJson } from "../../../lib/api";
import { fetchUnrealizedPnlAnalysis } from "../../../features/analysis/services/unrealizedPnlService";
import { ANALYSIS_DEFAULT_STATE, buildSelectedSeriesId } from "../../../features/analysis/unrealizedPnlRouteState";

const getJsonMock = vi.mocked(getJson);

describe("fetchUnrealizedPnlAnalysis", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("omits presentation-only URL state from API fetches and derives available filters from response rows", async () => {
    getJsonMock.mockResolvedValue({
      query: {
        range: "1M",
        fromDate: "2026-06-01",
        toDate: "2026-06-26",
        granularity: "daily",
        markets: [],
        accountIds: [],
        tickers: [],
        selectionMode: "manual",
        selectedTickers: [{ ticker: "NVDA", marketCode: "US" }],
        comparisonLineCount: 5,
        holdingsState: "open_only",
        reportingCurrency: "TWD",
        includeProvisional: false,
        instrumentTypes: [],
        asOf: "2026-06-26T00:00:00.000Z",
      },
      summary: {
        reportingCurrency: "TWD",
        startDate: "2026-06-01",
        endDate: "2026-06-26",
        startUnrealizedPnlAmount: 10,
        endUnrealizedPnlAmount: 25,
        periodChangeAmount: 15,
        currentOpenTickerCount: 1,
        includedTickerCount: 1,
      },
      portfolioSeries: [{ date: "2026-06-26", unrealizedPnlAmount: 25 }],
      tickerSeries: [{
        date: "2026-06-26",
        unrealizedPnlAmount: 25,
        marketValueAmount: 1000,
        costBasisAmount: 975,
        quantity: 2,
        fxAvailable: true,
        isProvisional: false,
        ticker: "NVDA",
        marketCode: "US",
        instrumentName: "NVIDIA",
        instrumentType: "STOCK",
        accountIds: ["acc-us-growth"],
        accountNames: ["US Growth"],
        isSelected: true,
        isSoldOut: false,
      }],
      rankings: [{
        ticker: "NVDA",
        marketCode: "US",
        instrumentName: "NVIDIA",
        instrumentType: "STOCK",
        accountIds: ["acc-us-growth"],
        accountNames: ["US Growth"],
        currentlyHeld: true,
        isSoldOut: false,
        startUnrealizedPnlAmount: 10,
        endUnrealizedPnlAmount: 25,
        periodChangeAmount: 15,
        latestMarketValueAmount: 1000,
        latestCostBasisAmount: 975,
        latestQuantity: 2,
        tradeMarkerCount: 0,
      }],
      selectedTickers: [{ ticker: "NVDA", marketCode: "US" }],
      tradeMarkers: [],
      dataHealth: {
        snapshotRowCount: 1,
        provisionalRowCount: 0,
        missingFxRowCount: 0,
        nullUnrealizedRowCount: 0,
        excludedSoldOutTickerCount: 0,
      },
      diagnostics: {
        latestSnapshotDate: "2026-06-26",
        firstSnapshotDate: "2026-06-26",
        bucketCount: 1,
        returnedTickerSeriesCount: 1,
        availableTickerSeriesCount: 1,
      },
      deepLink: "/analysis/unrealized-pnl?range=1M&selectionMode=manual&selectedTickers=US%3ANVDA",
    } as never);

    const model = await fetchUnrealizedPnlAnalysis({
      ...ANALYSIS_DEFAULT_STATE,
      range: "1M",
      selectionMode: "manual",
      selected: [buildSelectedSeriesId("US", "NVDA")],
      focusDate: "2026-06-26",
      view: "compare",
    });

    expect(getJsonMock).toHaveBeenCalledWith(
      "/analysis/unrealized-pnl?range=1M&selectionMode=manual&selectedTickers=US%3ANVDA",
      { contextScope: "portfolio" },
    );
    expect(model.availableFilters.markets).toEqual([{ value: "US", label: "US" }]);
    expect(model.availableFilters.accounts).toEqual([{ value: "acc-us-growth", label: "US Growth" }]);
    expect(model.availableFilters.tickers).toEqual([{ value: "NVDA", label: "NVDA US" }]);
  });
});
