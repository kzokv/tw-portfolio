import { describe, expect, it } from "vitest";
import { buildHoldingsSelectionVisibleSummary } from "../../../components/holdings/holdingsSelectionSummary";

describe("buildHoldingsSelectionVisibleSummary", () => {
  const rows = [
    {
      marketCode: "TW",
      ticker: "2330",
      reportingCostBasisAmount: 100,
      reportingMarketValueAmount: 120,
      reportingUnrealizedPnlAmount: 20,
    },
    {
      marketCode: "US",
      ticker: "MSFT",
      reportingCostBasisAmount: null,
      reportingMarketValueAmount: 80,
      reportingUnrealizedPnlAmount: null,
    },
    {
      marketCode: "TW",
      ticker: "0050",
      reportingCostBasisAmount: 50,
      reportingMarketValueAmount: null,
      reportingUnrealizedPnlAmount: 5,
    },
  ];

  it("totals every visible row in all mode and marks partial metrics independently", () => {
    expect(buildHoldingsSelectionVisibleSummary({
      mode: "all",
      rows,
      selectedTickerIds: [],
      universeTickerIds: ["TW:2330", "US:MSFT", "TW:0050", "AU:BHP"],
    })).toEqual({
      visibleSelectedCount: 3,
      globalSelectedCount: 4,
      cost: {
        amount: 150,
        eligibleCount: 3,
        includedCount: 2,
        isPartial: true,
      },
      marketValue: {
        amount: 200,
        eligibleCount: 3,
        includedCount: 2,
        isPartial: true,
      },
      unrealizedPnl: {
        amount: 25,
        eligibleCount: 3,
        includedCount: 2,
        isPartial: true,
      },
    });
  });

  it("filters to selected tickers in custom mode and keeps global selected count from the saved selection", () => {
    expect(buildHoldingsSelectionVisibleSummary({
      mode: "custom",
      rows,
      selectedTickerIds: ["US:MSFT", "TW:0050", "JP:7203"],
      universeTickerIds: ["TW:2330", "US:MSFT", "TW:0050"],
    })).toEqual({
      visibleSelectedCount: 2,
      globalSelectedCount: 3,
      cost: {
        amount: 50,
        eligibleCount: 2,
        includedCount: 1,
        isPartial: true,
      },
      marketValue: {
        amount: 80,
        eligibleCount: 2,
        includedCount: 1,
        isPartial: true,
      },
      unrealizedPnl: {
        amount: 5,
        eligibleCount: 2,
        includedCount: 1,
        isPartial: true,
      },
    });
  });

  it("returns null totals without partial flags when no visible rows are selected", () => {
    expect(buildHoldingsSelectionVisibleSummary({
      mode: "custom",
      rows,
      selectedTickerIds: ["JP:7203"],
      universeTickerIds: ["TW:2330", "US:MSFT", "TW:0050", "JP:7203"],
    })).toEqual({
      visibleSelectedCount: 0,
      globalSelectedCount: 1,
      cost: {
        amount: null,
        eligibleCount: 0,
        includedCount: 0,
        isPartial: false,
      },
      marketValue: {
        amount: null,
        eligibleCount: 0,
        includedCount: 0,
        isPartial: false,
      },
      unrealizedPnl: {
        amount: null,
        eligibleCount: 0,
        includedCount: 0,
        isPartial: false,
      },
    });
  });

  it("counts visible selected tickers once even when account rows duplicate the same ticker", () => {
    expect(buildHoldingsSelectionVisibleSummary({
      mode: "custom",
      rows: [
        {
          marketCode: "TW",
          ticker: "2330",
          reportingCostBasisAmount: 100,
          reportingMarketValueAmount: 120,
          reportingUnrealizedPnlAmount: 20,
        },
        {
          marketCode: "TW",
          ticker: "2330",
          reportingCostBasisAmount: 50,
          reportingMarketValueAmount: 55,
          reportingUnrealizedPnlAmount: 5,
        },
      ],
      selectedTickerIds: ["TW:2330"],
      universeTickerIds: ["TW:2330"],
    })).toMatchObject({
      visibleSelectedCount: 1,
      globalSelectedCount: 1,
      cost: { amount: 150, eligibleCount: 2, includedCount: 2, isPartial: false },
      marketValue: { amount: 175, eligibleCount: 2, includedCount: 2, isPartial: false },
      unrealizedPnl: { amount: 25, eligibleCount: 2, includedCount: 2, isPartial: false },
    });
  });
});
