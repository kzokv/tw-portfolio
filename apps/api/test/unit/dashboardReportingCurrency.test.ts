// KZO-180 — Pure-helper tests for the FX-aware dashboard aggregator.
//
// `translateOverviewSummary` is exercised here with mocked `getFxRate`. The
// `translatePerformancePoints` time-series path is covered here for the
// snapshot-backed branch and the strict snapshot-only empty-series behavior.

import { describe, it, expect } from "vitest";
import {
  buildOverviewMarketValues,
  translateOverviewHoldingGroups,
  translateOverviewSummary,
  translatePerformancePoints,
} from "../../src/services/dashboardReportingCurrency.js";
import type {
  DashboardOverviewHoldingGroupDto,
  DashboardOverviewHoldingDto,
  DashboardOverviewUpcomingDividendDto,
  DashboardOverviewRecentDividendDto,
} from "@vakwen/shared-types";
import type {
  AggregatedSnapshotPoint,
  Persistence,
} from "../../src/persistence/types.js";
import type { Store } from "../../src/types/store.js";
import type { DailyBar } from "@vakwen/domain";

interface FakeFxRecord {
  base: string;
  quote: string;
  rate: number;
  asOf?: string;
}

// Minimal Persistence mock — only the methods the aggregator calls are wired.
function makeFakePersistence(opts: {
  fxRates?: FakeFxRecord[];
  aggregated?: AggregatedSnapshotPoint[];
  dailyBars?: DailyBar[];
  dailyBarReadStats?: {
    batchCalls: number;
    batchPairCounts: number[];
    singleCalls: number;
  };
}): Persistence {
  const fx = opts.fxRates ?? [];
  const aggregated = opts.aggregated ?? [];
  const dailyBars = opts.dailyBars ?? [];
  // Stub-typed cast — the rest of the surface is not exercised by the helper
  // under test, but TypeScript needs the Persistence shape.
  return {
    getFxRate: async (base: string, quote: string, _asOfDate: string) => {
      if (base === quote) return 1.0;
      const match = [...fx]
        .filter((r) => r.base === base && r.quote === quote && (!r.asOf || r.asOf <= _asOfDate))
        .sort((a, b) => (b.asOf ?? "").localeCompare(a.asOf ?? ""))[0];
      return match ? match.rate : null;
    },
    getAggregatedSnapshotsInReportingCurrency: async () => aggregated,
    getDailyBarsForTickers: async (tickers: string[], startDate: string, endDate: string) => {
      const result = new Map<string, DailyBar[]>();
      for (const ticker of tickers) {
        result.set(
          ticker,
          dailyBars
            .filter((bar) => bar.ticker === ticker && bar.barDate >= startDate && bar.barDate <= endDate)
            .sort((a, b) => a.barDate.localeCompare(b.barDate)),
        );
      }
      return result;
    },
    getDailyBarsForTickerMarket: async (ticker: string, marketCode: string, startDate: string, endDate: string) => {
      if (opts.dailyBarReadStats) {
        opts.dailyBarReadStats.singleCalls += 1;
      }
      return dailyBars
        .filter((bar) =>
          bar.ticker === ticker &&
          ((bar as DailyBar & { marketCode?: string }).marketCode ?? marketCode) === marketCode &&
          bar.barDate >= startDate &&
          bar.barDate <= endDate)
        .sort((a, b) => a.barDate.localeCompare(b.barDate));
    },
    getDailyBarsForTickerMarkets: async (
      pairs: readonly { ticker: string; marketCode: string }[],
      startDate: string,
      endDate: string,
    ) => {
      if (opts.dailyBarReadStats) {
        opts.dailyBarReadStats.batchCalls += 1;
        opts.dailyBarReadStats.batchPairCounts.push(pairs.length);
      }
      const result = new Map<string, DailyBar[]>();
      for (const pair of pairs) {
        result.set(
          `${pair.ticker}\0${pair.marketCode}`,
          dailyBars
            .filter((bar) =>
              bar.ticker === pair.ticker &&
              ((bar as DailyBar & { marketCode?: string }).marketCode ?? pair.marketCode) === pair.marketCode &&
              bar.barDate >= startDate &&
              bar.barDate <= endDate)
            .sort((a, b) => a.barDate.localeCompare(b.barDate)),
        );
      }
      return result;
    },
  } as unknown as Persistence;
}

function makeTrade(overrides: Partial<Store["accounting"]["facts"]["tradeEvents"][number]>): Store["accounting"]["facts"]["tradeEvents"][number] {
  return {
    id: "trade-1",
    userId: "user-1",
    accountId: "acct-1",
    ticker: "2330",
    marketCode: "TW",
    instrumentType: "STOCK",
    type: "BUY",
    quantity: 10,
    unitPrice: 100,
    priceCurrency: "TWD",
    tradeDate: "2026-01-02",
    commissionAmount: 0,
    taxAmount: 0,
    isDayTrade: false,
    feeSnapshot: {
      id: "fee-1",
      accountId: "acct-1",
      name: "Default",
      boardCommissionRate: 0,
      commissionDiscountPercent: 0,
      minimumCommissionAmount: 0,
      commissionCurrency: "TWD",
      commissionRoundingMode: "FLOOR",
      taxRoundingMode: "FLOOR",
      stockSellTaxRateBps: 0,
      stockDayTradeTaxRateBps: 0,
      etfSellTaxRateBps: 0,
      bondEtfSellTaxRateBps: 0,
      commissionChargeMode: "CHARGED_UPFRONT",
    },
    ...overrides,
  };
}

function makeStore(overrides: Partial<Store> = {}): Store {
  return {
    userId: "user-1",
    settings: {} as Store["settings"],
    accounts: [],
    feeProfiles: [],
    feeProfileBindings: [],
    instruments: [],
    accounting: {
      facts: {
        tradeEvents: [],
        cashLedgerEntries: [],
        dividendLedgerEntries: [],
        dividendDeductionEntries: [],
        dividendSourceLines: [],
        corporateActions: [],
      },
      projections: {
        lots: [],
        lotAllocations: [],
        holdings: [],
        dailyPortfolioSnapshots: [],
      },
      policy: {
        inventoryModel: "LOT_CAPABLE",
        disposalPolicy: "WEIGHTED_AVERAGE",
      },
    },
    marketData: {
      dividendEvents: [],
      instruments: [],
    },
    recomputeJobs: [],
    idempotencyKeys: new Set(),
    ...overrides,
  } as Store;
}

