import { describe, expect, it } from "vitest";
import { createEmptyTickerFundamentals } from "../../src/services/fundamentals/types.js";
import { createDefaultFeeProfile, createStore, setStoreInstruments } from "../../src/services/store.js";
import { buildTickerDetails } from "../../src/services/tickerDetails.js";

describe("buildTickerDetails", () => {
  function createPersistence(
    bars: Array<{
      ticker: string;
      marketCode: "TW" | "US" | "AU" | "KR";
      barDate: string;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
      source: string;
    }> = [],
  ) {
    return {
      async getDailyBarsForTickerMarket(ticker: string, marketCode: string, startDate: string, endDate: string) {
        return bars
          .filter((bar) => (
            bar.ticker === ticker
            && bar.marketCode === marketCode
            && bar.barDate >= startDate
            && bar.barDate <= endDate
          ))
          .map((bar) => ({
            ...bar,
            ingestedAt: "2026-06-01T00:00:00.000Z",
          }));
      },
      async getLatestBarDatesByTickerMarket() {
        return new Map(
          bars.map((bar) => [`${bar.ticker}:${bar.marketCode}`, bar.barDate] as const),
        );
      },
      async getInstrument(ticker: string, marketCode?: string) {
        return ticker && marketCode
          ? {
              ticker,
              name: `${ticker} ${marketCode}`,
              instrumentType: "STOCK" as const,
              marketCode,
              isProvisional: false,
              barsBackfillStatus: "ready" as const,
              verificationStatus: "verified" as const,
              createdAt: "2026-06-01T00:00:00.000Z",
              updatedAt: "2026-06-01T00:00:00.000Z",
            }
          : null;
      },
    };
  }

  function buildCrossMarketStore() {
    const store = createStore();
    const usdFeeProfile = createDefaultFeeProfile("acc-us", "USD", "fp-us");
    const audFeeProfile = createDefaultFeeProfile("acc-au", "AUD", "fp-au");

    store.accounts.push(
      {
        id: "acc-us",
        userId: "user-1",
        name: "US Broker",
        feeProfileId: usdFeeProfile.id,
        defaultCurrency: "USD",
        accountType: "broker",
      },
      {
        id: "acc-au",
        userId: "user-1",
        name: "AU Broker",
        feeProfileId: audFeeProfile.id,
        defaultCurrency: "AUD",
        accountType: "broker",
      },
    );
    store.feeProfiles.push(usdFeeProfile, audFeeProfile);
    setStoreInstruments(store, [
      ...store.instruments,
      { ticker: "BHP", type: "STOCK", marketCode: "US", isProvisional: false },
      { ticker: "BHP", type: "STOCK", marketCode: "AU", isProvisional: false },
    ]);
    store.accounting.projections.holdings.push(
      {
        accountId: "acc-us",
        ticker: "BHP",
        quantity: 4,
        costBasisAmount: 200,
        currency: "USD",
      },
      {
        accountId: "acc-au",
        ticker: "BHP",
        quantity: 3,
        costBasisAmount: 120,
        currency: "AUD",
      },
    );
    store.accounting.facts.tradeEvents.push(
      {
        id: "bhp-us-buy",
        userId: "user-1",
        accountId: "acc-us",
        ticker: "BHP",
        marketCode: "US",
        instrumentType: "STOCK",
        type: "BUY",
        quantity: 4,
        unitPrice: 50,
        priceCurrency: "USD",
        tradeDate: "2026-02-01",
        commissionAmount: 0,
        taxAmount: 0,
        isDayTrade: false,
        feeSnapshot: usdFeeProfile,
      },
      {
        id: "bhp-au-buy",
        userId: "user-1",
        accountId: "acc-au",
        ticker: "BHP",
        marketCode: "AU",
        instrumentType: "STOCK",
        type: "BUY",
        quantity: 3,
        unitPrice: 40,
        priceCurrency: "AUD",
        tradeDate: "2026-02-02",
        commissionAmount: 0,
        taxAmount: 0,
        isDayTrade: false,
        feeSnapshot: audFeeProfile,
      },
    );

    return store;
  }

  it("requires an explicit market for same ticker across multiple held markets", async () => {
    await expect(buildTickerDetails({
      persistence: createPersistence(),
      store: buildCrossMarketStore(),
      userId: "user-1",
      ticker: "BHP",
      fundamentalsRecord: null,
    })).rejects.toMatchObject({
      code: "ticker_market_required",
      statusCode: 400,
    });
  });

  it("uses the requested marketCode for same ticker across multiple markets", async () => {
    const { details, marketCode } = await buildTickerDetails({
      persistence: createPersistence(),
      store: buildCrossMarketStore(),
      userId: "user-1",
      ticker: "BHP",
      marketCode: "AU",
      fundamentalsRecord: {
        ticker: "BHP",
        marketCode: "AU",
        providerId: "test-provider",
        fundamentals: createEmptyTickerFundamentals(),
        refreshedAt: "2026-06-01T00:00:00.000Z",
        nextRefreshAt: "2026-06-15T00:00:00.000Z",
        lastAttemptedAt: null,
        lastError: null,
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
      },
    });

    expect(marketCode).toBe("AU");
    expect(details.identity).toEqual(expect.objectContaining({
      ticker: "BHP",
      marketCode: "AU",
      priceCurrency: "AUD",
    }));
    expect(details.position).toEqual(expect.objectContaining({
      quantity: 3,
      costBasisAmount: 120,
      currency: "AUD",
      accountIds: ["acc-au"],
    }));
    expect(details.transactions).toEqual([
      expect.objectContaining({
        accountId: "acc-au",
        marketCode: "AU",
        priceCurrency: "AUD",
      }),
    ]);
    expect(details.holdingGroup).toEqual(expect.objectContaining({
      instrumentName: "BHP AU",
    }));
    expect(details.accountBreakdown[0]).toEqual(expect.objectContaining({
      instrumentName: "BHP AU",
    }));
  });

  it("uses requested chart ranges while keeping the quote pinned to the latest local bar", async () => {
    const bars = [
      {
        ticker: "BHP",
        marketCode: "AU" as const,
        barDate: "2025-01-15",
        open: 30,
        high: 31,
        low: 29,
        close: 30,
        volume: 100,
        source: "test-bars",
      },
      {
        ticker: "BHP",
        marketCode: "AU" as const,
        barDate: "2025-07-15",
        open: 35,
        high: 36,
        low: 34,
        close: 35,
        volume: 100,
        source: "test-bars",
      },
      {
        ticker: "BHP",
        marketCode: "AU" as const,
        barDate: "2026-06-01",
        open: 42,
        high: 43,
        low: 41,
        close: 42,
        volume: 100,
        source: "test-bars",
      },
      {
        ticker: "BHP",
        marketCode: "AU" as const,
        barDate: "2026-06-10",
        open: 45,
        high: 46,
        low: 44,
        close: 45,
        volume: 100,
        source: "test-bars",
      },
    ];

    const { details } = await buildTickerDetails({
      persistence: createPersistence(bars),
      store: buildCrossMarketStore(),
      userId: "user-1",
      ticker: "BHP",
      marketCode: "AU",
      range: "1M",
      fundamentalsRecord: null,
    });

    expect(details.quote).toEqual(expect.objectContaining({
      currentUnitPrice: 45,
      previousClose: 42,
    }));
    expect(details.chart).toEqual(expect.objectContaining({
      range: "1M",
      metadata: {
        requested: { range: "1M", startDate: null, endDate: null },
        resolved: { range: "1M", startDate: "2026-05-10", endDate: "2026-06-10" },
        available: { startDate: "2025-01-15", endDate: "2026-06-10" },
        truncated: { startDate: false, endDate: false },
      },
    }));
    expect(details.chart.points.map((point) => point.date)).toEqual(["2026-06-01", "2026-06-10"]);
  });

  it("returns all locally stored bars for ALL and marks custom-range truncation against local history", async () => {
    const bars = [
      {
        ticker: "BHP",
        marketCode: "AU" as const,
        barDate: "2025-01-15",
        open: 30,
        high: 31,
        low: 29,
        close: 30,
        volume: 100,
        source: "test-bars",
      },
      {
        ticker: "BHP",
        marketCode: "AU" as const,
        barDate: "2026-06-10",
        open: 45,
        high: 46,
        low: 44,
        close: 45,
        volume: 100,
        source: "test-bars",
      },
    ];

    const { details: allDetails } = await buildTickerDetails({
      persistence: createPersistence(bars),
      store: buildCrossMarketStore(),
      userId: "user-1",
      ticker: "BHP",
      marketCode: "AU",
      range: "ALL",
      fundamentalsRecord: null,
    });

    expect(allDetails.chart.metadata).toEqual({
      requested: { range: "ALL", startDate: null, endDate: null },
      resolved: { range: "ALL", startDate: "2025-01-15", endDate: "2026-06-10" },
      available: { startDate: "2025-01-15", endDate: "2026-06-10" },
      truncated: { startDate: false, endDate: false },
    });
    expect(allDetails.chart.points).toHaveLength(2);

    const { details: customDetails } = await buildTickerDetails({
      persistence: createPersistence(bars),
      store: buildCrossMarketStore(),
      userId: "user-1",
      ticker: "BHP",
      marketCode: "AU",
      startDate: "2024-01-01",
      endDate: "2026-12-31",
      fundamentalsRecord: null,
    });

    expect(customDetails.chart.range).toBe("CUSTOM");
    expect(customDetails.chart.metadata.truncated).toEqual({
      startDate: true,
      endDate: true,
    });
  });

  it("rejects custom chart ranges longer than 10 years", async () => {
    await expect(buildTickerDetails({
      persistence: createPersistence(),
      store: buildCrossMarketStore(),
      userId: "user-1",
      ticker: "BHP",
      marketCode: "AU",
      startDate: "2010-01-01",
      endDate: "2021-01-02",
      fundamentalsRecord: null,
    })).rejects.toMatchObject({
      code: "ticker_chart_custom_range_too_large",
      statusCode: 400,
    });
  });
});
