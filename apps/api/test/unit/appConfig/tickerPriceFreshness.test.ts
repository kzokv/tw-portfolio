import { describe, expect, it } from "vitest";
import { APP_CONFIG_BOUNDS } from "../../../src/services/appConfig/bounds.js";
import {
  DEFAULT_TICKER_PRICE_FRESHNESS_CONFIG,
  resolveTickerPriceFreshnessConfig,
} from "../../../src/services/appConfig/tickerPriceFreshness.js";

describe("appConfig/tickerPriceFreshness", () => {
  it("resolves grouped defaults when row overrides are absent", () => {
    const resolved = resolveTickerPriceFreshnessConfig({}, APP_CONFIG_BOUNDS);

    expect(resolved.effectiveCloseRefreshGraceMinutes).toBe(
      DEFAULT_TICKER_PRICE_FRESHNESS_CONFIG.closeRefreshGraceMinutes,
    );
    expect(resolved.effectiveIntradayEnabled).toBe(true);
    expect(resolved.effectiveIntradayRefreshIntervalMinutes).toBe(5);
    expect(resolved.effectiveIntradayFreshnessToleranceMinutes).toBe(20);
    expect(resolved.effectiveSupportedMarkets).toEqual(["TW", "US", "AU", "KR"]);
    expect(resolved.effectiveYahooChartRange).toBe(DEFAULT_TICKER_PRICE_FRESHNESS_CONFIG.yahooChartRange);
    expect(resolved.effectiveYahooChartInterval).toBe("1m");
    expect(resolved.bounds.syncTickerCap).toEqual(APP_CONFIG_BOUNDS.tickerPriceSyncTickerCap);
  });

  it("preserves explicit overrides and constrained options", () => {
    const resolved = resolveTickerPriceFreshnessConfig({
      tickerPriceCloseRefreshGraceMinutes: 45,
      tickerPriceIntradayEnabled: false,
      tickerPriceIntradayRefreshIntervalMinutes: 7,
      tickerPriceIntradayFreshnessToleranceMinutes: 30,
      tickerPriceYahooChartRequestLimitPerMinute: 240,
      tickerPriceQueueConcurrency: 8,
      tickerPriceMaxTickersPerRefreshCycle: 250,
      tickerPriceSupportedMarkets: ["TW", "US"],
      tickerPriceRegularSessionOnly: true,
      tickerPriceYahooChartRange: "5d",
      tickerPriceYahooChartInterval: "15m",
      tickerPriceRefreshCloseRateLimitWindowMs: 300_000,
      tickerPriceRefreshCloseRateLimitMax: 12,
      tickerPriceSyncTickerCap: 40,
    }, APP_CONFIG_BOUNDS);

    expect(resolved.closeRefreshGraceMinutes).toBe(45);
    expect(resolved.effectiveIntradayEnabled).toBe(false);
    expect(resolved.effectiveIntradayRefreshIntervalMinutes).toBe(7);
    expect(resolved.effectiveIntradayFreshnessToleranceMinutes).toBe(30);
    expect(resolved.effectiveSupportedMarkets).toEqual(["TW", "US"]);
    expect(resolved.effectiveYahooChartRange).toBe("5d");
    expect(resolved.effectiveYahooChartInterval).toBe("15m");
    expect(resolved.options.yahooChartRanges).toEqual(["1d", "5d"]);
    expect(resolved.options.yahooChartIntervals).toEqual(["1m", "2m", "5m", "15m"]);
  });
});