function makeDailyBar(ticker: string, barDate: string, close: number, marketCode?: string): DailyBar {
  const bar: DailyBar = {
    ticker,
    barDate,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1000,
    source: "test",
    ingestedAt: `${barDate}T00:00:00.000Z`,
  };
  return marketCode ? ({ ...bar, marketCode } as DailyBar) : bar;
}

const baseHolding: DashboardOverviewHoldingDto = {
  accountId: "acct-1",
  ticker: "2330",
  marketCode: "TW",
  quantity: 10,
  costBasisAmount: 1000,
  currency: "TWD",
  averageCostPerShare: 100,
  currentUnitPrice: 110,
  marketValueAmount: 1100,
  unrealizedPnlAmount: 100,
  allocationPct: 50,
  change: 1,
  changePercent: 1,
  previousClose: 109,
  quoteStatus: "current",
  nextDividendDate: null,
  lastDividendPostedDate: null,
  freshness: "current",
  freshnessTooltip: null,
};

const baseSummary = {
  asOf: "2026-04-29T00:00:00.000Z",
  accountCount: 1,
  holdingCount: 1,
  totalCostAmount: 1000,
  marketValueAmount: 1100 as number | null,
  unrealizedPnlAmount: 100 as number | null,
  dailyChangeAmount: 10 as number | null,
  dailyChangePercent: 1 as number | null,
  upcomingDividendCount: 0,
  upcomingDividendAmount: null as number | null,
  openIssueCount: 0,
};

const noDividends = { upcoming: [] as DashboardOverviewUpcomingDividendDto[], recent: [] as DashboardOverviewRecentDividendDto[] };

function makeHoldingGroup(overrides: Partial<DashboardOverviewHoldingGroupDto> = {}): DashboardOverviewHoldingGroupDto {
  return {
    ticker: baseHolding.ticker,
    marketCode: baseHolding.marketCode,
    quantity: baseHolding.quantity,
    costBasisAmount: baseHolding.costBasisAmount,
    currency: baseHolding.currency,
    averageCostPerShare: baseHolding.averageCostPerShare,
    currentUnitPrice: baseHolding.currentUnitPrice,
    marketValueAmount: baseHolding.marketValueAmount,
    unrealizedPnlAmount: baseHolding.unrealizedPnlAmount,
    allocationPct: baseHolding.allocationPct,
    change: baseHolding.change,
    changePercent: baseHolding.changePercent,
    previousClose: baseHolding.previousClose,
    quoteStatus: baseHolding.quoteStatus,
    nextDividendDate: baseHolding.nextDividendDate,
    lastDividendPostedDate: baseHolding.lastDividendPostedDate,
    freshness: baseHolding.freshness,
    freshnessTooltip: baseHolding.freshnessTooltip,
    accountCount: 1,
    reportingCurrency: "TWD",
    reportingCostBasisAmount: null,
    reportingMarketValueAmount: null,
    reportingUnrealizedPnlAmount: null,
    reportingDailyChangeAmount: null,
    reportingAllocationPercent: null,
    fxStatus: "complete",
    allocationBasisUsed: "market_value",
    allocationBasisFallbackReason: null,
    children: [{
      ...baseHolding,
      reportingCurrency: "TWD",
      reportingCostBasisAmount: null,
      reportingMarketValueAmount: null,
      reportingUnrealizedPnlAmount: null,
      reportingDailyChangeAmount: null,
      reportingAllocationPercent: null,
      fxStatus: "complete",
      allocationBasisUsed: "market_value",
      allocationBasisFallbackReason: null,
    }],
    ...overrides,
  };
}

describe("translateOverviewHoldingGroups", () => {
  it("populates row-level reporting daily change from backend FX translation", async () => {
    const persistence = makeFakePersistence({
      fxRates: [{ base: "TWD", quote: "AUD", rate: 0.05, asOf: "2026-04-29" }],
    });

    const [group] = await translateOverviewHoldingGroups(
      [makeHoldingGroup()],
      "AUD",
      "market_value",
      "2026-04-29",
      persistence,
    );

    expect(group?.reportingDailyChangeAmount).toBe(0.5);
    expect(group?.children[0]?.reportingDailyChangeAmount).toBe(0.5);
  });
});

describe("buildOverviewMarketValues", () => {
  it("builds market breakdowns from backend reporting values only", () => {
    const rows = [
      makeHoldingGroup({
        marketCode: "TW",
        reportingCurrency: "TWD",
        reportingMarketValueAmount: 1_000,
      }),
      makeHoldingGroup({
        ticker: "0050",
        marketCode: "TW",
        reportingCurrency: "TWD",
        reportingMarketValueAmount: 2_500,
      }),
      makeHoldingGroup({
        ticker: "AAPL",
        marketCode: "US",
        currency: "USD",
        marketValueAmount: 999_999,
        reportingCurrency: "TWD",
        reportingMarketValueAmount: null,
        fxStatus: "missing",
      }),
    ];

    expect(buildOverviewMarketValues(rows, "TWD")).toEqual([
      { marketCode: "TW", value: 3_500, reportingCurrency: "TWD" },
    ]);
  });
});

