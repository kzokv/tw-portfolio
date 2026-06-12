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
    calls: {
      historicalReads?: Array<{ ticker: string; marketCode: string; startDate: string; endDate: string }>;
      latestReads?: Array<{ pairs: ReadonlyArray<{ ticker: string; marketCode: "TW" | "US" | "AU" | "KR" }>; limit: number }>;
    } = {},
  ) {
    return {
      async getDailyBarsForTickerMarket(ticker: string, marketCode: string, startDate: string, endDate: string) {
        calls.historicalReads?.push({ ticker, marketCode, startDate, endDate });
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
      async getLatestBarsByTickerMarket(
        pairs: ReadonlyArray<{ ticker: string; marketCode: "TW" | "US" | "AU" | "KR" }>,
        limit: number,
      ) {
        calls.latestReads?.push({ pairs, limit });
        const pairKeys = new Set(pairs.map((pair) => `${pair.ticker}:${pair.marketCode}`));
        const grouped = new Map<string, typeof bars>();
        for (const bar of bars) {
          const key = `${bar.ticker}:${bar.marketCode}`;
          if (!pairKeys.has(key)) continue;
          const group = grouped.get(key) ?? [];
          group.push(bar);
          grouped.set(key, group);
        }
        return [...grouped.values()]
          .flatMap((group) => group
            .sort((left, right) => right.barDate.localeCompare(left.barDate))
            .slice(0, limit))
          .map((bar) => ({
            ...bar,
            ingestedAt: "2026-06-01T00:00:00.000Z",
          }));
      },
      async getLatestBarDatesByTickerMarket() {
        const result = new Map<string, string>();
        for (const bar of bars) {
          const key = `${bar.ticker}:${bar.marketCode}`;
          const current = result.get(key);
          if (!current || bar.barDate > current) {
            result.set(key, bar.barDate);
          }
        }
        return result;
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
      async getFxRate() {
        return null;
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
    const store = buildCrossMarketStore();
    store.marketData.dividendEvents.push(
      {
        id: "bhp-us-dividend",
        ticker: "BHP",
        marketCode: "US",
        eventType: "CASH",
        exDividendDate: "2026-04-01",
        paymentDate: null,
        cashDividendPerShare: 1,
        cashDividendCurrency: "USD",
        stockDividendPerShare: 0,
        source: "test",
      },
      {
        id: "bhp-au-dividend",
        ticker: "BHP",
        marketCode: "AU",
        eventType: "CASH",
        exDividendDate: "2026-04-01",
        paymentDate: null,
        cashDividendPerShare: 2,
        cashDividendCurrency: "USD",
        stockDividendPerShare: 0,
        source: "test",
      },
      {
        id: "bhp-us-upcoming-dividend",
        ticker: "BHP",
        marketCode: "US",
        eventType: "CASH",
        exDividendDate: "2026-05-01",
        paymentDate: null,
        cashDividendPerShare: 1.5,
        cashDividendCurrency: "USD",
        stockDividendPerShare: 0,
        source: "test",
      },
      {
        id: "bhp-au-upcoming-dividend",
        ticker: "BHP",
        marketCode: "AU",
        eventType: "CASH",
        exDividendDate: "2026-05-01",
        paymentDate: null,
        cashDividendPerShare: 2.5,
        cashDividendCurrency: "USD",
        stockDividendPerShare: 0,
        source: "test",
      },
    );
    store.accounting.facts.dividendLedgerEntries.push(
      {
        id: "bhp-us-posted-dividend",
        accountId: "acc-au",
        dividendEventId: "bhp-us-dividend",
        eligibleQuantity: 3,
        expectedCashAmount: 3,
        expectedStockQuantity: 0,
        receivedCashAmount: 3,
        receivedStockQuantity: 0,
        postingStatus: "posted",
        reconciliationStatus: "matched",
        version: 1,
        sourceCompositionStatus: "provided",
        bookedAt: "2026-04-10T00:00:00.000Z",
      },
      {
        id: "bhp-au-posted-dividend",
        accountId: "acc-au",
        dividendEventId: "bhp-au-dividend",
        eligibleQuantity: 3,
        expectedCashAmount: 6,
        expectedStockQuantity: 0,
        receivedCashAmount: 6,
        receivedStockQuantity: 0,
        postingStatus: "posted",
        reconciliationStatus: "matched",
        version: 1,
        sourceCompositionStatus: "provided",
        bookedAt: "2026-04-11T00:00:00.000Z",
      },
    );

    const { details, marketCode } = await buildTickerDetails({
      persistence: createPersistence(),
      store,
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
    expect(details.dividends.upcoming).toEqual([
      expect.objectContaining({
        accountId: "acc-au",
        currency: "USD",
        expectedAmount: 7.5,
      }),
    ]);
    expect(details.dividends.recent).toEqual([
      expect.objectContaining({
        accountId: "acc-au",
        currency: "USD",
        grossAmount: 6,
      }),
    ]);
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

  it("uses the bounded latest-bar reader when chart data is not requested", async () => {
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
    const calls = {
      historicalReads: [] as Array<{ ticker: string; marketCode: string; startDate: string; endDate: string }>,
      latestReads: [] as Array<{ pairs: ReadonlyArray<{ ticker: string; marketCode: "TW" | "US" | "AU" | "KR" }>; limit: number }>,
    };

    const { details } = await buildTickerDetails({
      persistence: createPersistence(bars, calls),
      store: buildCrossMarketStore(),
      userId: "user-1",
      ticker: "BHP",
      marketCode: "AU",
      loadChart: false,
      fundamentalsRecord: null,
    });

    expect(calls.historicalReads).toEqual([]);
    expect(calls.latestReads).toEqual([
      { pairs: [{ ticker: "BHP", marketCode: "AU" }], limit: 2 },
    ]);
    expect(details.quote).toEqual(expect.objectContaining({
      currentUnitPrice: 45,
      previousClose: 42,
    }));
    expect(details.chart.points).toEqual([]);
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

  it("keeps reporting ticker values unavailable when the requested reporting FX is missing", async () => {
    const persistence = {
      ...createPersistence([
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
      ]),
      async getFxRate() {
        return null;
      },
    };

    const { details } = await buildTickerDetails({
      persistence,
      store: buildCrossMarketStore(),
      userId: "user-1",
      ticker: "BHP",
      marketCode: "AU",
      reportingCurrency: "TWD",
      loadChart: false,
      fundamentalsRecord: null,
    });

    expect(details.position).toEqual(expect.objectContaining({
      marketValueAmount: 135,
      unrealizedPnlAmount: 15,
      currency: "AUD",
    }));
    expect(details.holdingGroup).toEqual(expect.objectContaining({
      reportingCurrency: "TWD",
      reportingCostBasisAmount: null,
      reportingMarketValueAmount: null,
      reportingUnrealizedPnlAmount: null,
      reportingDailyChangeAmount: null,
      fxStatus: "missing",
    }));
    expect(details.accountBreakdown[0]).toEqual(expect.objectContaining({
      reportingCurrency: "TWD",
      reportingCostBasisAmount: null,
      reportingMarketValueAmount: null,
      reportingUnrealizedPnlAmount: null,
      reportingDailyChangeAmount: null,
      fxStatus: "missing",
    }));
  });

  it("keeps missing-quote allocation reason when reporting FX is also missing", async () => {
    const persistence = {
      ...createPersistence(),
      async getFxRate() {
        return null;
      },
    };

    const { details } = await buildTickerDetails({
      persistence,
      store: buildCrossMarketStore(),
      userId: "user-1",
      ticker: "BHP",
      marketCode: "AU",
      reportingCurrency: "TWD",
      loadChart: false,
      fundamentalsRecord: null,
    });

    expect(details.holdingGroup).toEqual(expect.objectContaining({
      reportingCurrency: "TWD",
      reportingCostBasisAmount: null,
      reportingMarketValueAmount: null,
      fxStatus: "missing",
      allocationBasisUsed: "cost_basis",
      allocationBasisFallbackReason: "missing_quote",
    }));
    expect(details.accountBreakdown[0]).toEqual(expect.objectContaining({
      reportingCurrency: "TWD",
      reportingCostBasisAmount: null,
      reportingMarketValueAmount: null,
      fxStatus: "missing",
      allocationBasisUsed: "cost_basis",
      allocationBasisFallbackReason: "missing_quote",
    }));
  });
});
