// KZO-180 — Pure-helper tests for the FX-aware dashboard aggregator.
//
// `translateOverviewSummary` is exercised here with mocked `getFxRate`. The
// `translatePerformancePoints` time-series path is partially covered here for
// the snapshot-backed branch; the synthetic-fallback branch + persistence
// behavior are covered in the integration suite (slice 7).

import { describe, it, expect } from "vitest";
import {
  translateOverviewSummary,
  translatePerformancePoints,
} from "../../src/services/dashboardReportingCurrency.js";
import type {
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

function makeDailyBar(ticker: string, barDate: string, close: number): DailyBar {
  return {
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
}

const baseHolding: DashboardOverviewHoldingDto = {
  accountId: "acct-1",
  ticker: "2330",
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
  });

  it("Empty snapshots + repaired daily bars builds historical market-value points", async () => {
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
    expect(out.points).toHaveLength(2);
    expect(out.points.map((point) => point.date)).toEqual(["2026-01-02", "2026-01-05"]);
    expect(out.points.map((point) => point.marketValueAmount)).toEqual([1000, 1200]);
    expect(out.points.every((point) => point.marketValueAmount !== null)).toBe(true);
  });

  it("derives synthetic Book Cost and realized return from weighted-average transaction-date FX", async () => {
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
    expect(out.points.map((point) => point.date)).toEqual(["2026-01-01", "2026-01-02"]);
    expect(out.points[0]).toMatchObject({
      totalCostAmount: 150,
      marketValueAmount: 150,
      cumulativeRealizedPnlAmount: 0,
      totalReturnAmount: 0,
    });
    expect(out.points[1]).toMatchObject({
      totalCostAmount: 90,
      marketValueAmount: 192,
      cumulativeRealizedPnlAmount: 68,
      totalReturnAmount: 170,
    });
    expect(out.points[1]?.totalReturnPercent).toBeCloseTo((170 / 90) * 100);
  });
});