describe("translateOverviewSummary", () => {
  it("TWD-only no-op: every translated field equals the native value", async () => {
    const persistence = makeFakePersistence({});
    const out = await translateOverviewSummary(
      { ...baseSummary },
      [{ ...baseHolding }],
      noDividends,
      "TWD",
      "2026-04-29",
      persistence,
    );
    expect(out.reportingCurrency).toBe("TWD");
    expect(out.fxStatus).toBe("complete");
    expect(out.totalCostAmount).toBe(1000);
    expect(out.marketValueAmount).toBe(1100);
    expect(out.unrealizedPnlAmount).toBe(100);
    expect(out.dailyChangeAmount).toBe(10);
    expect(out.dailyChangePercent).toBeCloseTo((10 / 1090) * 100);
    expect(out.upcomingDividendAmount).toBe(null);
    // totalCostCurrency dropped — test by negative shape assertion.
    expect("totalCostCurrency" in out).toBe(false);
  });

  it("Mixed-currency translation: TWD + USD positions translated to TWD via mocked getFxRate", async () => {
    const usdHolding: DashboardOverviewHoldingDto = {
      ...baseHolding,
      accountId: "acct-2",
      ticker: "AAPL",
      marketCode: "US",
      currency: "USD",
      quantity: 5,
      costBasisAmount: 1000,        // USD
      marketValueAmount: 1100,       // USD
      unrealizedPnlAmount: 100,      // USD
      change: 2,
      previousClose: 218,
    };
    const persistence = makeFakePersistence({
      fxRates: [{ base: "USD", quote: "TWD", rate: 32 }],
    });

    const out = await translateOverviewSummary(
      { ...baseSummary, totalCostAmount: 2000, marketValueAmount: 2200, unrealizedPnlAmount: 200, dailyChangeAmount: 20, dailyChangePercent: 1 },
      [{ ...baseHolding }, usdHolding],
      noDividends,
      "TWD",
      "2026-04-29",
      persistence,
    );

    expect(out.reportingCurrency).toBe("TWD");
    expect(out.fxStatus).toBe("complete");
    // 1000 TWD * 1.0 + 1000 USD * 32 = 33000
    expect(out.totalCostAmount).toBe(33000);
    // 1100 + 1100 * 32 = 36300
    expect(out.marketValueAmount).toBe(36300);
    // 100 + 100 * 32 = 3300
    expect(out.unrealizedPnlAmount).toBe(3300);
    // 10*1*1 + 5*2*32 = 10 + 320 = 330
    expect(out.dailyChangeAmount).toBe(330);
  });

  it("Mixed-currency missing-FX: USD pair has no rate → fxStatus partial + nullable fields", async () => {
    const usdHolding: DashboardOverviewHoldingDto = {
      ...baseHolding,
      accountId: "acct-2",
      ticker: "AAPL",
      marketCode: "US",
      currency: "USD",
      quantity: 5,
      costBasisAmount: 1000,
      marketValueAmount: 1100,
      unrealizedPnlAmount: 100,
    };
    const persistence = makeFakePersistence({});  // no FX rates → USD→TWD missing
    const out = await translateOverviewSummary(
      { ...baseSummary },
      [{ ...baseHolding }, usdHolding],
      noDividends,
      "TWD",
      "2026-04-29",
      persistence,
    );
    expect(out.reportingCurrency).toBe("TWD");
    expect(out.fxStatus).toBe("partial");
    // marketValueAmount/unrealizedPnlAmount become null because USD contribution failed.
    expect(out.marketValueAmount).toBe(null);
    expect(out.unrealizedPnlAmount).toBe(null);
    // dailyChangeAmount also null because USD position couldn't translate.
    expect(out.dailyChangeAmount).toBe(null);
  });

  it("All FX missing: only USD positions, no FX rates → fxStatus missing", async () => {
    const usdHolding: DashboardOverviewHoldingDto = {
      ...baseHolding,
      marketCode: "US",
      currency: "USD",
    };
    const persistence = makeFakePersistence({});
    const out = await translateOverviewSummary(
      { ...baseSummary, marketValueAmount: 1100, unrealizedPnlAmount: 100 },
      [usdHolding],
      noDividends,
      "TWD",
      "2026-04-29",
      persistence,
    );
    expect(out.fxStatus).toBe("missing");
    expect(out.marketValueAmount).toBe(null);
    expect(out.unrealizedPnlAmount).toBe(null);
  });

  it("Translates upcomingDividendAmount across currencies", async () => {
    const persistence = makeFakePersistence({
      fxRates: [{ base: "USD", quote: "TWD", rate: 32 }],
    });
    const dividends = {
      upcoming: [
        // TWD upcoming
        { accountId: "acct-1", ticker: "2330", exDividendDate: null, paymentDate: "2026-05-15", expectedAmount: 200, currency: "TWD", status: "declared" } as DashboardOverviewUpcomingDividendDto,
        // USD upcoming
        { accountId: "acct-2", ticker: "AAPL", exDividendDate: null, paymentDate: "2026-05-20", expectedAmount: 5, currency: "USD", status: "declared" } as DashboardOverviewUpcomingDividendDto,
      ],
      recent: [] as DashboardOverviewRecentDividendDto[],
    };
    const out = await translateOverviewSummary(
      { ...baseSummary, upcomingDividendCount: 2, upcomingDividendAmount: 205 },
      [{ ...baseHolding }],
      dividends,
      "TWD",
      "2026-04-29",
      persistence,
    );
    // 200 TWD + 5 USD * 32 = 200 + 160 = 360
    expect(out.upcomingDividendAmount).toBe(360);
    expect(out.fxStatus).toBe("complete");
  });

  it("Reports `reportingCurrency: USD` correctly even when self-pair maps cleanly", async () => {
    const usdHolding: DashboardOverviewHoldingDto = {
      ...baseHolding,
      marketCode: "US",
      currency: "USD",
    };
    const persistence = makeFakePersistence({});  // no FX rates needed for self-pair
    const out = await translateOverviewSummary(
      { ...baseSummary },
      [usdHolding],
      noDividends,
      "USD",
      "2026-04-29",
      persistence,
    );
    expect(out.reportingCurrency).toBe("USD");
    expect(out.fxStatus).toBe("complete");
    expect(out.marketValueAmount).toBe(1100);
  });
});

