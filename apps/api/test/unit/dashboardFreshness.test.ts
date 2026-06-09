import { describe, expect, it } from "vitest";
import { createStore, setStoreInstruments } from "../../src/services/store.js";
import { enrichHoldingsWithFreshness } from "../../src/services/dashboardFreshness.js";
import type { DashboardOverviewHoldingDto } from "@vakwen/shared-types";

function holding(overrides: Partial<DashboardOverviewHoldingDto>): DashboardOverviewHoldingDto {
  return {
    accountId: "acc-kr",
    ticker: "005930",
    marketCode: "KR",
    quantity: 1,
    costBasisAmount: 100,
    currency: "KRW",
    averageCostPerShare: 100,
    currentUnitPrice: 100,
    marketValueAmount: 100,
    unrealizedPnlAmount: 0,
    allocationPct: 100,
    change: null,
    changePercent: null,
    previousClose: null,
    quoteStatus: "current",
    nextDividendDate: null,
    lastDividendPostedDate: null,
    freshness: "current",
    freshnessTooltip: null,
    ...overrides,
  };
}

describe("enrichHoldingsWithFreshness", () => {
  it("classifies KR holdings using KR latest-bar dates", async () => {
    const store = createStore();
    store.accounts.push({
      id: "acc-kr",
      name: "KR",
      userId: "user-1",
      feeProfileId: store.feeProfiles[0]!.id,
      defaultCurrency: "KRW",
      accountType: "broker",
    });
    setStoreInstruments(store, [
      ...store.instruments,
      {
        ticker: "005930",
        type: "STOCK",
        marketCode: "KR",
        isProvisional: false,
        lastSyncedAt: null,
      },
    ]);
    const holdings = [holding({})];

    await enrichHoldingsWithFreshness(holdings, store, {
      persistence: {
        getLatestBarDatesByTickerMarket: async () => new Map([["005930:KR", "2026-05-27"]]),
      },
      tradingCalendar: {
        latestSettledTradingDay: async (market) => {
          expect(market).toBe("KR");
          return "2026-05-29";
        },
        tradingDaysBetween: async (_from, _to, market) => {
          expect(market).toBe("KR");
          return 2;
        },
      },
    });

    expect(holdings[0]!.freshness).toBe("stale_red");
    expect(holdings[0]!.freshnessTooltip).toBe("Price data is 2 trading days old.");
  });

  it("classifies cross-market holdings with the resolved holding market instead of account currency", async () => {
    const store = createStore();
    store.accounts.push({
      id: "acc-tw",
      name: "TW account",
      userId: "user-1",
      feeProfileId: store.feeProfiles[0]!.id,
      defaultCurrency: "TWD",
      accountType: "broker",
    });
    setStoreInstruments(store, [
      ...store.instruments,
      {
        ticker: "AAPL",
        type: "STOCK",
        marketCode: "US",
        isProvisional: false,
        lastSyncedAt: null,
      },
    ]);
    const holdings = [holding({
      accountId: "acc-tw",
      ticker: "AAPL",
      marketCode: "US",
      currency: "USD",
    })];

    await enrichHoldingsWithFreshness(holdings, store, {
      persistence: {
        getLatestBarDatesByTickerMarket: async (pairs) => {
          expect(pairs).toEqual([{ ticker: "AAPL", marketCode: "US" }]);
          return new Map([["AAPL:US", "2026-06-08"]]);
        },
      },
      tradingCalendar: {
        latestSettledTradingDay: async (market) => {
          expect(market).toBe("US");
          return "2026-06-09";
        },
        tradingDaysBetween: async (_from, _to, market) => {
          expect(market).toBe("US");
          return 1;
        },
      },
    });

    expect(holdings[0]!.freshness).toBe("stale_amber");
    expect(holdings[0]!.freshnessTooltip).toBe("Price data is 1 trading day old.");
  });
});
