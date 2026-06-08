import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signSessionCookie } from "../../src/auth/googleOAuth.js";
import { buildApp } from "../../src/app.js";
import { buildPortfolioReport } from "../../src/services/reports.js";
let app: Awaited<ReturnType<typeof buildApp>>;
let cookieHeader: string;
let userId: string;

const testOAuthConfig = {
  clientId: "test-client",
  clientSecret: "test-secret",
  redirectUri: "http://localhost:4000/auth/google/callback",
  sessionSecret: "test-session-secret-that-is-long-enough-32chars!!",
};

function relativeIsoDate(daysFromToday: number): string {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + daysFromToday);
  return date.toISOString().slice(0, 10);
}

describe("report routes", () => {
  beforeEach(async () => {
    app = await buildApp({ persistenceBackend: "memory", oauthConfig: testOAuthConfig });
    const authUser = await app.persistence.resolveOrCreateUser("google", "reports-test-user", {
      email: "reports-test-user@example.com",
      name: "Reports Test User",
    });
    userId = authUser.userId;
    const user = await app.persistence.getAuthUserById(userId);
    if (!user) throw new Error("expected seeded auth user");
    cookieHeader = `g_auth_session=${signSessionCookie(userId, testOAuthConfig.sessionSecret, user.sessionVersion)}`;
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it("serves daily review, portfolio, and market reports with bounded holdings detail", async () => {
    const store = await app.persistence.loadStore(userId);
    const feeProfile = store.feeProfiles[0];
    if (!feeProfile) throw new Error("expected default fee profile");
    store.accounting.projections.holdings.push({
      accountId: "acc-1",
      ticker: "2330",
      quantity: 10,
      costBasisAmount: 1000,
      currency: "TWD",
    });
    store.accounting.facts.tradeEvents.push({
      id: "report-trade-1",
      userId,
      accountId: "acc-1",
      ticker: "2330",
      marketCode: "TW",
      instrumentType: "STOCK",
      type: "BUY",
      quantity: 10,
      unitPrice: 100,
      priceCurrency: "TWD",
      tradeDate: "2026-06-01",
      commissionAmount: 0,
      taxAmount: 0,
      isDayTrade: false,
      feeSnapshot: feeProfile,
      tradeTimestamp: "2026-06-01T09:00:00.000Z",
      bookingSequence: 1,
      bookedAt: "2026-06-01T09:00:00.000Z",
    });
    await app.persistence.saveStore(store);

    const memoryPersistence = app.persistence as typeof app.persistence & {
      _seedDailyBars?: (bars: Array<{
        ticker: string;
        marketCode: "TW" | "US" | "AU";
        barDate: string;
        open: number;
        high: number;
        low: number;
        close: number;
        volume: number;
        source: string;
        ingestedAt: string;
      }>) => void;
    };
    memoryPersistence._seedDailyBars?.([
      {
        ticker: "2330",
        marketCode: "TW",
        barDate: "2026-06-02",
        open: 100,
        high: 104,
        low: 99,
        close: 103,
        volume: 10_000,
        source: "test",
        ingestedAt: "2026-06-02T10:00:00.000Z",
      },
      {
        ticker: "2330",
        marketCode: "TW",
        barDate: "2026-06-03",
        open: 103,
        high: 106,
        low: 102,
        close: 105,
        volume: 12_000,
        source: "test",
        ingestedAt: "2026-06-03T10:00:00.000Z",
      },
    ]);

    const dailyReview = await app.inject({
      method: "GET",
      url: "/reports/daily-review?scope=TW&limit=1",
      headers: { cookie: cookieHeader },
    });
    expect(dailyReview.statusCode).toBe(200);
    expect(dailyReview.json()).toEqual(expect.objectContaining({
      query: expect.objectContaining({
        scope: "TW",
        reportingCurrency: "TWD",
      }),
      fxRates: [],
      summary: expect.objectContaining({
        costBasisAmount: expect.any(Number),
      }),
      holdings: expect.objectContaining({
        total: 1,
        limit: 1,
        rows: [
          expect.objectContaining({
            ticker: "2330",
            marketCode: "TW",
          }),
        ],
      }),
    }));

    const portfolioReport = await app.inject({
      method: "GET",
      url: "/reports/portfolio?scope=all&range=1Y",
      headers: { cookie: cookieHeader },
    });
    expect(portfolioReport.statusCode).toBe(200);
    expect(portfolioReport.json()).toEqual(expect.objectContaining({
      query: expect.objectContaining({
        scope: "all",
        range: "1Y",
      }),
      fxRates: [],
      allocation: expect.objectContaining({
        byMarket: expect.arrayContaining([
          expect.objectContaining({ key: "TW" }),
        ]),
      }),
      concentration: expect.objectContaining({
        topHoldings: expect.arrayContaining([
          expect.objectContaining({ ticker: "2330" }),
        ]),
      }),
    }));

    const marketReport = await app.inject({
      method: "GET",
      url: "/reports/market?scope=TW&limit=1",
      headers: { cookie: cookieHeader },
    });
    expect(marketReport.statusCode).toBe(200);
    expect(marketReport.json()).toEqual(expect.objectContaining({
      query: expect.objectContaining({
        scope: "TW",
        reportingCurrency: "TWD",
      }),
      fxRates: [],
      detail: expect.objectContaining({
        limit: 1,
        rows: [
          expect.objectContaining({
            ticker: "2330",
          }),
        ],
      }),
    }));
  });

  it("adds resolved FX conversion rows to report DTOs for mixed-currency holdings", async () => {
    const store = await app.persistence.loadStore(userId);
    const feeProfile = store.feeProfiles[0];
    if (!feeProfile) throw new Error("expected default fee profile");
    const accountFeeProfile = {
      ...feeProfile,
      id: "fp-usd-1",
      accountId: "acc-usd-1",
      name: "US Broker Fee",
    };
    store.feeProfiles.push(accountFeeProfile);
    store.accounts.push({
      id: "acc-usd-1",
      userId,
      name: "US Broker",
      feeProfileId: accountFeeProfile.id,
      defaultCurrency: "USD",
      accountType: "broker",
    });
    store.accounting.projections.holdings.push({
      accountId: "acc-usd-1",
      ticker: "AAPL",
      quantity: 5,
      costBasisAmount: 500,
      currency: "USD",
    });
    store.accounting.facts.tradeEvents.push({
      id: "report-trade-usd-1",
      userId,
      accountId: "acc-usd-1",
      ticker: "AAPL",
      marketCode: "US",
      instrumentType: "STOCK",
      type: "BUY",
      quantity: 5,
      unitPrice: 100,
      priceCurrency: "USD",
      tradeDate: "2026-06-01",
      commissionAmount: 0,
      taxAmount: 0,
      isDayTrade: false,
      feeSnapshot: feeProfile,
      tradeTimestamp: "2026-06-01T14:30:00.000Z",
      bookingSequence: 1,
      bookedAt: "2026-06-01T14:30:00.000Z",
    });
    await app.persistence.saveStore(store);
    await app.persistence.upsertFxRates([
      {
        date: "2026-06-03",
        baseCurrency: "USD",
        quoteCurrency: "TWD",
        rate: 32,
        source: "test",
      },
    ]);

    const portfolioReport = await app.inject({
      method: "GET",
      url: "/reports/portfolio?scope=all",
      headers: { cookie: cookieHeader },
    });

    expect(portfolioReport.statusCode).toBe(200);
    expect(portfolioReport.json()).toEqual(expect.objectContaining({
      fxStatus: expect.objectContaining({
        status: "complete",
        missingRatePairs: [],
      }),
      fxRates: [
        expect.objectContaining({
          fromCurrency: "USD",
          toCurrency: "TWD",
          rate: 32,
          asOf: expect.any(String),
        }),
      ],
    }));
    expect(portfolioReport.json().fxRates).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ fromCurrency: "TWD", toCurrency: "TWD" }),
    ]));
  });

  it("builds synthetic TW-scoped performance when TW snapshots are absent", async () => {
    const store = await app.persistence.loadStore(userId);
    const feeProfile = store.feeProfiles[0];
    if (!feeProfile) throw new Error("expected default fee profile");
    const usdFeeProfile = {
      ...feeProfile,
      id: "fp-usd-tw-scope",
      accountId: "acc-usd-tw-scope",
      name: "USD Broker Fee",
    };
    store.feeProfiles.push(usdFeeProfile);
    store.accounts.push({
      id: "acc-usd-tw-scope",
      userId,
      name: "US Broker",
      feeProfileId: usdFeeProfile.id,
      defaultCurrency: "USD",
      accountType: "broker",
    });
    store.accounting.projections.holdings.push(
      {
        accountId: "acc-1",
        ticker: "2330",
        quantity: 10,
        costBasisAmount: 1000,
        currency: "TWD",
      },
      {
        accountId: "acc-usd-tw-scope",
        ticker: "AAPL",
        quantity: 5,
        costBasisAmount: 500,
        currency: "USD",
      },
    );
    store.accounting.facts.tradeEvents.push(
      {
        id: "report-tw-scope-trade-1",
        userId,
        accountId: "acc-1",
        ticker: "2330",
        marketCode: "TW",
        instrumentType: "STOCK",
        type: "BUY",
        quantity: 10,
        unitPrice: 100,
        priceCurrency: "TWD",
        tradeDate: "2026-06-01",
        commissionAmount: 0,
        taxAmount: 0,
        isDayTrade: false,
        feeSnapshot: feeProfile,
        tradeTimestamp: "2026-06-01T09:00:00.000Z",
        bookingSequence: 1,
        bookedAt: "2026-06-01T09:00:00.000Z",
      },
      {
        id: "report-us-scope-trade-1",
        userId,
        accountId: "acc-usd-tw-scope",
        ticker: "AAPL",
        marketCode: "US",
        instrumentType: "STOCK",
        type: "BUY",
        quantity: 5,
        unitPrice: 100,
        priceCurrency: "USD",
        tradeDate: "2026-06-01",
        commissionAmount: 0,
        taxAmount: 0,
        isDayTrade: false,
        feeSnapshot: usdFeeProfile,
        tradeTimestamp: "2026-06-01T14:30:00.000Z",
        bookingSequence: 1,
        bookedAt: "2026-06-01T14:30:00.000Z",
      },
    );
    await app.persistence.saveStore(store);

    const memoryPersistence = app.persistence as typeof app.persistence & {
      _seedDailyBars?: (bars: Array<{
        ticker: string;
        marketCode: "TW" | "US" | "AU";
        barDate: string;
        open: number;
        high: number;
        low: number;
        close: number;
        volume: number;
        source: string;
        ingestedAt: string;
      }>) => void;
    };
    memoryPersistence._seedDailyBars?.([
      {
        ticker: "2330",
        marketCode: "TW",
        barDate: "2026-06-02",
        open: 100,
        high: 104,
        low: 99,
        close: 103,
        volume: 10_000,
        source: "test",
        ingestedAt: "2026-06-02T10:00:00.000Z",
      },
      {
        ticker: "2330",
        marketCode: "TW",
        barDate: "2026-06-03",
        open: 103,
        high: 106,
        low: 102,
        close: 105,
        volume: 12_000,
        source: "test",
        ingestedAt: "2026-06-03T10:00:00.000Z",
      },
    ]);

    const generatedAt = "2026-06-03T10:00:00.000Z";
    await app.persistence.bulkUpsertHoldingSnapshots(userId, [
      {
        id: "us-scope-snap-1",
        userId,
        accountId: "acc-usd-tw-scope",
        ticker: "AAPL",
        snapshotDate: "2026-06-02",
        quantity: 5,
        closePrice: 110,
        marketValue: 550,
        costBasis: 500,
        unrealizedPnl: 50,
        cumulativeRealizedPnl: 0,
        cumulativeDividends: 0,
        isProvisional: false,
        currency: "USD",
        valueNative: 550,
        costBasisNative: 500,
        unrealizedPnlNative: 50,
        providerSource: "test",
        generatedAt,
        generationRunId: "us-scope-gen",
      },
    ]);
    const snapshotSpy = vi.spyOn(app.persistence, "getHoldingSnapshotsForTicker");
    const scopedAggregateSpy = vi.spyOn(app.persistence, "getAggregatedSnapshotsInReportingCurrencyForScope");

    const dailyReview = await app.inject({
      method: "GET",
      url: "/reports/daily-review?scope=TW&limit=5",
      headers: { cookie: cookieHeader },
    });
    const dailyReviewBody = dailyReview.json() as { holdings: { rows: Array<{ ticker: string }> } };
    expect(dailyReview.statusCode).toBe(200);
    expect(dailyReviewBody.holdings.rows.map((row) => row.ticker)).toEqual(["2330"]);
    expect(snapshotSpy).not.toHaveBeenCalled();
    expect(scopedAggregateSpy).not.toHaveBeenCalled();

    snapshotSpy.mockClear();
    scopedAggregateSpy.mockClear();

    const portfolioReport = await app.inject({
      method: "GET",
      url: "/reports/portfolio?scope=TW&range=1Y",
      headers: { cookie: cookieHeader },
    });
    const portfolioBody = portfolioReport.json() as {
      query: { scope: string; reportingCurrency: string };
      allocation: { byMarket: Array<{ key: string }> };
      concentration: { topHoldings: Array<{ ticker: string }> };
      performance: {
        fxStatus: string;
        points: Array<{
          date: string;
          totalCostAmount: number | null;
          marketValueAmount: number | null;
          totalReturnAmount: number | null;
          totalReturnPercent: number | null;
        }>;
      };
    };
    expect(portfolioReport.statusCode).toBe(200);
    expect(portfolioBody).toEqual(expect.objectContaining({
      query: expect.objectContaining({
        scope: "TW",
        reportingCurrency: "TWD",
      }),
    }));
    expect(portfolioBody.allocation.byMarket.map((bucket) => bucket.key)).toEqual(["TW"]);
    expect(portfolioBody.concentration.topHoldings.map((row) => row.ticker)).toEqual(["2330"]);
    expect(portfolioBody.performance.fxStatus).toBe("complete");
    expect(portfolioBody.performance.points).toEqual([
      expect.objectContaining({
        date: "2026-06-02",
        totalCostAmount: 1000,
        marketValueAmount: 1030,
        totalReturnAmount: 30,
        totalReturnPercent: 3,
      }),
      expect.objectContaining({
        date: "2026-06-03",
        totalCostAmount: 1000,
        marketValueAmount: 1050,
        totalReturnAmount: 50,
        totalReturnPercent: 5,
      }),
    ]);
    expect(snapshotSpy).not.toHaveBeenCalled();
    expect(scopedAggregateSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(String),
      "TWD",
      [{ accountId: "acc-1", ticker: "2330" }],
    );

    snapshotSpy.mockClear();
    scopedAggregateSpy.mockClear();

    const marketReport = await app.inject({
      method: "GET",
      url: "/reports/market?scope=TW&limit=5",
      headers: { cookie: cookieHeader },
    });
    const marketBody = marketReport.json() as {
      detail: { rows: Array<{ ticker: string }> };
      performance: {
        fxStatus: string;
        points: Array<{
          date: string;
          totalCostAmount: number | null;
          marketValueAmount: number | null;
          totalReturnAmount: number | null;
        }>;
      };
    };
    expect(marketReport.statusCode).toBe(200);
    expect(marketBody.detail.rows.map((row) => row.ticker)).toEqual(["2330"]);
    expect(marketBody.performance.fxStatus).toBe("complete");
    expect(marketBody.performance.points).toEqual([
      expect.objectContaining({
        date: "2026-06-02",
        totalCostAmount: 1000,
        marketValueAmount: 1030,
        totalReturnAmount: 30,
      }),
      expect.objectContaining({
        date: "2026-06-03",
        totalCostAmount: 1000,
        marketValueAmount: 1050,
        totalReturnAmount: 50,
      }),
    ]);
    expect(snapshotSpy).not.toHaveBeenCalled();
    expect(scopedAggregateSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(String),
      "TWD",
      [{ accountId: "acc-1", ticker: "2330" }],
    );
  });

  it("does not resolve a second quote snapshot set for snapshot-backed scoped performance", async () => {
    const store = await app.persistence.loadStore(userId);
    const feeProfile = store.feeProfiles[0];
    if (!feeProfile) throw new Error("expected default fee profile");
    store.accounting.projections.holdings.push({
      accountId: "acc-1",
      ticker: "2330",
      quantity: 10,
      costBasisAmount: 1000,
      currency: "TWD",
    });
    store.accounting.facts.tradeEvents.push({
      id: "report-tw-snapshot-trade",
      userId,
      accountId: "acc-1",
      ticker: "2330",
      marketCode: "TW",
      instrumentType: "STOCK",
      type: "BUY",
      quantity: 10,
      unitPrice: 100,
      priceCurrency: "TWD",
      tradeDate: "2026-06-01",
      commissionAmount: 0,
      taxAmount: 0,
      isDayTrade: false,
      feeSnapshot: feeProfile,
      tradeTimestamp: "2026-06-01T09:00:00.000Z",
      bookingSequence: 1,
      bookedAt: "2026-06-01T09:00:00.000Z",
    });
    await app.persistence.saveStore(store);
    await app.persistence.bulkUpsertHoldingSnapshots(userId, [
      {
        id: "tw-scoped-snapshot-backed-1",
        userId,
        accountId: "acc-1",
        ticker: "2330",
        snapshotDate: "2026-06-02",
        quantity: 10,
        closePrice: 103,
        marketValue: 1030,
        costBasis: 1000,
        unrealizedPnl: 30,
        cumulativeRealizedPnl: 0,
        cumulativeDividends: 0,
        isProvisional: false,
        currency: "TWD",
        valueNative: 1030,
        costBasisNative: 1000,
        unrealizedPnlNative: 30,
        providerSource: "test",
        generatedAt: "2026-06-02T10:00:00.000Z",
        generationRunId: "tw-scoped-snapshot-backed",
      },
    ]);
    const quoteBarsSpy = vi.spyOn(app.persistence, "getLatestBarsByTickerMarket");

    const report = await app.inject({
      method: "GET",
      url: "/reports/portfolio?scope=TW&range=1Y",
      headers: { cookie: cookieHeader },
    });
    const body = report.json() as {
      performance: {
        points: Array<{ date: string; marketValueAmount: number | null }>;
      };
    };

    expect(report.statusCode).toBe(200);
    expect(body.performance.points).toEqual([
      expect.objectContaining({
        date: "2026-06-02",
        marketValueAmount: 1030,
      }),
    ]);
    expect(quoteBarsSpy).toHaveBeenCalledTimes(1);
  });

  it("preserves scoped upcoming dividend events that do not have ledger rows", async () => {
    const store = await app.persistence.loadStore(userId);
    const feeProfile = store.feeProfiles[0];
    if (!feeProfile) throw new Error("expected default fee profile");
    const usdFeeProfile = {
      ...feeProfile,
      id: "fp-us-upcoming-dividend",
      accountId: "acc-us-upcoming-dividend",
      name: "US Broker Fee",
    };
    store.feeProfiles.push(usdFeeProfile);
    store.accounts.push({
      id: "acc-us-upcoming-dividend",
      userId,
      name: "US Broker",
      feeProfileId: usdFeeProfile.id,
      defaultCurrency: "USD",
      accountType: "broker",
    });
    store.instruments.push(
      {
        ticker: "2330",
        type: "STOCK",
        marketCode: "TW",
        isProvisional: false,
      },
      {
        ticker: "AAPL",
        type: "STOCK",
        marketCode: "US",
        isProvisional: false,
      },
    );
    store.accounting.projections.holdings.push(
      {
        accountId: "acc-1",
        ticker: "2330",
        quantity: 10,
        costBasisAmount: 1000,
        currency: "TWD",
      },
      {
        accountId: "acc-us-upcoming-dividend",
        ticker: "AAPL",
        quantity: 5,
        costBasisAmount: 500,
        currency: "USD",
      },
    );
    store.accounting.facts.tradeEvents.push(
      {
        id: "report-tw-upcoming-dividend-trade",
        userId,
        accountId: "acc-1",
        ticker: "2330",
        marketCode: "TW",
        instrumentType: "STOCK",
        type: "BUY",
        quantity: 10,
        unitPrice: 100,
        priceCurrency: "TWD",
        tradeDate: relativeIsoDate(-10),
        commissionAmount: 0,
        taxAmount: 0,
        isDayTrade: false,
        feeSnapshot: feeProfile,
        tradeTimestamp: `${relativeIsoDate(-10)}T09:00:00.000Z`,
        bookingSequence: 1,
        bookedAt: `${relativeIsoDate(-10)}T09:00:00.000Z`,
      },
      {
        id: "report-us-upcoming-dividend-trade",
        userId,
        accountId: "acc-us-upcoming-dividend",
        ticker: "AAPL",
        marketCode: "US",
        instrumentType: "STOCK",
        type: "BUY",
        quantity: 5,
        unitPrice: 100,
        priceCurrency: "USD",
        tradeDate: relativeIsoDate(-10),
        commissionAmount: 0,
        taxAmount: 0,
        isDayTrade: false,
        feeSnapshot: usdFeeProfile,
        tradeTimestamp: `${relativeIsoDate(-10)}T14:30:00.000Z`,
        bookingSequence: 1,
        bookedAt: `${relativeIsoDate(-10)}T14:30:00.000Z`,
      },
    );
    store.marketData.dividendEvents.push(
      {
        id: "report-tw-upcoming-dividend-event",
        ticker: "2330",
        eventType: "CASH",
        exDividendDate: relativeIsoDate(10),
        paymentDate: relativeIsoDate(20),
        cashDividendPerShare: 3,
        cashDividendCurrency: "TWD",
        stockDividendPerShare: 0,
        source: "test",
      },
      {
        id: "report-us-upcoming-dividend-event",
        ticker: "AAPL",
        eventType: "CASH",
        exDividendDate: relativeIsoDate(10),
        paymentDate: relativeIsoDate(20),
        cashDividendPerShare: 2,
        cashDividendCurrency: "USD",
        stockDividendPerShare: 0,
        source: "test",
      },
    );
    await app.persistence.saveStore(store);

    for (const endpoint of ["daily-review", "portfolio", "market"]) {
      const response = await app.inject({
        method: "GET",
        url: `/reports/${endpoint}?scope=TW&currencyMode=specified&currency=TWD&limit=5`,
        headers: { cookie: cookieHeader },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(expect.objectContaining({
        query: expect.objectContaining({
          scope: "TW",
          reportingCurrency: "TWD",
        }),
        summary: expect.objectContaining({
          upcomingDividendCount: 1,
          upcomingDividendAmount: 30,
        }),
      }));
    }
  });

  it("rejects unsupported report ranges before route or MCP report builders can fail generically", async () => {
    const portfolioReport = await app.inject({
      method: "GET",
      url: "/reports/portfolio?range=foo",
      headers: { cookie: cookieHeader },
    });
    expect(portfolioReport.statusCode).toBe(400);
    expect(portfolioReport.json()).toEqual(expect.objectContaining({
      error: "invalid_report_range",
      message: expect.stringContaining("range must be one of"),
    }));

    const dailyReview = await app.inject({
      method: "GET",
      url: "/reports/daily-review?range=foo",
      headers: { cookie: cookieHeader },
    });
    expect(dailyReview.statusCode).toBe(400);
    expect(dailyReview.json()).toEqual(expect.objectContaining({
      error: "invalid_report_range",
    }));

    await expect(buildPortfolioReport(app, userId, { range: "foo" })).rejects.toMatchObject({
      statusCode: 400,
      code: "invalid_report_range",
    });
  });

  it("scopes market reports by holding market instead of account currency", async () => {
    const store = await app.persistence.loadStore(userId);
    const feeProfile = store.feeProfiles[0];
    if (!feeProfile) throw new Error("expected default fee profile");
    const accountFeeProfile = {
      ...feeProfile,
      id: "fp-usd-au",
      accountId: "acc-usd-au",
      name: "USD AU Broker Fee",
    };
    store.feeProfiles.push(accountFeeProfile);
    store.accounts.push({
      id: "acc-usd-au",
      userId,
      name: "USD Broker With AU Holding",
      feeProfileId: accountFeeProfile.id,
      defaultCurrency: "USD",
      accountType: "broker",
    });
    store.instruments.push({
      ticker: "BHP",
      type: "STOCK",
      marketCode: "AU",
      isProvisional: false,
    });
    store.accounting.projections.holdings.push({
      accountId: "acc-usd-au",
      ticker: "BHP",
      quantity: 8,
      costBasisAmount: 320,
      currency: "AUD",
    });
    store.accounting.facts.tradeEvents.push({
      id: "report-au-trade-1",
      userId,
      accountId: "acc-usd-au",
      ticker: "BHP",
      marketCode: "AU",
      instrumentType: "STOCK",
      type: "BUY",
      quantity: 8,
      unitPrice: 40,
      priceCurrency: "AUD",
      tradeDate: "2026-06-01",
      commissionAmount: 0,
      taxAmount: 0,
      isDayTrade: false,
      feeSnapshot: accountFeeProfile,
      tradeTimestamp: "2026-06-01T09:00:00.000Z",
      bookingSequence: 1,
      bookedAt: "2026-06-01T09:00:00.000Z",
    });
    await app.persistence.saveStore(store);

    const marketReport = await app.inject({
      method: "GET",
      url: "/reports/market?scope=AU&currencyMode=auto&limit=5",
      headers: { cookie: cookieHeader },
    });

    expect(marketReport.statusCode).toBe(200);
    expect(marketReport.json()).toEqual(expect.objectContaining({
      query: expect.objectContaining({
        scope: "AU",
        reportingCurrency: "AUD",
      }),
      detail: expect.objectContaining({
        rows: expect.arrayContaining([
          expect.objectContaining({
            ticker: "BHP",
            marketCode: "AU",
            reportingCurrency: "AUD",
          }),
        ]),
      }),
    }));
  });

  it("keeps same-ticker realized P&L scoped to the selected market", async () => {
    const store = await app.persistence.loadStore(userId);
    const feeProfile = store.feeProfiles[0];
    if (!feeProfile) throw new Error("expected default fee profile");
    store.instruments.push(
      {
        ticker: "BHP",
        type: "STOCK",
        marketCode: "AU",
        isProvisional: false,
      },
      {
        ticker: "BHP",
        type: "STOCK",
        marketCode: "US",
        isProvisional: false,
      },
    );
    store.accounting.projections.holdings.push(
      {
        accountId: "acc-1",
        ticker: "BHP",
        quantity: 8,
        costBasisAmount: 320,
        currency: "AUD",
      },
      {
        accountId: "acc-1",
        ticker: "BHP",
        quantity: 3,
        costBasisAmount: 180,
        currency: "USD",
      },
    );
    store.accounting.facts.tradeEvents.push(
      {
        id: "report-au-sell-1",
        userId,
        accountId: "acc-1",
        ticker: "BHP",
        marketCode: "AU",
        instrumentType: "STOCK",
        type: "SELL",
        quantity: 1,
        unitPrice: 45,
        priceCurrency: "AUD",
        tradeDate: "2026-06-01",
        commissionAmount: 0,
        taxAmount: 0,
        isDayTrade: false,
        feeSnapshot: feeProfile,
        tradeTimestamp: "2026-06-01T09:00:00.000Z",
        bookingSequence: 1,
        bookedAt: "2026-06-01T09:00:00.000Z",
        realizedPnlAmount: 10,
        realizedPnlCurrency: "AUD",
      },
      {
        id: "report-us-sell-1",
        userId,
        accountId: "acc-1",
        ticker: "BHP",
        marketCode: "US",
        instrumentType: "STOCK",
        type: "SELL",
        quantity: 1,
        unitPrice: 90,
        priceCurrency: "AUD",
        tradeDate: "2026-06-01",
        commissionAmount: 0,
        taxAmount: 0,
        isDayTrade: false,
        feeSnapshot: feeProfile,
        tradeTimestamp: "2026-06-01T09:01:00.000Z",
        bookingSequence: 2,
        bookedAt: "2026-06-01T09:01:00.000Z",
        realizedPnlAmount: 999,
        realizedPnlCurrency: "AUD",
      },
    );
    await app.persistence.saveStore(store);

    const marketReport = await app.inject({
      method: "GET",
      url: "/reports/market?scope=AU&currencyMode=specified&currency=AUD&limit=5",
      headers: { cookie: cookieHeader },
    });

    expect(marketReport.statusCode).toBe(200);
    expect(marketReport.json()).toEqual(expect.objectContaining({
      summary: expect.objectContaining({
        realizedPnlAmount: 10,
      }),
      detail: expect.objectContaining({
        rows: [
          expect.objectContaining({
            ticker: "BHP",
            marketCode: "AU",
            reportingCurrency: "AUD",
          }),
        ],
      }),
    }));
  });

  it("splits ticker primary and enrichment payloads", async () => {
    const store = await app.persistence.loadStore(userId);
    const feeProfile = store.feeProfiles[0];
    if (!feeProfile) throw new Error("expected default fee profile");
    store.accounting.projections.holdings.push({
      accountId: "acc-1",
      ticker: "2330",
      quantity: 4,
      costBasisAmount: 400,
      currency: "TWD",
    });
    store.accounting.facts.tradeEvents.push({
      id: "report-ticker-trade-1",
      userId,
      accountId: "acc-1",
      ticker: "2330",
      marketCode: "TW",
      instrumentType: "STOCK",
      type: "BUY",
      quantity: 4,
      unitPrice: 100,
      priceCurrency: "TWD",
      tradeDate: "2026-06-01",
      commissionAmount: 0,
      taxAmount: 0,
      isDayTrade: false,
      feeSnapshot: feeProfile,
      tradeTimestamp: "2026-06-01T09:00:00.000Z",
      bookingSequence: 1,
      bookedAt: "2026-06-01T09:00:00.000Z",
    });
    await app.persistence.saveStore(store);

    const memoryPersistence = app.persistence as typeof app.persistence & {
      _seedDailyBars?: (bars: Array<{
        ticker: string;
        marketCode: "TW" | "US" | "AU";
        barDate: string;
        open: number;
        high: number;
        low: number;
        close: number;
        volume: number;
        source: string;
        ingestedAt: string;
      }>) => void;
    };
    memoryPersistence._seedDailyBars?.([
      {
        ticker: "2330",
        marketCode: "TW",
        barDate: "2026-06-03",
        open: 100,
        high: 102,
        low: 99,
        close: 101,
        volume: 8_000,
        source: "test",
        ingestedAt: "2026-06-03T10:00:00.000Z",
      },
    ]);

    const primary = await app.inject({
      method: "GET",
      url: "/tickers/2330/primary?accountId=acc-1",
      headers: { cookie: cookieHeader },
    });
    expect(primary.statusCode).toBe(200);
    expect(primary.json()).toEqual(expect.objectContaining({
      identity: expect.objectContaining({
        ticker: "2330",
        marketCode: "TW",
      }),
      position: expect.objectContaining({
        quantity: 4,
      }),
      transactions: expect.any(Array),
    }));
    expect(primary.json().chart).toBeUndefined();
    expect(primary.json().fundamentals).toBeUndefined();

    const enrichment = await app.inject({
      method: "GET",
      url: "/tickers/2330/enrichment?accountId=acc-1",
      headers: { cookie: cookieHeader },
    });
    expect(enrichment.statusCode).toBe(200);
    expect(enrichment.json()).toEqual(expect.objectContaining({
      identity: expect.objectContaining({
        ticker: "2330",
      }),
      chart: expect.objectContaining({
        range: "1Y",
      }),
      fundamentals: expect.any(Object),
      fundamentalsRefresh: expect.any(Object),
    }));
    expect(enrichment.json().position).toBeUndefined();
    expect(enrichment.json().transactions).toBeUndefined();
  });
});