describe("translatePerformancePoints (snapshot-backed branch)", () => {
  it("Maps fxAvailable=true rows to populated point fields", async () => {
    const persistence = makeFakePersistence({
      aggregated: [
        {
          date: "2026-04-29",
          totalCostBasis: 1000,
          totalMarketValue: 1100,
          totalUnrealizedPnl: 100,
          cumulativeRealizedPnl: 50,
          cumulativeDividends: 25,
          totalReturnAmount: 175,
          totalReturnPercent: 17.5,
          isProvisional: false,
          fxAvailable: true,
        },
      ],
    });
    const out = await translatePerformancePoints(
      "user-1",
      "1Y",
      "2026-04-29",
      "TWD",
      persistence,
    );
    expect(out.reportingCurrency).toBe("TWD");
    expect(out.fxStatus).toBe("complete");
    expect(out.points).toHaveLength(1);
    expect(out.points[0]).toMatchObject({
      date: "2026-04-29",
      totalCostAmount: 1000,
      marketValueAmount: 1100,
      unrealizedPnlAmount: 100,
      cumulativeRealizedPnlAmount: 50,
      cumulativeDividendsAmount: 25,
      fxAvailable: true,
    });
    expect(out.requestedAsOf).toBe("2026-04-29");
    expect(out.lastReliableDate).toBe("2026-04-29");
    expect(out.marketDataStaleSince).toBeNull();
    expect(out.diagnostics).toEqual({
      latestSnapshotDate: "2026-04-29",
      latestReliableValuationDate: "2026-04-29",
      expectedLatestValuationDate: "2026-04-29",
      staleSinceDate: null,
      knownGapReasons: [],
    });
  });

  it("marks performance series stale when the latest reliable point predates the requested as-of date", async () => {
    const persistence = makeFakePersistence({
      aggregated: [
        {
          date: "2026-05-29",
          totalCostBasis: 1000,
          totalMarketValue: 1100,
          totalUnrealizedPnl: 100,
          cumulativeRealizedPnl: 0,
          cumulativeDividends: 0,
          totalReturnAmount: 100,
          totalReturnPercent: 10,
          isProvisional: false,
          fxAvailable: true,
        },
        {
          date: "2026-06-08",
          totalCostBasis: 1000,
          totalMarketValue: 0,
          totalUnrealizedPnl: 0,
          cumulativeRealizedPnl: 0,
          cumulativeDividends: 0,
          totalReturnAmount: null,
          totalReturnPercent: null,
          isProvisional: false,
          fxAvailable: false,
        },
      ],
    });

    const out = await translatePerformancePoints(
      "user-1",
      "1M",
      "2026-06-08",
      "TWD",
      persistence,
    );

    expect(out.points.map((point) => point.date)).toEqual(["2026-05-29", "2026-06-08"]);
    expect(out.points[1]?.marketValueAmount).toBeNull();
    expect(out.requestedAsOf).toBe("2026-06-08");
    expect(out.lastReliableDate).toBe("2026-05-29");
    expect(out.marketDataStaleSince).toBe("2026-05-29");
    expect(out.diagnostics).toEqual({
      latestSnapshotDate: "2026-06-08",
      latestReliableValuationDate: "2026-05-29",
      expectedLatestValuationDate: "2026-06-08",
      staleSinceDate: "2026-05-29",
      knownGapReasons: ["stale_snapshot", "missing_fx"],
    });
  });

  it("does not mark same-day reliable data stale when requestedAsOf is a timestamp", async () => {
    const persistence = makeFakePersistence({
      aggregated: [
        {
          date: "2026-06-09",
          totalCostBasis: 1000,
          totalMarketValue: 1100,
          totalUnrealizedPnl: 100,
          cumulativeRealizedPnl: 0,
          cumulativeDividends: 0,
          totalReturnAmount: 100,
          totalReturnPercent: 10,
          isProvisional: false,
          fxAvailable: true,
        },
      ],
    });

    const out = await translatePerformancePoints(
      "user-1",
      "1M",
      "2026-06-09T15:30:00.000Z",
      "TWD",
      persistence,
    );

    expect(out.requestedAsOf).toBe("2026-06-09");
    expect(out.lastReliableDate).toBe("2026-06-09");
    expect(out.marketDataStaleSince).toBeNull();
  });

  it("seeds dated finance replay before the requested range", async () => {
    const persistence = makeFakePersistence({
      aggregated: [
        {
          date: "2026-01-01",
          totalCostBasis: 999,
          totalMarketValue: 120,
          totalUnrealizedPnl: -879,
          cumulativeRealizedPnl: 0,
          cumulativeDividends: 0,
          totalReturnAmount: -879,
          totalReturnPercent: -87.98798798798799,
          isProvisional: false,
          fxAvailable: true,
        },
      ],
    });
    const baseStore = makeStore();
    const store = makeStore({
      accounting: {
        ...baseStore.accounting,
        facts: {
          ...baseStore.accounting.facts,
          tradeEvents: [
            makeTrade({
              id: "pre-range-buy",
              quantity: 1,
              unitPrice: 100,
              tradeDate: "2025-12-15",
            }),
          ],
        },
      },
    });

    const out = await translatePerformancePoints(
      "user-1",
      "YTD",
      "2026-01-01",
      "TWD",
      persistence,
      store,
    );

    expect(out.points).toHaveLength(1);
    expect(out.points[0]).toMatchObject({
      date: "2026-01-01",
      totalCostAmount: 100,
      marketValueAmount: 120,
      unrealizedPnlAmount: 20,
      totalReturnAmount: 20,
    });
  });

  it("uses transaction-date Book Cost instead of FX-moving snapshot cost when store data is available", async () => {
    const persistence = makeFakePersistence({
      aggregated: [
        {
          date: "2026-01-02",
          totalCostBasis: 1000,
          totalMarketValue: 1000,
          totalUnrealizedPnl: 0,
          cumulativeRealizedPnl: 0,
          cumulativeDividends: 0,
          totalReturnAmount: 0,
          totalReturnPercent: 0,
          isProvisional: false,
          fxAvailable: true,
        },
        {
          date: "2026-01-03",
          totalCostBasis: 1200,
          totalMarketValue: 1300,
          totalUnrealizedPnl: 100,
          cumulativeRealizedPnl: 0,
          cumulativeDividends: 0,
          totalReturnAmount: 100,
          totalReturnPercent: 8.3333,
          isProvisional: false,
          fxAvailable: true,
        },
      ],
    });
    const store = makeStore({
      accounting: {
        ...makeStore().accounting,
        facts: {
          ...makeStore().accounting.facts,
          tradeEvents: [makeTrade({ tradeDate: "2026-01-02", quantity: 10, unitPrice: 100 })],
        },
      },
    });

    const out = await translatePerformancePoints(
      "user-1",
      "ALL",
      "2026-01-03",
      "TWD",
      persistence,
      store,
    );

    expect(out.points).toHaveLength(2);
    expect(out.points.map((point) => point.totalCostAmount)).toEqual([1000, 1000]);
    expect(out.points[1]).toMatchObject({
      marketValueAmount: 1300,
      unrealizedPnlAmount: 300,
      totalReturnAmount: 300,
      totalReturnPercent: 30,
    });
  });

  it("falls back to snapshot-backed return metrics when dated finance FX is missing but snapshot FX exists", async () => {
    const persistence = makeFakePersistence({
      fxRates: [
        { base: "USD", quote: "KRW", rate: 1300, asOf: "2026-01-03" },
      ],
      aggregated: [
        {
          date: "2026-01-03",
          totalCostBasis: 130000,
          totalMarketValue: 143000,
          totalUnrealizedPnl: 13000,
          cumulativeRealizedPnl: 0,
          cumulativeDividends: 2600,
          totalReturnAmount: 15600,
          totalReturnPercent: 12,
          isProvisional: false,
          fxAvailable: true,
        },
      ],
    });
    const store = makeStore({
      accounting: {
        ...makeStore().accounting,
        facts: {
          ...makeStore().accounting.facts,
          tradeEvents: [
            makeTrade({
              id: "usd-buy",
              ticker: "AAPL",
              marketCode: "US",
              quantity: 10,
              unitPrice: 10,
              priceCurrency: "USD",
              tradeDate: "2026-01-02",
            }),
          ],
        },
      },
    });

    const out = await translatePerformancePoints(
      "user-1",
      "ALL",
      "2026-01-03",
      "KRW",
      persistence,
      store,
    );

    expect(out.fxStatus).toBe("complete");
    expect(out.points).toEqual([
      {
        date: "2026-01-03",
        totalCostAmount: 130000,
        marketValueAmount: 143000,
        unrealizedPnlAmount: 13000,
        cumulativeRealizedPnlAmount: 0,
        cumulativeDividendsAmount: 2600,
        totalReturnAmount: 15600,
        totalReturnPercent: 12,
        fxAvailable: true,
      },
    ]);
    expect(out.lastReliableDate).toBe("2026-01-03");
    expect(out.diagnostics?.knownGapReasons).toEqual(["missing_fx"]);
  });

  it("does not publish a partial latest all-market snapshot as the portfolio trend total", async () => {
    const dailyBarReadStats = { batchCalls: 0, batchPairCounts: [] as number[], singleCalls: 0 };
    const persistence = makeFakePersistence({
      dailyBarReadStats,
      fxRates: [
        { base: "USD", quote: "TWD", rate: 31.6, asOf: "2026-06-01" },
        { base: "KRW", quote: "TWD", rate: 0.0207, asOf: "2026-06-01" },
      ],
      dailyBars: [
        makeDailyBar("2330", "2026-06-09", 1000, "TW"),
        makeDailyBar("2330", "2026-06-10", 1010, "TW"),
        makeDailyBar("AVGO", "2026-06-09", 500, "US"),
        makeDailyBar("AVGO", "2026-06-10", 510, "US"),
        makeDailyBar("000660", "2026-06-09", 200000, "KR"),
        makeDailyBar("000660", "2026-06-10", 201000, "KR"),
      ],
      aggregated: [
        {
          date: "2026-06-09",
          totalCostBasis: 19_000_000,
          totalMarketValue: 21_160_204.21,
          totalUnrealizedPnl: 2_160_204.21,
          cumulativeRealizedPnl: 0,
          cumulativeDividends: 0,
          totalReturnAmount: 2_160_204.21,
          totalReturnPercent: 11.3695,
          isProvisional: false,
          fxAvailable: true,
          snapshotContributorKeys: [
            "acct-kr:KR:000660",
            "acct-tw:TW:2330",
            "acct-us:US:AVGO",
          ],
        },
        {
          date: "2026-06-10",
          totalCostBasis: 13_310_288.12,
          totalMarketValue: 14_983_264.80,
          totalUnrealizedPnl: 1_672_976.68,
          cumulativeRealizedPnl: 0,
          cumulativeDividends: 0,
          totalReturnAmount: 1_672_976.68,
          totalReturnPercent: 12.568,
          isProvisional: false,
          fxAvailable: true,
          snapshotContributorKeys: [
            "acct-kr:KR:000660",
            "acct-tw:TW:2330",
          ],
        },
      ],
    });
    const base = makeStore();
    const store = makeStore({
      accounting: {
        ...base.accounting,
        facts: {
          ...base.accounting.facts,
          tradeEvents: [
            makeTrade({
              id: "tw-buy",
              accountId: "acct-tw",
              ticker: "2330",
              marketCode: "TW",
              quantity: 5000,
              unitPrice: 837.44,
              priceCurrency: "TWD",
              tradeDate: "2026-06-01",
            }),
            makeTrade({
              id: "us-buy",
              accountId: "acct-us",
              ticker: "AVGO",
              marketCode: "US",
              quantity: 456,
              unitPrice: 400,
              priceCurrency: "USD",
              tradeDate: "2026-06-01",
            }),
            makeTrade({
              id: "kr-buy",
              accountId: "acct-kr",
              ticker: "000660",
              marketCode: "KR",
              quantity: 80,
              unitPrice: 1_821_831.73,
              priceCurrency: "KRW",
              tradeDate: "2026-06-01",
            }),
          ],
        },
      },
    });

    const out = await translatePerformancePoints(
      "user-1",
      "ALL",
      "2026-06-10",
      "TWD",
      persistence,
      store,
    );

    expect(out.points.map((point) => point.date)).toEqual(["2026-06-09"]);
    expect(out.points[0]?.marketValueAmount).toBe(21_160_204.21);
    expect(out.lastReliableDate).toBe("2026-06-09");
    expect(out.marketDataStaleSince).toBe("2026-06-09");
    expect(out.diagnostics).toMatchObject({
      latestSnapshotDate: "2026-06-09",
      latestReliableValuationDate: "2026-06-09",
      expectedLatestValuationDate: "2026-06-10",
      staleSinceDate: "2026-06-09",
      knownGapReasons: ["missing_snapshot", "stale_snapshot"],
    });
    expect(dailyBarReadStats).toEqual({
      batchCalls: 1,
      batchPairCounts: [3],
      singleCalls: 0,
    });
  });

  it("keeps an all-market snapshot date when the absent market has no bar for that date", async () => {
    const persistence = makeFakePersistence({
      fxRates: [
        { base: "USD", quote: "TWD", rate: 31.6, asOf: "2026-06-01" },
        { base: "KRW", quote: "TWD", rate: 0.0207, asOf: "2026-06-01" },
      ],
      dailyBars: [
        makeDailyBar("2330", "2026-06-10", 1010, "TW"),
        makeDailyBar("000660", "2026-06-10", 201000, "KR"),
      ],
      aggregated: [
        {
          date: "2026-06-10",
          totalCostBasis: 13_310_288.12,
          totalMarketValue: 14_983_264.80,
          totalUnrealizedPnl: 1_672_976.68,
          cumulativeRealizedPnl: 0,
          cumulativeDividends: 0,
          totalReturnAmount: 1_672_976.68,
          totalReturnPercent: 12.568,
          isProvisional: false,
          fxAvailable: true,
          snapshotContributorKeys: [
            "acct-kr:KR:000660",
            "acct-tw:TW:2330",
          ],
        },
      ],
    });
    const base = makeStore();
    const store = makeStore({
      accounting: {
        ...base.accounting,
        facts: {
          ...base.accounting.facts,
          tradeEvents: [
            makeTrade({
              id: "tw-buy",
              accountId: "acct-tw",
              ticker: "2330",
              marketCode: "TW",
              quantity: 5000,
              unitPrice: 837.44,
              priceCurrency: "TWD",
              tradeDate: "2026-06-01",
            }),
            makeTrade({
              id: "us-buy",
              accountId: "acct-us",
              ticker: "AVGO",
              marketCode: "US",
              quantity: 456,
              unitPrice: 400,
              priceCurrency: "USD",
              tradeDate: "2026-06-01",
            }),
            makeTrade({
              id: "kr-buy",
              accountId: "acct-kr",
              ticker: "000660",
              marketCode: "KR",
              quantity: 80,
              unitPrice: 1_821_831.73,
              priceCurrency: "KRW",
              tradeDate: "2026-06-01",
            }),
          ],
        },
      },
    });

    const out = await translatePerformancePoints(
      "user-1",
      "ALL",
      "2026-06-10",
      "TWD",
      persistence,
      store,
    );

    expect(out.points.map((point) => point.date)).toEqual(["2026-06-10"]);
    expect(out.points[0]?.marketValueAmount).toBe(14_983_264.80);
    expect(out.lastReliableDate).toBe("2026-06-10");
    expect(out.diagnostics?.knownGapReasons).toEqual([]);
  });

  it("keeps a snapshot date when a sibling ticker in the same market has no bar for that date", async () => {
    const persistence = makeFakePersistence({
      dailyBars: [
        makeDailyBar("2330", "2026-06-10", 1010, "TW"),
      ],
      aggregated: [
        {
          date: "2026-06-10",
          totalCostBasis: 5_000_000,
          totalMarketValue: 5_050_000,
          totalUnrealizedPnl: 50_000,
          cumulativeRealizedPnl: 0,
          cumulativeDividends: 0,
          totalReturnAmount: 50_000,
          totalReturnPercent: 1,
          isProvisional: false,
          fxAvailable: true,
          snapshotContributorKeys: [
            "acct-tw:TW:2330",
          ],
        },
      ],
    });
    const base = makeStore();
    const store = makeStore({
      accounting: {
        ...base.accounting,
        facts: {
          ...base.accounting.facts,
          tradeEvents: [
            makeTrade({
              id: "tw-2330-buy",
              accountId: "acct-tw",
              ticker: "2330",
              marketCode: "TW",
              quantity: 5000,
              unitPrice: 1000,
              priceCurrency: "TWD",
              tradeDate: "2026-06-01",
            }),
            makeTrade({
              id: "tw-2317-buy",
              accountId: "acct-tw",
              ticker: "2317",
              marketCode: "TW",
              quantity: 1000,
              unitPrice: 200,
              priceCurrency: "TWD",
              tradeDate: "2026-06-01",
            }),
          ],
        },
      },
    });

    const out = await translatePerformancePoints(
      "user-1",
      "ALL",
      "2026-06-10",
      "TWD",
      persistence,
      store,
    );

    expect(out.points.map((point) => point.date)).toEqual(["2026-06-10"]);
    expect(out.points[0]?.marketValueAmount).toBe(5_050_000);
    expect(out.diagnostics?.knownGapReasons).toEqual([]);
  });

  it("Maps fxAvailable=false rows to nullable point fields and rolls up partial", async () => {
    const persistence = makeFakePersistence({
      aggregated: [
        {
          date: "2026-04-28",
          totalCostBasis: 1000,
          totalMarketValue: 1100,
          totalUnrealizedPnl: 100,
          cumulativeRealizedPnl: 0,
          cumulativeDividends: 0,
          totalReturnAmount: 100,
          totalReturnPercent: 10,
          isProvisional: false,
          fxAvailable: true,
        },
        {
          date: "2026-04-29",
          totalCostBasis: 0,
          // Simulates a Postgres partial SUM leak when one contributor is
          // self-pair and another has missing FX. The service must still gate
          // every wire numeric by `fxAvailable`.
          totalMarketValue: 1100,
          totalUnrealizedPnl: 100,
          cumulativeRealizedPnl: 0,
          cumulativeDividends: 0,
          totalReturnAmount: 100,
          totalReturnPercent: 10,
          isProvisional: false,
          fxAvailable: false,
        },
      ],
    });
    const out = await translatePerformancePoints(
      "user-1",
      "1Y",
      "2026-04-29",
      "TWD",
      persistence,
    );
    expect(out.fxStatus).toBe("partial");
    expect(out.points).toHaveLength(2);
    const p2 = out.points[1];
    expect(p2.fxAvailable).toBe(false);
    expect(p2.totalCostAmount).toBe(null);
    expect(p2.marketValueAmount).toBe(null);
    expect(p2.unrealizedPnlAmount).toBe(null);
    expect(p2.cumulativeRealizedPnlAmount).toBe(null);
    expect(p2.cumulativeDividendsAmount).toBe(null);
    expect(p2.totalReturnAmount).toBe(null);
    expect(p2.totalReturnPercent).toBe(null);
    expect(out.diagnostics?.knownGapReasons).toEqual(["stale_snapshot", "missing_fx"]);
  });

  it("Empty aggregated + no store returns empty points list with fxStatus=complete", async () => {
    const persistence = makeFakePersistence({});
    const out = await translatePerformancePoints(
      "user-1",
      "1Y",
      "2026-04-29",
      "TWD",
      persistence,
    );
    expect(out.points).toEqual([]);
    expect(out.fxStatus).toBe("complete");
    expect(out.diagnostics).toEqual({
      latestSnapshotDate: null,
      latestReliableValuationDate: null,
      expectedLatestValuationDate: "2026-04-29",
      staleSinceDate: null,
      knownGapReasons: ["missing_snapshot"],
    });
  });

  it("Empty snapshots + repaired daily bars returns an empty snapshot-only series", async () => {
    const persistence = makeFakePersistence({
      dailyBars: [
        makeDailyBar("2330", "2026-01-02", 100),
        makeDailyBar("2330", "2026-01-05", 120),
      ],
    });
    const store = {
      accounting: {
        facts: {
          tradeEvents: [
            {
              id: "trade-1",
              userId: "user-1",
              accountId: "acct-1",
              ticker: "2330",
              marketCode: "TW",
              instrumentType: "stock",
              type: "BUY",
              quantity: 10,
              unitPrice: 100,
              priceCurrency: "TWD",
              tradeDate: "2026-01-02",
              commissionAmount: 0,
              taxAmount: 0,
              isDayTrade: false,
              feeSnapshot: { id: "fee-1", name: "Default", market: "TW", brokerName: null, rules: [] },
            },
          ],
        },
      },
    };

    const out = await translatePerformancePoints(
      "user-1",
      "ALL",
      "2026-01-05",
      "TWD",
      persistence,
      store as unknown as Store,
    );

    expect(out.fxStatus).toBe("complete");
    expect(out.points).toEqual([]);
    expect(out.lastReliableDate).toBe(null);
    expect(out.marketDataStaleSince).toBe(null);
    expect(out.diagnostics?.knownGapReasons).toEqual(["missing_snapshot"]);
  });

  it("does not derive synthetic Book Cost or realized return when snapshots are absent", async () => {
    const persistence = makeFakePersistence({
      fxRates: [
        { base: "USD", quote: "AUD", rate: 1.5, asOf: "2026-01-01" },
        { base: "USD", quote: "AUD", rate: 1.6, asOf: "2026-01-02" },
      ],
      dailyBars: [
        makeDailyBar("AAPL", "2026-01-01", 10),
        makeDailyBar("AAPL", "2026-01-02", 20),
      ],
    });
    const store = makeStore({
      accounting: {
        ...makeStore().accounting,
        facts: {
          ...makeStore().accounting.facts,
          tradeEvents: [
            makeTrade({
              id: "trade-buy",
              ticker: "AAPL",
              marketCode: "US",
              type: "BUY",
              quantity: 10,
              unitPrice: 10,
              priceCurrency: "USD",
              tradeDate: "2026-01-01",
            }),
            makeTrade({
              id: "trade-sell",
              ticker: "AAPL",
              marketCode: "US",
              type: "SELL",
              quantity: 4,
              unitPrice: 20,
              priceCurrency: "USD",
              tradeDate: "2026-01-02",
              bookingSequence: 2,
            }),
          ],
        },
      },
    });

    const out = await translatePerformancePoints(
      "user-1",
      "ALL",
      "2026-01-02",
      "AUD",
      persistence,
      store,
    );

    expect(out.fxStatus).toBe("complete");
    expect(out.points).toEqual([]);
    expect(out.lastReliableDate).toBe(null);
  });

  it("does not synthesize same-ticker cross-market performance when snapshots are absent", async () => {
    const persistence = makeFakePersistence({
      dailyBars: [
        makeDailyBar("BHP", "2026-01-01", 40, "AU"),
        makeDailyBar("BHP", "2026-01-01", 100, "US"),
      ],
    });
    const baseStore = makeStore();
    const store = makeStore({
      accounting: {
        ...baseStore.accounting,
        facts: {
          ...baseStore.accounting.facts,
          tradeEvents: [
            makeTrade({
              id: "trade-buy-au",
              ticker: "BHP",
              marketCode: "AU",
              type: "BUY",
              quantity: 1,
              unitPrice: 40,
              priceCurrency: "AUD",
              tradeDate: "2026-01-01",
            }),
          ],
        },
      },
    });

    const out = await translatePerformancePoints(
      "user-1",
      "ALL",
      "2026-01-01",
      "AUD",
      persistence,
      store,
    );

    expect(out.fxStatus).toBe("complete");
    expect(out.points).toEqual([]);
  });

  it("uses canonical lot allocations and realized amounts for dated FX replay", async () => {
    const persistence = makeFakePersistence({
      fxRates: [
        { base: "USD", quote: "AUD", rate: 1.5, asOf: "2026-01-01" },
        { base: "USD", quote: "AUD", rate: 1.6, asOf: "2026-01-02" },
        { base: "USD", quote: "AUD", rate: 1.7, asOf: "2026-01-03" },
      ],
      aggregated: [
        {
          date: "2026-01-03",
          totalCostBasis: 0,
          totalMarketValue: 425,
          totalUnrealizedPnl: null,
          cumulativeRealizedPnl: 0,
          cumulativeDividends: 0,
          totalReturnAmount: null,
          totalReturnPercent: null,
          isProvisional: false,
          fxAvailable: true,
        },
      ],
      dailyBars: [
        makeDailyBar("AAPL", "2026-01-01", 100),
        makeDailyBar("AAPL", "2026-01-02", 200),
        makeDailyBar("AAPL", "2026-01-03", 250),
      ],
    });
    const baseStore = makeStore();
    const sellTrade = makeTrade({
      id: "trade-sell",
      ticker: "AAPL",
      marketCode: "US",
      type: "SELL",
      quantity: 1,
      unitPrice: 150,
      priceCurrency: "USD",
      tradeDate: "2026-01-03",
      bookingSequence: 3,
      realizedPnlAmount: 50,
      realizedPnlCurrency: "USD",
    });
    const store = makeStore({
      accounting: {
        ...baseStore.accounting,
        facts: {
          ...baseStore.accounting.facts,
          tradeEvents: [
            makeTrade({
              id: "trade-buy-1",
              ticker: "AAPL",
              marketCode: "US",
              type: "BUY",
              quantity: 1,
              unitPrice: 100,
              priceCurrency: "USD",
              tradeDate: "2026-01-01",
              bookingSequence: 1,
            }),
            makeTrade({
              id: "trade-buy-2",
              ticker: "AAPL",
              marketCode: "US",
              type: "BUY",
              quantity: 1,
              unitPrice: 200,
              priceCurrency: "USD",
              tradeDate: "2026-01-02",
              bookingSequence: 2,
            }),
            sellTrade,
          ],
        },
        projections: {
          ...baseStore.accounting.projections,
          lotAllocations: [
            {
              id: "trade-sell:lot-trade-buy-1",
              userId: "user-1",
              accountId: "acct-1",
              tradeEventId: "trade-sell",
              ticker: "AAPL",
              lotId: "lot-trade-buy-1",
              lotOpenedAt: "2026-01-01",
              lotOpenedSequence: 1,
              allocatedQuantity: 1,
              allocatedCostAmount: 100,
              costCurrency: "USD",
              createdAt: "2026-01-03T00:00:00.000Z",
            },
          ],
        },
      },
    });

    const out = await translatePerformancePoints(
      "user-1",
      "ALL",
      "2026-01-03",
      "AUD",
      persistence,
      store,
    );

    const finalPoint = out.points.at(-1);
    expect(finalPoint).toMatchObject({
      date: "2026-01-03",
      totalCostAmount: 320,
      marketValueAmount: 425,
      cumulativeRealizedPnlAmount: 85,
      totalReturnAmount: 190,
    });
    expect(finalPoint?.totalReturnPercent).toBeCloseTo((190 / 320) * 100);
  });

  it("falls back to snapshot-backed point data when lot allocation FX is missing", async () => {
    const persistence = makeFakePersistence({
      aggregated: [
        {
          date: "2026-01-03",
          totalCostBasis: 0,
          totalMarketValue: 150,
          totalUnrealizedPnl: null,
          cumulativeRealizedPnl: 0,
          cumulativeDividends: 0,
          totalReturnAmount: null,
          totalReturnPercent: null,
          isProvisional: false,
          fxAvailable: true,
        },
      ],
      dailyBars: [
        makeDailyBar("AAPL", "2026-01-01", 100),
        makeDailyBar("AAPL", "2026-01-03", 150),
      ],
    });
    const baseStore = makeStore();
    const store = makeStore({
      accounting: {
        ...baseStore.accounting,
        facts: {
          ...baseStore.accounting.facts,
          tradeEvents: [
            makeTrade({
              id: "trade-buy-aud",
              ticker: "AAPL",
              marketCode: "AU",
              type: "BUY",
              quantity: 2,
              unitPrice: 100,
              priceCurrency: "AUD",
              tradeDate: "2026-01-01",
              bookingSequence: 1,
            }),
            makeTrade({
              id: "trade-sell-aud",
              ticker: "AAPL",
              marketCode: "AU",
              type: "SELL",
              quantity: 1,
              unitPrice: 150,
              priceCurrency: "AUD",
              tradeDate: "2026-01-03",
              bookingSequence: 2,
            }),
          ],
        },
        projections: {
          ...baseStore.accounting.projections,
          lotAllocations: [
            {
              id: "trade-sell-aud:lot-usd-missing-fx",
              userId: "user-1",
              accountId: "acct-1",
              tradeEventId: "trade-sell-aud",
              ticker: "AAPL",
              lotId: "lot-usd-missing-fx",
              lotOpenedAt: "2026-01-01",
              lotOpenedSequence: 1,
              allocatedQuantity: 1,
              allocatedCostAmount: 100,
              costCurrency: "USD",
              createdAt: "2026-01-03T00:00:00.000Z",
            },
          ],
        },
      },
    });

    const out = await translatePerformancePoints(
      "user-1",
      "ALL",
      "2026-01-03",
      "AUD",
      persistence,
      store,
    );

    const finalPoint = out.points.at(-1);
    expect(out.fxStatus).toBe("complete");
    expect(finalPoint).toMatchObject({
      date: "2026-01-03",
      totalCostAmount: 0,
      marketValueAmount: 150,
      fxAvailable: true,
      cumulativeRealizedPnlAmount: 0,
      totalReturnAmount: null,
    });
    expect(out.diagnostics?.knownGapReasons).toEqual(["missing_fx"]);
  });
});
