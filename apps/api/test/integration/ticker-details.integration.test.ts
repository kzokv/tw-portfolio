import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MarketCode } from "@vakwen/domain";
import { signSessionCookie } from "../../src/auth/googleOAuth.js";
import { buildApp } from "../../src/app.js";
import { createEmptyTickerFundamentals, type FundamentalsProvider } from "../../src/services/fundamentals/types.js";
import { transactionPayload } from "../helpers/fixtures.js";

let app: Awaited<ReturnType<typeof buildApp>>;
let cookieHeader: string;
let userId: string;

const testOAuthConfig = {
  clientId: "test-client",
  clientSecret: "test-secret",
  redirectUri: "http://localhost:4000/auth/google/callback",
  sessionSecret: "test-session-secret-that-is-long-enough-32chars!!",
};

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  return { cookie: cookieHeader, ...extra };
}

describe("GET /tickers/:ticker/details", () => {
  beforeEach(async () => {
    app = await buildApp({ persistenceBackend: "memory", oauthConfig: testOAuthConfig });
    const authUser = await app.persistence.resolveOrCreateUser("google", "ticker-details-test-user", {
      email: "ticker-details-test-user@example.com",
      name: "Ticker Details Test User",
    });
    userId = authUser.userId;
    const user = await app.persistence.getAuthUserById(userId);
    if (!user) throw new Error("expected seeded auth user");
    cookieHeader = `g_auth_session=${signSessionCookie(userId, testOAuthConfig.sessionSecret, user.sessionVersion)}`;
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it("[ticker details]: returns persisted fundamentals with ticker aggregates", async () => {
    const createTrade = await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: authHeaders({ "idempotency-key": "ticker-details-trade" }),
      payload: transactionPayload({
        ticker: "2330",
        quantity: 20,
        unitPrice: 100,
        tradeDate: "2026-01-02",
      }),
    });
    expect(createTrade.statusCode).toBe(200);

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
    if (typeof memoryPersistence._seedDailyBars === "function") {
      memoryPersistence._seedDailyBars([
        {
          ticker: "2330",
          marketCode: "TW",
          barDate: "2026-01-02",
          open: 100,
          high: 101,
          low: 99,
          close: 100,
          volume: 1_000,
          source: "test-bars",
          ingestedAt: "2026-01-02T08:00:00.000Z",
        },
        {
          ticker: "2330",
          marketCode: "TW",
          barDate: "2026-01-03",
          open: 101,
          high: 103,
          low: 100,
          close: 102,
          volume: 1_200,
          source: "test-bars",
          ingestedAt: "2026-01-03T08:00:00.000Z",
        },
      ]);
    }

    const fundamentals = createEmptyTickerFundamentals();
    fundamentals.marketCap = {
      value: 123_456_789,
      source: "seed-provider",
      asOf: "2026-01-03",
    };
    fundamentals.priceEarningsRatio = {
      value: 17.5,
      source: "seed-provider",
      asOf: "2026-01-03",
    };
    await app.persistence.saveTickerFundamentalsSnapshot({
      ticker: "2330",
      marketCode: "TW",
      providerId: "seed-provider",
      fundamentals,
      refreshedAt: "2026-05-20T09:00:00.000Z",
      nextRefreshAt: "2026-12-01T09:00:00.000Z",
    });

    const store = await app.persistence.loadStore(userId);
    store.marketData.dividendEvents.push({
      id: "dividend-2330",
      ticker: "2330",
      eventType: "CASH",
      exDividendDate: "2026-11-05",
      paymentDate: "2026-11-20",
      cashDividendPerShare: 5,
      cashDividendCurrency: "TWD",
      stockDividendPerShare: 0,
      source: "manual",
    });
    await app.persistence.saveStore(store);

    const response = await app.inject({
      method: "GET",
      url: "/tickers/2330/details?accountId=acc-1",
      headers: authHeaders(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(expect.objectContaining({
      identity: expect.objectContaining({
        ticker: "2330",
        marketCode: "TW",
        accountId: "acc-1",
      }),
      quote: expect.objectContaining({
        currentUnitPrice: 102,
        previousClose: 100,
        quoteStatus: expect.stringMatching(/current|provisional/),
      }),
      position: expect.objectContaining({
        quantity: 20,
        costBasisAmount: expect.any(Number),
        marketValueAmount: 2040,
      }),
      chart: expect.objectContaining({
        range: "1Y",
        points: expect.arrayContaining([
          expect.objectContaining({ date: "2026-01-03", close: 102 }),
        ]),
      }),
      transactions: [
        expect.objectContaining({
          ticker: "2330",
          accountId: "acc-1",
        }),
      ],
      dividends: expect.objectContaining({
        upcoming: expect.arrayContaining([
          expect.objectContaining({
            ticker: "2330",
            accountId: "acc-1",
          }),
        ]),
      }),
      fundamentals: expect.objectContaining({
        marketCap: {
          value: 123_456_789,
          source: "seed-provider",
          asOf: "2026-01-03",
        },
        priceEarningsRatio: {
          value: 17.5,
          source: "seed-provider",
          asOf: "2026-01-03",
        },
      }),
      fundamentalsRefresh: expect.objectContaining({
        providerId: "seed-provider",
        status: "fresh",
      }),
    }));
  });

  it("[ticker details]: aggregates same-market ticker data across multiple accounts", async () => {
    const createSecondAccount = await app.inject({
      method: "POST",
      url: "/accounts",
      headers: authHeaders(),
      payload: {
        name: "Second TWD Brokerage",
        defaultCurrency: "TWD",
        accountType: "broker",
      },
    });
    expect(createSecondAccount.statusCode).toBe(200);
    const secondAccount = createSecondAccount.json() as { id: string; name: string };

    const createMainTrade = await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: authHeaders({ "idempotency-key": "ticker-details-multi-main" }),
      payload: transactionPayload({
        ticker: "2330",
        accountId: "acc-1",
        quantity: 10,
        unitPrice: 100,
        tradeDate: "2026-01-02",
      }),
    });
    expect(createMainTrade.statusCode).toBe(200);

    const createSecondTrade = await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: authHeaders({ "idempotency-key": "ticker-details-multi-second" }),
      payload: transactionPayload({
        ticker: "2330",
        accountId: secondAccount.id,
        quantity: 5,
        unitPrice: 120,
        tradeDate: "2026-01-03",
      }),
    });
    expect(createSecondTrade.statusCode).toBe(200);

    const response = await app.inject({
      method: "GET",
      url: "/tickers/2330/details",
      headers: authHeaders(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(expect.objectContaining({
      identity: expect.objectContaining({
        ticker: "2330",
        accountId: null,
        marketCode: "TW",
      }),
      position: expect.objectContaining({
        quantity: 15,
        accountIds: expect.arrayContaining(["acc-1", secondAccount.id]),
      }),
      transactions: expect.arrayContaining([
        expect.objectContaining({
          accountId: "acc-1",
          accountName: "Main",
          quantity: 10,
        }),
        expect.objectContaining({
          accountId: secondAccount.id,
          accountName: "Second TWD Brokerage",
          quantity: 5,
        }),
      ]),
    }));
  });

  it("[ticker details]: computes market value and P&L for non-TW tickers by market", async () => {
    await app.persistence._setUserPreferences(userId, { reportingCurrency: "USD" });
    const createUsAccount = await app.inject({
      method: "POST",
      url: "/accounts",
      headers: authHeaders(),
      payload: {
        name: "US Ticker Broker",
        defaultCurrency: "USD",
        accountType: "broker",
      },
    });
    expect(createUsAccount.statusCode).toBe(200);
    const usAccount = createUsAccount.json() as { id: string; name: string; feeProfileId: string };

    const store = await app.persistence.loadStore(userId);
    const usdFeeProfile = store.feeProfiles.find((profile) => profile.id === usAccount.feeProfileId);
    if (!usdFeeProfile) throw new Error("expected US account fee profile");
    store.accounting.projections.holdings.push({
      accountId: usAccount.id,
      ticker: "AAPL",
      quantity: 3,
      costBasisAmount: 300,
      currency: "USD",
    });
    store.accounting.facts.tradeEvents.push({
      id: "ticker-details-aapl-buy",
      userId,
      accountId: usAccount.id,
      ticker: "AAPL",
      marketCode: "US",
      instrumentType: "STOCK",
      type: "BUY",
      quantity: 3,
      unitPrice: 100,
      priceCurrency: "USD",
      tradeDate: "2026-04-01",
      commissionAmount: 0,
      taxAmount: 0,
      isDayTrade: false,
      feeSnapshot: usdFeeProfile,
      tradeTimestamp: "2026-04-01T14:30:00.000Z",
      bookingSequence: 1,
      bookedAt: "2026-04-01T14:30:00.000Z",
    });
    await app.persistence.saveStore(store);
    await app.persistence.upsertInstruments(userId, [
      {
        ticker: "AAPL",
        type: "STOCK",
        marketCode: "US",
        isProvisional: false,
      },
    ]);

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
        ticker: "AAPL",
        marketCode: "US",
        barDate: "2026-04-02",
        open: 120,
        high: 121,
        low: 119,
        close: 120,
        volume: 10_000,
        source: "test-bars",
        ingestedAt: "2026-04-02T20:00:00.000Z",
      },
      {
        ticker: "AAPL",
        marketCode: "US",
        barDate: "2026-04-03",
        open: 124,
        high: 126,
        low: 123,
        close: 125,
        volume: 12_000,
        source: "test-bars",
        ingestedAt: "2026-04-03T20:00:00.000Z",
      },
    ]);

    const response = await app.inject({
      method: "GET",
      url: `/tickers/AAPL/details?accountId=${usAccount.id}`,
      headers: authHeaders(),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toEqual(expect.objectContaining({
      identity: expect.objectContaining({
        ticker: "AAPL",
        marketCode: "US",
        accountId: usAccount.id,
        priceCurrency: "USD",
      }),
      quote: expect.objectContaining({
        currentUnitPrice: 125,
        previousClose: 120,
        change: 5,
        priceState: expect.objectContaining({
          basis: "stale_close",
          chipState: "stale",
          sourceKind: "primary_daily",
        }),
      }),
      position: expect.objectContaining({
        quantity: 3,
        costBasisAmount: 300,
        marketValueAmount: 375,
        unrealizedPnlAmount: 75,
        currency: "USD",
      }),
      holdingGroup: expect.objectContaining({
        ticker: "AAPL",
        marketCode: "US",
        reportingCurrency: "USD",
        reportingMarketValueAmount: 375,
        reportingUnrealizedPnlAmount: 75,
        reportingDailyChangeAmount: 15,
      }),
      accountBreakdown: [
        expect.objectContaining({
          accountId: usAccount.id,
          reportingCurrency: "USD",
          reportingMarketValueAmount: 375,
          reportingUnrealizedPnlAmount: 75,
          reportingDailyChangeAmount: 15,
        }),
      ],
    }));
    expect(body.quote.changePercent).toBeCloseTo(4.1667, 4);
  });

  it("[ticker details]: preserves null reporting amounts when user reporting FX is unavailable", async () => {
    const createUsAccount = await app.inject({
      method: "POST",
      url: "/accounts",
      headers: authHeaders(),
      payload: {
        name: "US Reporting Gap Broker",
        defaultCurrency: "USD",
        accountType: "broker",
      },
    });
    expect(createUsAccount.statusCode).toBe(200);
    const usAccount = createUsAccount.json() as { id: string; feeProfileId: string };

    await app.persistence._setUserPreferences(userId, { reportingCurrency: "TWD" });
    const store = await app.persistence.loadStore(userId);
    const usdFeeProfile = store.feeProfiles.find((profile) => profile.id === usAccount.feeProfileId);
    if (!usdFeeProfile) throw new Error("expected US account fee profile");
    store.accounting.projections.holdings.push({
      accountId: usAccount.id,
      ticker: "AAPL",
      quantity: 3,
      costBasisAmount: 300,
      currency: "USD",
    });
    store.accounting.facts.tradeEvents.push({
      id: "ticker-details-aapl-missing-fx",
      userId,
      accountId: usAccount.id,
      ticker: "AAPL",
      marketCode: "US",
      instrumentType: "STOCK",
      type: "BUY",
      quantity: 3,
      unitPrice: 100,
      priceCurrency: "USD",
      tradeDate: "2026-04-01",
      commissionAmount: 0,
      taxAmount: 0,
      isDayTrade: false,
      feeSnapshot: usdFeeProfile,
      tradeTimestamp: "2026-04-01T14:30:00.000Z",
      bookingSequence: 1,
      bookedAt: "2026-04-01T14:30:00.000Z",
    });
    await app.persistence.saveStore(store);
    await app.persistence.upsertInstruments(userId, [
      {
        ticker: "AAPL",
        type: "STOCK",
        marketCode: "US",
        isProvisional: false,
      },
    ]);

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
        ticker: "AAPL",
        marketCode: "US",
        barDate: "2026-04-02",
        open: 120,
        high: 121,
        low: 119,
        close: 120,
        volume: 10_000,
        source: "test-bars",
        ingestedAt: "2026-04-02T20:00:00.000Z",
      },
      {
        ticker: "AAPL",
        marketCode: "US",
        barDate: "2026-04-03",
        open: 124,
        high: 126,
        low: 123,
        close: 125,
        volume: 12_000,
        source: "test-bars",
        ingestedAt: "2026-04-03T20:00:00.000Z",
      },
    ]);

    const response = await app.inject({
      method: "GET",
      url: `/tickers/AAPL/details?accountId=${usAccount.id}`,
      headers: authHeaders(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(expect.objectContaining({
      holdingGroup: expect.objectContaining({
        reportingCurrency: "TWD",
        reportingCostBasisAmount: null,
        reportingMarketValueAmount: null,
        reportingUnrealizedPnlAmount: null,
        reportingDailyChangeAmount: null,
        fxStatus: "missing",
      }),
      accountBreakdown: [
        expect.objectContaining({
          reportingCurrency: "TWD",
          reportingCostBasisAmount: null,
          reportingMarketValueAmount: null,
          reportingUnrealizedPnlAmount: null,
          reportingDailyChangeAmount: null,
          fxStatus: "missing",
        }),
      ],
    }));
  });

  it("[ticker details]: validates range query shape on details and enrichment endpoints", async () => {
    const detailsResponse = await app.inject({
      method: "GET",
      url: "/tickers/2330/details?range=1Y&startDate=2026-01-01&endDate=2026-06-01",
      headers: authHeaders(),
    });
    expect(detailsResponse.statusCode).toBe(400);

    const enrichmentResponse = await app.inject({
      method: "GET",
      url: "/tickers/2330/enrichment?startDate=2026-01-01",
      headers: authHeaders(),
    });
    expect(enrichmentResponse.statusCode).toBe(400);
  });

  it("[ticker details]: returns requested and available chart metadata without backfilling provider data", async () => {
    const createTrade = await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: authHeaders({ "idempotency-key": "ticker-details-range-trade" }),
      payload: transactionPayload({
        ticker: "2330",
        quantity: 5,
        unitPrice: 100,
        tradeDate: "2026-01-02",
      }),
    });
    expect(createTrade.statusCode).toBe(200);

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
        barDate: "2025-01-15",
        open: 100,
        high: 102,
        low: 99,
        close: 101,
        volume: 1_000,
        source: "test-bars",
        ingestedAt: "2025-01-15T08:00:00.000Z",
      },
      {
        ticker: "2330",
        marketCode: "TW",
        barDate: "2026-06-10",
        open: 120,
        high: 122,
        low: 119,
        close: 121,
        volume: 1_000,
        source: "test-bars",
        ingestedAt: "2026-06-10T08:00:00.000Z",
      },
    ]);

    const response = await app.inject({
      method: "GET",
      url: "/tickers/2330/details?startDate=2024-01-01&endDate=2026-12-31",
      headers: authHeaders(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(expect.objectContaining({
      quote: expect.objectContaining({
        currentUnitPrice: 121,
      }),
      chart: expect.objectContaining({
        range: "CUSTOM",
        metadata: {
          requested: { range: null, startDate: "2024-01-01", endDate: "2026-12-31" },
          resolved: { range: "CUSTOM", startDate: "2024-01-01", endDate: "2026-12-31" },
          available: { startDate: "2025-01-15", endDate: "2026-06-10" },
          truncated: { startDate: true, endDate: true },
        },
      }),
    }));
  });

  it("[ticker details]: rejects custom ranges beyond 10 years", async () => {
    const createTrade = await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: authHeaders({ "idempotency-key": "ticker-details-invalid-custom-range-trade" }),
      payload: transactionPayload({
        ticker: "2330",
        quantity: 1,
        unitPrice: 100,
        tradeDate: "2026-01-02",
      }),
    });
    expect(createTrade.statusCode).toBe(200);

    const response = await app.inject({
      method: "GET",
      url: "/tickers/2330/details?startDate=2010-01-01&endDate=2021-01-02",
      headers: authHeaders(),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual(expect.objectContaining({
      error: "ticker_chart_custom_range_too_large",
    }));
  });

  it("[ticker details]: hanging fundamentals refresh does not block the response", async () => {
    const ticker = "QAASYNC";
    const createTrade = await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: authHeaders({ "idempotency-key": "ticker-details-async-trade" }),
      payload: transactionPayload({
        ticker,
        marketCode: "TW",
        quantity: 3,
        unitPrice: 50,
        tradeDate: "2026-02-01",
      }),
    });
    expect(createTrade.statusCode).toBe(200);

    const hangingProvider: FundamentalsProvider = {
      providerId: "test-hanging-provider",
      fetchFundamentals: async (_input: { ticker: string; marketCode: MarketCode }) => (
        new Promise<ReturnType<typeof createEmptyTickerFundamentals>>(() => {})
      ),
    };
    app.fundamentalsRegistry.set("TW", hangingProvider);

    const injectPromise = app.inject({
      method: "GET",
      url: `/tickers/${ticker}/details?accountId=acc-1&marketCode=TW`,
      headers: authHeaders(),
    });

    const result = await Promise.race([
      injectPromise.then(() => "resolved" as const),
      new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 100)),
    ]);

    expect(result).toBe("resolved");
    const response = await injectPromise;
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(expect.objectContaining({
      identity: expect.objectContaining({
        ticker,
        marketCode: "TW",
      }),
      fundamentalsRefresh: expect.objectContaining({
        status: "missing",
      }),
    }));
  });
});
