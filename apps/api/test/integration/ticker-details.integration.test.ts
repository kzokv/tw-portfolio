import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MarketCode } from "@vakwen/domain";
import { buildApp } from "../../src/app.js";
import { createEmptyTickerFundamentals, type FundamentalsProvider } from "../../src/services/fundamentals/types.js";
import { transactionPayload } from "../helpers/fixtures.js";

let app: Awaited<ReturnType<typeof buildApp>>;

describe("GET /tickers/:ticker/details", () => {
  beforeEach(async () => {
    app = await buildApp({ persistenceBackend: "memory" });
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it("[ticker details]: returns persisted fundamentals with ticker aggregates", async () => {
    const createTrade = await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "ticker-details-trade" },
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

    const store = await app.persistence.loadStore("user-1");
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
      headers: { "idempotency-key": "ticker-details-multi-main" },
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
      headers: { "idempotency-key": "ticker-details-multi-second" },
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

  it("[ticker details]: hanging fundamentals refresh does not block the response", async () => {
    const ticker = "QAASYNC";
    const createTrade = await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "ticker-details-async-trade" },
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
