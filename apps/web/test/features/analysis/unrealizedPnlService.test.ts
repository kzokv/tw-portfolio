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
      portfolioSeries: [{ date: "2026-06-26", unrealizedPnlAmount: null }],
      tickerSeries: [
        {
          date: "2026-06-26",
          unrealizedPnlAmount: -100,
          marketValueAmount: 900,
          costBasisAmount: 1000,
          quantity: 1,
          fxAvailable: true,
          isProvisional: false,
          ticker: "AAPL",
          marketCode: "US",
          instrumentName: "Apple",
          instrumentType: "STOCK",
          accountIds: ["acc-us-growth"],
          accountNames: ["US Growth"],
          isSelected: false,
          isSoldOut: false,
        },
        {
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
        },
        {
          date: "2026-06-26",
          unrealizedPnlAmount: null,
          marketValueAmount: null,
          costBasisAmount: 975,
          quantity: 2,
          fxAvailable: false,
          isProvisional: false,
          ticker: "MSFT",
          marketCode: "US",
          instrumentName: "Microsoft",
          instrumentType: "STOCK",
          accountIds: ["acc-us-growth"],
          accountNames: ["US Growth"],
          isSelected: false,
          isSoldOut: false,
        },
      ],
      rankings: [{
        ticker: "AAPL",
        marketCode: "US",
        instrumentName: "Apple",
        instrumentType: "STOCK",
        accountIds: ["acc-us-growth"],
        accountNames: ["US Growth"],
        currentlyHeld: true,
        isSoldOut: false,
        startUnrealizedPnlAmount: 0,
        endUnrealizedPnlAmount: -100,
        periodChangeAmount: -100,
        latestMarketValueAmount: 900,
        latestCostBasisAmount: 1000,
        latestQuantity: 1,
        tradeMarkerCount: 0,
      }, {
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
      }, {
        ticker: "MSFT",
        marketCode: "US",
        instrumentName: "Microsoft",
        instrumentType: "STOCK",
        accountIds: ["acc-us-growth"],
        accountNames: ["US Growth"],
        currentlyHeld: true,
        isSoldOut: false,
        startUnrealizedPnlAmount: null,
        endUnrealizedPnlAmount: null,
        periodChangeAmount: null,
        latestMarketValueAmount: null,
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

    const controller = new AbortController();
    const model = await fetchUnrealizedPnlAnalysis({
      ...ANALYSIS_DEFAULT_STATE,
      range: "1M",
      selectionMode: "manual",
      selected: [buildSelectedSeriesId("US", "NVDA")],
      focusDate: "2026-06-26",
      view: "compare",
    }, { signal: controller.signal });

    expect(getJsonMock).toHaveBeenCalledWith(
      "/analysis/unrealized-pnl?range=1M&selectionMode=manual&selectedTickers=US%3ANVDA&reportingCurrency=TWD",
      { contextScope: "portfolio", signal: controller.signal },
    );
    expect(model.availableFilters.markets).toEqual([{ value: "US", label: "US" }]);
    expect(model.availableFilters.accounts).toEqual([{ value: "acc-us-growth", label: "US Growth" }]);
    expect(model.availableFilters.tickers).toEqual([
      { value: "AAPL", label: "AAPL US" },
      { value: "MSFT", label: "MSFT US" },
      { value: "NVDA", label: "NVDA US" },
    ]);
    expect(model.summary.bestDriver).toEqual(expect.objectContaining({ ticker: "NVDA", periodChange: 15 }));
    expect(model.summary.worstDriver).toEqual(expect.objectContaining({ ticker: "AAPL", periodChange: -100 }));
    expect(model.portfolioSeries).toEqual([{ date: "2026-06-26", unrealizedPnl: null }]);
    expect(model.tickerSeries.find((series) => series.ticker === "MSFT")).toEqual(expect.objectContaining({
      endUnrealizedPnl: null,
      periodChange: null,
      points: [expect.objectContaining({ unrealizedPnl: null, marketValue: null, costBasis: 975 })],
    }));
  });
});
