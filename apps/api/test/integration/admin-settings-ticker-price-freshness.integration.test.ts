import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";

describe("admin settings — tickerPriceFreshness", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    app = await buildApp({ persistenceBackend: "memory", registerWorkers: false });
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it("PATCH /admin/settings persists grouped ticker price freshness settings and GET reloads them", async () => {
    const payload = {
      tickerPriceFreshness: {
        closeRefreshGraceMinutes: 45,
        intradayEnabled: false,
        intradayRefreshIntervalMinutes: 7,
        intradayFreshnessToleranceMinutes: 25,
        yahooChartRequestLimitPerMinute: 180,
        queueConcurrency: 6,
        maxTickersPerRefreshCycle: 240,
        supportedMarkets: ["TW", "US"],
        regularSessionOnly: true,
        yahooChartRange: "5d",
        yahooChartInterval: "15m",
        refreshCloseRateLimitWindowMs: 120_000,
        refreshCloseRateLimitMax: 8,
        syncTickerCap: 30,
      },
    };

    const patched = await app.inject({
      method: "PATCH",
      url: "/admin/settings",
      headers: { "x-user-id": "user-1", "x-user-role": "admin" },
      payload,
    });

    expect(patched.statusCode).toBe(200);
    expect(patched.json()).toMatchObject({
      tickerPriceFreshness: {
        closeRefreshGraceMinutes: 45,
        effectiveCloseRefreshGraceMinutes: 45,
        intradayEnabled: false,
        effectiveIntradayEnabled: false,
        intradayRefreshIntervalMinutes: 7,
        effectiveIntradayRefreshIntervalMinutes: 7,
        intradayFreshnessToleranceMinutes: 25,
        effectiveIntradayFreshnessToleranceMinutes: 25,
        yahooChartRequestLimitPerMinute: 180,
        effectiveYahooChartRequestLimitPerMinute: 180,
        queueConcurrency: 6,
        effectiveQueueConcurrency: 6,
        maxTickersPerRefreshCycle: 240,
        effectiveMaxTickersPerRefreshCycle: 240,
        supportedMarkets: ["TW", "US"],
        effectiveSupportedMarkets: ["TW", "US"],
        regularSessionOnly: true,
        effectiveRegularSessionOnly: true,
        yahooChartRange: "5d",
        effectiveYahooChartRange: "5d",
        yahooChartInterval: "15m",
        effectiveYahooChartInterval: "15m",
        refreshCloseRateLimitWindowMs: 120_000,
        effectiveRefreshCloseRateLimitWindowMs: 120_000,
        refreshCloseRateLimitMax: 8,
        effectiveRefreshCloseRateLimitMax: 8,
        syncTickerCap: 30,
        effectiveSyncTickerCap: 30,
      },
    });

    const reloaded = await app.inject({
      method: "GET",
      url: "/admin/settings",
      headers: { "x-user-id": "user-1", "x-user-role": "admin" },
    });

    expect(reloaded.statusCode).toBe(200);
    expect(reloaded.json()).toMatchObject({
      tickerPriceFreshness: {
        effectiveIntradayEnabled: false,
        effectiveSupportedMarkets: ["TW", "US"],
        effectiveYahooChartRange: "5d",
        effectiveYahooChartInterval: "15m",
        effectiveSyncTickerCap: 30,
      },
    });

    const config = await app.persistence.getAppConfig();
    expect(config).toMatchObject({
      tickerPriceCloseRefreshGraceMinutes: 45,
      tickerPriceIntradayEnabled: false,
      tickerPriceIntradayRefreshIntervalMinutes: 7,
      tickerPriceIntradayFreshnessToleranceMinutes: 25,
      tickerPriceYahooChartRequestLimitPerMinute: 180,
      tickerPriceQueueConcurrency: 6,
      tickerPriceMaxTickersPerRefreshCycle: 240,
      tickerPriceSupportedMarkets: ["TW", "US"],
      tickerPriceRegularSessionOnly: true,
      tickerPriceYahooChartRange: "5d",
      tickerPriceYahooChartInterval: "15m",
      tickerPriceRefreshCloseRateLimitWindowMs: 120_000,
      tickerPriceRefreshCloseRateLimitMax: 8,
      tickerPriceSyncTickerCap: 30,
    });
  });
});
