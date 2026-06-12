import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../lib/api", () => ({
  getJson: vi.fn(),
}));

import { getJson } from "../../../../lib/api";
import {
  buildPrimaryTickerDetails,
  fetchTickerDetails,
  fetchTickerDetailsEnrichment,
  fetchTickerDetailsFullRefresh,
  fetchTickerDetailsHydration,
} from "../../../../features/portfolio/services/tickerDetailsService";

const getJsonMock = vi.mocked(getJson);

function buildDashboard(overrides?: {
  holdings?: unknown[];
  upcoming?: unknown[];
  recent?: unknown[];
}) {
  return {
    holdings: overrides?.holdings ?? [],
    holdingGroups: [],
    instruments: [],
    accounts: [],
    dividends: {
      upcoming: overrides?.upcoming ?? [],
      recent: overrides?.recent ?? [],
    },
  } as never;
}

describe("fetchTickerDetails", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns fallback unavailable states when the ticker details API fails", async () => {
    getJsonMock.mockRejectedValue(new Error("unavailable"));

    const details = await fetchTickerDetails({
      ticker: "2330",
      accountId: "acc-2",
      dashboard: buildDashboard(),
      transactions: [],
      instrument: null,
    });

    expect(details.identity).toMatchObject({
      ticker: "2330",
      marketCode: "TW",
      currency: "TWD",
      name: null,
    });
    expect(details.quote).toMatchObject({
      currentPrice: null,
      previousClose: null,
      quoteStatus: "missing",
    });
    expect(details.position).toMatchObject({
      accountScope: "acc-2",
      quantity: 0,
      transactionsCount: 0,
      nextDividendDate: null,
      lastDividendPostedDate: null,
    });
    expect(details.chart.points).toEqual([]);
    expect(details.dividends).toMatchObject({
      upcomingCount: 0,
      nextPaymentDate: null,
      lastPostedDate: null,
    });
    expect(details.fundamentals.panels).toHaveLength(2);
    expect(details.fundamentals.panels[0]?.items[0]).toMatchObject({
      key: "market",
      value: null,
      source: null,
      asOf: null,
    });
    expect(getJsonMock).toHaveBeenCalledWith("/tickers/2330/details?accountId=acc-2");
  });

  it("merges partial API payloads over fallback data without fabricating missing fields", async () => {
    getJsonMock.mockResolvedValue({
      quote: {
        currentPrice: 912,
        quoteStatus: "current",
      },
      position: {
        quantity: 12,
      },
      fundamentals: {
        panels: [
          {
            key: "profitability",
            title: "Profitability",
            items: [
              {
                key: "roe",
                label: "ROE",
                value: null,
                source: null,
                asOf: null,
              },
            ],
          },
        ],
      },
    } as never);

    const details = await fetchTickerDetails({
      ticker: "NVDA",
      dashboard: buildDashboard(),
      transactions: [],
      instrument: {
        ticker: "NVDA",
        name: "NVIDIA",
        marketCode: "US",
        instrumentType: "STOCK",
      } as never,
    });

    expect(details.identity).toMatchObject({
      ticker: "NVDA",
      name: "NVIDIA",
      marketCode: "US",
    });
    expect(details.quote).toMatchObject({
      currentPrice: 912,
      quoteStatus: "current",
      previousClose: null,
    });
    expect(details.position).toMatchObject({
      accountScope: "all",
      quantity: 12,
      averageCost: null,
    });
    expect(details.fundamentals.panels).toEqual([
      {
        key: "profitability",
        title: "Profitability",
        items: [
          {
            key: "roe",
            label: "ROE",
            value: null,
            source: null,
            asOf: null,
          },
        ],
      },
    ]);
    expect(getJsonMock).toHaveBeenCalledWith("/tickers/NVDA/details?marketCode=US");
  });

  it("maps the ticker details API DTO into the ticker page model", async () => {
    getJsonMock.mockResolvedValue({
      identity: {
        ticker: "2330",
        marketCode: "TW",
        accountId: "acc-1",
        name: "Taiwan Semiconductor Manufacturing",
        instrumentType: "STOCK",
        priceCurrency: "TWD",
        barsBackfillStatus: "ok",
      },
      quote: {
        currentUnitPrice: 610,
        previousClose: 595.5,
        change: 14.5,
        changePercent: 2.41,
        asOf: "2026-05-20",
        source: "test",
        quoteStatus: "current",
      },
      position: {
        quantity: 4000,
        averageCostPerShare: 555.2,
        costBasisAmount: 2220800,
        marketValueAmount: 2440000,
        unrealizedPnlAmount: 219200,
        realizedPnlAmount: 1200,
        currency: "TWD",
        accountIds: ["acc-1"],
        lastTradeDate: "2026-01-02",
      },
      chart: {
        range: "1Y",
        points: [
          {
            date: "2026-05-20",
            open: 600,
            high: 615,
            low: 598,
            close: 610,
            volume: 1000,
            source: "test",
          },
        ],
      },
      transactions: [{ id: "trade-1" }],
      dividends: {
        upcoming: [{ paymentDate: "2026-06-25", exDividendDate: "2026-06-01" }],
        recent: [{ postedAt: "2026-03-25" }],
      },
      holdingGroup: {
        ticker: "2330",
        marketCode: "TW",
        quantity: 4000,
        costBasisAmount: 2220800,
        currency: "TWD",
        averageCostPerShare: 555.2,
        currentUnitPrice: 610,
        marketValueAmount: 2440000,
        unrealizedPnlAmount: 219200,
        allocationPct: null,
        change: 14.5,
        changePercent: 2.41,
        previousClose: 595.5,
        quoteStatus: "current",
        nextDividendDate: null,
        lastDividendPostedDate: null,
        freshness: "current",
        freshnessTooltip: null,
        accountCount: 1,
        reportingCurrency: "TWD",
        reportingCostBasisAmount: 2220800,
        reportingMarketValueAmount: 2440000,
        reportingUnrealizedPnlAmount: 219200,
        reportingAllocationPercent: null,
        fxStatus: "complete",
        allocationBasisUsed: "market_value",
        allocationBasisFallbackReason: null,
        children: [],
      },
      accountBreakdown: [{
        accountId: "acc-1",
        accountName: "Main",
        ticker: "2330",
        marketCode: "TW",
        quantity: 4000,
        costBasisAmount: 2220800,
        currency: "TWD",
        averageCostPerShare: 555.2,
        currentUnitPrice: 610,
        marketValueAmount: 2440000,
        unrealizedPnlAmount: 219200,
        allocationPct: 100,
        change: 14.5,
        changePercent: 2.41,
        previousClose: 595.5,
        quoteStatus: "current",
        nextDividendDate: null,
        lastDividendPostedDate: null,
        freshness: "current",
        freshnessTooltip: null,
        reportingCurrency: "TWD",
        reportingCostBasisAmount: 2220800,
        reportingMarketValueAmount: 2440000,
        reportingUnrealizedPnlAmount: 219200,
        reportingAllocationPercent: 100,
        fxStatus: "complete",
        allocationBasisUsed: "market_value",
        allocationBasisFallbackReason: null,
      }],
      fundamentals: {
        marketCap: { value: 15_800_000_000_000, source: "provider", asOf: "2026-05-20" },
        enterpriseValue: { value: null, source: null, asOf: null },
        priceEarningsRatio: { value: 22.4, source: "provider", asOf: "2026-05-20" },
        priceBookRatio: { value: null, source: null, asOf: null },
        dividendYield: { value: 2.95, source: "provider", asOf: "2026-05-20" },
        earningsPerShare: { value: 27.25, source: "provider", asOf: "2026-05-20" },
        revenueTrailingTwelveMonths: { value: null, source: null, asOf: null },
        netIncomeTrailingTwelveMonths: { value: null, source: null, asOf: null },
      },
      fundamentalsRefresh: {
        providerId: "provider",
        refreshedAt: "2026-05-20T00:00:00.000Z",
        nextRefreshAt: "2026-05-21T00:00:00.000Z",
        lastAttemptedAt: "2026-05-20T00:00:00.000Z",
        lastError: null,
        status: "fresh",
      },
    } as never);

    const details = await fetchTickerDetails({
      ticker: "2330",
      accountId: "acc-1",
      dashboard: buildDashboard(),
      transactions: [],
      instrument: {
        ticker: "2330",
        marketCode: "TW",
        instrumentType: "STOCK",
        name: "TSMC",
      } as never,
    });

    expect(details.identity).toMatchObject({
      ticker: "2330",
      name: "Taiwan Semiconductor Manufacturing",
      currency: "TWD",
    });
    expect(details.quote).toMatchObject({
      currentPrice: 610,
      changeAmount: 14.5,
      changePercent: 2.41,
    });
    expect(details.position).toMatchObject({
      quantity: 4000,
      averageCost: 555.2,
      marketValue: 2440000,
      transactionsCount: 1,
      nextDividendDate: "2026-06-25",
    });
    expect(details.accountBreakdown).toHaveLength(1);
    expect(details.accountBreakdown[0]).toMatchObject({
      accountId: "acc-1",
      reportingMarketValueAmount: 2440000,
      reportingUnrealizedPnlAmount: 219200,
    });
    expect(details.holdingGroup).toMatchObject({
      ticker: "2330",
      reportingMarketValueAmount: 2440000,
    });
    expect(details.chart.points[0]).toMatchObject({
      price: 610,
      averageCost: 555.2,
      quantity: 4000,
    });
    expect(details.fundamentals.panels[0]?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "marketCap",
          value: 15_800_000_000_000,
          source: "provider",
        }),
      ]),
    );
  });

  it("does not replace missing details payload valuation with dashboard-derived ticker values", async () => {
    getJsonMock.mockResolvedValue({
      identity: {
        ticker: "NVDA",
        marketCode: "US",
        accountId: null,
        name: "NVIDIA",
        instrumentType: "STOCK",
        priceCurrency: "USD",
        barsBackfillStatus: "ready",
      },
      quote: {
        currentUnitPrice: null,
        previousClose: null,
        change: null,
        changePercent: null,
        asOf: null,
        source: null,
        quoteStatus: "missing",
      },
      position: {
        quantity: 10,
        averageCostPerShare: 500,
        costBasisAmount: 5000,
        marketValueAmount: null,
        unrealizedPnlAmount: null,
        realizedPnlAmount: 0,
        currency: "USD",
        accountIds: ["acc-1"],
        lastTradeDate: "2026-01-02",
      },
      chart: {
        range: "1Y",
        points: [],
      },
      transactions: [],
      dividends: {
        upcoming: [],
        recent: [],
      },
      holdingGroup: {
        ticker: "NVDA",
        marketCode: "US",
        quantity: 10,
        costBasisAmount: 5000,
        currency: "USD",
        averageCostPerShare: 500,
        currentUnitPrice: null,
        marketValueAmount: null,
        unrealizedPnlAmount: null,
        allocationPct: null,
        change: null,
        changePercent: null,
        previousClose: null,
        quoteStatus: "missing",
        nextDividendDate: null,
        lastDividendPostedDate: null,
        freshness: "current",
        freshnessTooltip: null,
        accountCount: 1,
        reportingCurrency: "USD",
        reportingCostBasisAmount: 5000,
        reportingMarketValueAmount: null,
        reportingUnrealizedPnlAmount: null,
        reportingAllocationPercent: null,
        fxStatus: "complete",
        allocationBasisUsed: "cost_basis",
        allocationBasisFallbackReason: "missing_quote",
        children: [{
          accountId: "acc-1",
          accountName: "Broker",
          ticker: "NVDA",
          marketCode: "US",
          quantity: 10,
          costBasisAmount: 5000,
          currency: "USD",
          averageCostPerShare: 500,
          currentUnitPrice: null,
          marketValueAmount: null,
          unrealizedPnlAmount: null,
          allocationPct: null,
          change: null,
          changePercent: null,
          previousClose: null,
          quoteStatus: "missing",
          nextDividendDate: null,
          lastDividendPostedDate: null,
          freshness: "current",
          freshnessTooltip: null,
          reportingCurrency: "USD",
          reportingCostBasisAmount: 5000,
          reportingMarketValueAmount: null,
          reportingUnrealizedPnlAmount: null,
          reportingAllocationPercent: null,
          fxStatus: "complete",
          allocationBasisUsed: "cost_basis",
          allocationBasisFallbackReason: "missing_quote",
        }],
      },
      accountBreakdown: [{
        accountId: "acc-1",
        accountName: "Broker",
        ticker: "NVDA",
        marketCode: "US",
        quantity: 10,
        costBasisAmount: 5000,
        currency: "USD",
        averageCostPerShare: 500,
        currentUnitPrice: null,
        marketValueAmount: null,
        unrealizedPnlAmount: null,
        allocationPct: null,
        change: null,
        changePercent: null,
        previousClose: null,
        quoteStatus: "missing",
        nextDividendDate: null,
        lastDividendPostedDate: null,
        freshness: "current",
        freshnessTooltip: null,
        reportingCurrency: "USD",
        reportingCostBasisAmount: 5000,
        reportingMarketValueAmount: null,
        reportingUnrealizedPnlAmount: null,
        reportingAllocationPercent: null,
        fxStatus: "complete",
        allocationBasisUsed: "cost_basis",
        allocationBasisFallbackReason: "missing_quote",
      }],
      fundamentals: {
        marketCap: { value: null, source: null, asOf: null },
        enterpriseValue: { value: null, source: null, asOf: null },
        priceEarningsRatio: { value: null, source: null, asOf: null },
        priceBookRatio: { value: null, source: null, asOf: null },
        dividendYield: { value: null, source: null, asOf: null },
        earningsPerShare: { value: null, source: null, asOf: null },
        revenueTrailingTwelveMonths: { value: null, source: null, asOf: null },
        netIncomeTrailingTwelveMonths: { value: null, source: null, asOf: null },
      },
      fundamentalsRefresh: {
        providerId: null,
        refreshedAt: null,
        nextRefreshAt: null,
        lastAttemptedAt: null,
        lastError: null,
        status: "missing",
      },
    } as never);
    const dashboard = buildDashboard({
      holdings: [{
        ticker: "NVDA",
        accountId: "acc-1",
        accountName: "Broker",
        accountDefaultCurrency: "USD",
        marketCode: "US",
        quantity: 10,
        averageCostPerShare: 500,
        currentUnitPrice: 900,
        previousClose: 880,
        change: 20,
        changePercent: 2.2727,
        quoteStatus: "current",
        currency: "USD",
        costBasisAmount: 5000,
        marketValueAmount: 9000,
        unrealizedPnlAmount: 4000,
      }],
    });
    const instrument = {
      ticker: "NVDA",
      marketCode: "US",
      instrumentType: "STOCK",
      name: "NVIDIA",
    } as never;
    const primaryDetails = buildPrimaryTickerDetails({
      ticker: "NVDA",
      dashboard,
      transactions: [],
      instrument,
    });

    const details = await fetchTickerDetailsFullRefresh({
      ticker: "NVDA",
      marketCode: "US",
      transactions: [],
      instrument,
      primaryDetails,
    });

    expect(details.quote).toMatchObject({
      currentPrice: null,
      previousClose: null,
      changeAmount: null,
      changePercent: null,
      quoteStatus: "missing",
    });
    expect(details.position).toMatchObject({
      marketValue: null,
      unrealizedPnl: null,
    });
    expect(details.holdingGroup).toMatchObject({
      reportingMarketValueAmount: null,
      reportingUnrealizedPnlAmount: null,
    });
    expect(details.accountBreakdown[0]).toMatchObject({
      reportingMarketValueAmount: null,
      reportingUnrealizedPnlAmount: null,
    });
    expect(details.chart.points).toEqual([]);
  });

  it("maps the ticker enrichment API DTO without replacing primary position data", async () => {
    getJsonMock.mockResolvedValue({
      identity: {
        ticker: "NVDA",
        marketCode: "US",
        accountId: null,
        name: "NVIDIA",
        instrumentType: "STOCK",
        priceCurrency: "USD",
        barsBackfillStatus: "ok",
      },
      chart: {
        range: "1Y",
        points: [
          {
            date: "2026-05-20",
            open: 900,
            high: 920,
            low: 890,
            close: 912,
            volume: 1000,
            source: "test",
          },
        ],
      },
      fundamentals: {
        marketCap: { value: 2_000_000_000_000, source: "provider", asOf: "2026-05-20" },
        enterpriseValue: { value: null, source: null, asOf: null },
        priceEarningsRatio: { value: 33, source: "provider", asOf: "2026-05-20" },
        priceBookRatio: { value: null, source: null, asOf: null },
        dividendYield: { value: null, source: null, asOf: null },
        earningsPerShare: { value: 12, source: "provider", asOf: "2026-05-20" },
        revenueTrailingTwelveMonths: { value: null, source: null, asOf: null },
        netIncomeTrailingTwelveMonths: { value: null, source: null, asOf: null },
      },
      fundamentalsRefresh: {
        providerId: "provider",
        refreshedAt: "2026-05-20T00:00:00.000Z",
        nextRefreshAt: "2026-05-21T00:00:00.000Z",
        lastAttemptedAt: "2026-05-20T00:00:00.000Z",
        lastError: null,
        status: "fresh",
      },
    } as never);

    const dashboard = buildDashboard({
      holdings: [{
        ticker: "NVDA",
        accountId: "acc-1",
        accountName: "Broker",
        accountDefaultCurrency: "USD",
        marketCode: "US",
        quantity: 10,
        averageCostPerShare: 500,
        currentUnitPrice: 900,
        currency: "USD",
        costBasisAmount: 5000,
        marketValueAmount: 9000,
        unrealizedPnlAmount: 4000,
      }],
    });
    const instrument = {
      ticker: "NVDA",
      marketCode: "US",
      instrumentType: "STOCK",
      name: "NVIDIA",
    } as never;
    const primaryDetails = buildPrimaryTickerDetails({
      ticker: "NVDA",
      dashboard,
      transactions: [],
      instrument,
    });

    const details = await fetchTickerDetailsEnrichment({
      ticker: "NVDA",
      marketCode: "US",
      transactions: [],
      instrument,
      primaryDetails,
    });

    expect(details.position).toMatchObject({
      quantity: 10,
      averageCost: 500,
      marketValue: null,
    });
    expect(details.chart.points[0]).toMatchObject({
      date: "2026-05-20",
      label: "2026-05-20",
      price: 912,
      averageCost: 500,
      quantity: 10,
    });
    expect(details.fundamentals.panels[0]?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "marketCap",
          value: 2_000_000_000_000,
        }),
      ]),
    );
    expect(getJsonMock).toHaveBeenCalledWith("/tickers/NVDA/enrichment?marketCode=US");
  });

  it("does not derive missing ticker valuation from enrichment chart snapshots", async () => {
    getJsonMock.mockResolvedValue({
      identity: {
        ticker: "2330",
        marketCode: "TW",
        accountId: null,
        name: "TSMC",
        instrumentType: "STOCK",
        priceCurrency: "TWD",
        barsBackfillStatus: "ok",
      },
      chart: {
        range: "1Y",
        points: [
          {
            date: "2026-06-09",
            open: 2200,
            high: 2250,
            low: 2190,
            close: 2250,
            volume: 1000,
            source: "snapshot",
          },
          {
            date: "2026-06-10",
            open: 2250,
            high: 2260,
            low: 2240,
            close: 2255,
            volume: 1200,
            source: "snapshot",
          },
        ],
      },
      fundamentals: {
        marketCap: { value: null, source: null, asOf: null },
        enterpriseValue: { value: null, source: null, asOf: null },
        priceEarningsRatio: { value: null, source: null, asOf: null },
        priceBookRatio: { value: null, source: null, asOf: null },
        dividendYield: { value: null, source: null, asOf: null },
        earningsPerShare: { value: null, source: null, asOf: null },
        revenueTrailingTwelveMonths: { value: null, source: null, asOf: null },
        netIncomeTrailingTwelveMonths: { value: null, source: null, asOf: null },
      },
      fundamentalsRefresh: {
        providerId: null,
        refreshedAt: null,
        nextRefreshAt: null,
        lastAttemptedAt: null,
        lastError: null,
        status: "missing",
      },
    } as never);

    const dashboard = buildDashboard({
      holdings: [
        {
          ticker: "2330",
          accountId: "acc-1",
          accountName: "台股國泰證券",
          accountDefaultCurrency: "TWD",
          marketCode: "TW",
          quantity: 4000,
          averageCostPerShare: 823.98,
          currentUnitPrice: null,
          previousClose: null,
          change: null,
          changePercent: null,
          quoteStatus: "missing",
          currency: "TWD",
          costBasisAmount: 3295920,
          marketValueAmount: null,
          unrealizedPnlAmount: null,
        },
        {
          ticker: "2330",
          accountId: "acc-2",
          accountName: "Fubon",
          accountDefaultCurrency: "TWD",
          marketCode: "TW",
          quantity: 1000,
          averageCostPerShare: 891.27,
          currentUnitPrice: null,
          previousClose: null,
          change: null,
          changePercent: null,
          quoteStatus: "missing",
          currency: "TWD",
          costBasisAmount: 891270,
          marketValueAmount: null,
          unrealizedPnlAmount: null,
        },
      ],
    });
    const instrument = {
      ticker: "2330",
      marketCode: "TW",
      instrumentType: "STOCK",
      name: "TSMC",
    } as never;
    const primaryDetails = buildPrimaryTickerDetails({
      ticker: "2330",
      marketCode: "TW",
      dashboard,
      transactions: [],
      instrument,
    });

    const details = await fetchTickerDetailsHydration({
      ticker: "2330",
      marketCode: "TW",
      transactions: [],
      instrument,
      primaryDetails,
    });

    expect(details.quote).toMatchObject({
      currentPrice: null,
      previousClose: null,
      changeAmount: null,
      quoteStatus: "missing",
    });
    expect(details.position).toMatchObject({
      quantity: 5000,
      marketValue: null,
      unrealizedPnl: null,
    });
    expect(details.holdingGroup).toBeNull();
    expect(details.accountBreakdown).toEqual([]);
    expect(details.chart.points.at(-1)).toMatchObject({
      date: "2026-06-10",
      price: 2255,
      averageCost: 837.438,
      quantity: 5000,
    });

    const usdReportingPrimaryDetails = {
      ...primaryDetails,
      holdingGroup: primaryDetails.holdingGroup
        ? {
            ...primaryDetails.holdingGroup,
            reportingCurrency: "USD" as const,
            reportingMarketValueAmount: null,
            reportingUnrealizedPnlAmount: null,
            reportingDailyChangeAmount: null,
            children: primaryDetails.holdingGroup.children.map((child) => ({
              ...child,
              reportingCurrency: "USD" as const,
              reportingMarketValueAmount: null,
              reportingUnrealizedPnlAmount: null,
              reportingDailyChangeAmount: null,
            })),
          }
        : null,
      accountBreakdown: primaryDetails.accountBreakdown.map((child) => ({
        ...child,
        reportingCurrency: "USD" as const,
        reportingMarketValueAmount: null,
        reportingUnrealizedPnlAmount: null,
        reportingDailyChangeAmount: null,
      })),
    };

    const usdReportingDetails = await fetchTickerDetailsHydration({
      ticker: "2330",
      marketCode: "TW",
      transactions: [],
      instrument,
      primaryDetails: usdReportingPrimaryDetails,
    });

    expect(usdReportingDetails.position).toMatchObject({
      marketValue: null,
      unrealizedPnl: null,
    });
    expect(usdReportingDetails.holdingGroup).toBeNull();
    expect(usdReportingDetails.accountBreakdown).toEqual([]);
  });

  it("does not derive current valuation from historical custom enrichment ranges", async () => {
    getJsonMock.mockResolvedValue({
      identity: {
        ticker: "2330",
        marketCode: "TW",
        accountId: null,
        name: "TSMC",
        instrumentType: "STOCK",
        priceCurrency: "TWD",
        barsBackfillStatus: "ok",
      },
      chart: {
        range: "CUSTOM",
        metadata: {
          requested: {
            range: null,
            startDate: "2025-01-01",
            endDate: "2025-06-30",
          },
          resolved: {
            range: "CUSTOM",
            startDate: "2025-01-01",
            endDate: "2025-06-30",
          },
          available: {
            startDate: "2024-01-02",
            endDate: "2026-06-10",
          },
          truncated: {
            startDate: false,
            endDate: false,
          },
        },
        points: [
          {
            date: "2025-06-27",
            open: 1490,
            high: 1510,
            low: 1480,
            close: 1500,
            volume: 1000,
            source: "snapshot",
          },
          {
            date: "2025-06-30",
            open: 1500,
            high: 1520,
            low: 1490,
            close: 1515,
            volume: 1200,
            source: "snapshot",
          },
        ],
      },
      fundamentals: {
        marketCap: { value: null, source: null, asOf: null },
        enterpriseValue: { value: null, source: null, asOf: null },
        priceEarningsRatio: { value: null, source: null, asOf: null },
        priceBookRatio: { value: null, source: null, asOf: null },
        dividendYield: { value: null, source: null, asOf: null },
        earningsPerShare: { value: null, source: null, asOf: null },
        revenueTrailingTwelveMonths: { value: null, source: null, asOf: null },
        netIncomeTrailingTwelveMonths: { value: null, source: null, asOf: null },
      },
      fundamentalsRefresh: {
        providerId: null,
        refreshedAt: null,
        nextRefreshAt: null,
        lastAttemptedAt: null,
        lastError: null,
        status: "missing",
      },
    } as never);

    const dashboard = buildDashboard({
      holdings: [{
        ticker: "2330",
        accountId: "acc-1",
        accountName: "台股國泰證券",
        accountDefaultCurrency: "TWD",
        marketCode: "TW",
        quantity: 4000,
        averageCostPerShare: 823.98,
        currentUnitPrice: null,
        previousClose: null,
        change: null,
        changePercent: null,
        quoteStatus: "missing",
        currency: "TWD",
        costBasisAmount: 3295920,
        marketValueAmount: null,
        unrealizedPnlAmount: null,
      }],
    });
    const instrument = {
      ticker: "2330",
      marketCode: "TW",
      instrumentType: "STOCK",
      name: "TSMC",
    } as never;
    const primaryDetails = buildPrimaryTickerDetails({
      ticker: "2330",
      marketCode: "TW",
      dashboard,
      transactions: [],
      instrument,
    });

    const details = await fetchTickerDetailsHydration({
      ticker: "2330",
      marketCode: "TW",
      startDate: "2025-01-01",
      endDate: "2025-06-30",
      transactions: [],
      instrument,
      primaryDetails,
    });

    expect(details.quote).toMatchObject({
      currentPrice: null,
      previousClose: null,
      changeAmount: null,
      quoteStatus: "missing",
    });
    expect(details.position).toMatchObject({
      marketValue: null,
      unrealizedPnl: null,
    });
    expect(details.holdingGroup).toBeNull();
    expect(details.chart.points.at(-1)).toMatchObject({
      date: "2025-06-30",
      price: 1515,
      averageCost: 823.98,
      quantity: 4000,
    });
    expect(getJsonMock).toHaveBeenCalledWith("/tickers/2330/enrichment?marketCode=TW&startDate=2025-01-01&endDate=2025-06-30");
  });

  it("hydrates ticker details from the enrichment endpoint after primary data is seeded", async () => {
    getJsonMock.mockRejectedValue(new Error("unavailable"));
    const dashboard = buildDashboard({
      holdings: [{
        ticker: "NVDA",
        accountId: "acc-1",
        accountName: "Broker",
        accountDefaultCurrency: "USD",
        marketCode: "US",
        quantity: 10,
        averageCostPerShare: 500,
        currentUnitPrice: 900,
        currency: "USD",
        costBasisAmount: 5000,
        marketValueAmount: 9000,
        unrealizedPnlAmount: 4000,
      }],
    });
    const instrument = {
      ticker: "NVDA",
      marketCode: "US",
      instrumentType: "STOCK",
      name: "NVIDIA",
    } as never;
    const primaryDetails = buildPrimaryTickerDetails({
      ticker: "NVDA",
      dashboard,
      transactions: [],
      instrument,
    });

    const details = await fetchTickerDetailsHydration({
      ticker: "NVDA",
      accountId: "acc-1",
      marketCode: "US",
      transactions: [],
      instrument,
      primaryDetails,
    });

    expect(details).toBe(primaryDetails);
    expect(getJsonMock).toHaveBeenCalledWith("/tickers/NVDA/enrichment?accountId=acc-1&marketCode=US");
  });

  it("refreshes ticker details from the full details endpoint after mutations", async () => {
    getJsonMock.mockRejectedValue(new Error("unavailable"));
    const dashboard = buildDashboard({
      holdings: [{
        ticker: "NVDA",
        accountId: "acc-1",
        accountName: "Broker",
        accountDefaultCurrency: "USD",
        marketCode: "US",
        quantity: 10,
        averageCostPerShare: 500,
        currentUnitPrice: 900,
        currency: "USD",
        costBasisAmount: 5000,
        marketValueAmount: 9000,
        unrealizedPnlAmount: 4000,
      }],
    });
    const instrument = {
      ticker: "NVDA",
      marketCode: "US",
      instrumentType: "STOCK",
      name: "NVIDIA",
    } as never;
    const primaryDetails = buildPrimaryTickerDetails({
      ticker: "NVDA",
      dashboard,
      transactions: [],
      instrument,
    });

    const details = await fetchTickerDetailsFullRefresh({
      ticker: "NVDA",
      accountId: "acc-1",
      marketCode: "US",
      transactions: [],
      instrument,
      primaryDetails,
    });

    expect(details).toBe(primaryDetails);
    expect(getJsonMock).toHaveBeenCalledWith("/tickers/NVDA/details?accountId=acc-1&marketCode=US");
  });
});
