import { describe, expect, it, vi } from "vitest";
import { runCloseRefresh } from "../../../src/services/market-data/closeRefreshService.js";
import { RateLimitedError, type MarketDataProvider, type RawDailyBar } from "../../../src/services/market-data/types.js";

function rawBar(input: Partial<RawDailyBar> = {}): RawDailyBar {
  return {
    ticker: "2330",
    barDate: "2026-06-17",
    open: 1000,
    high: 1015,
    low: 995,
    close: 1010,
    volume: 12_345,
    sourceId: "primary",
    ...input,
  };
}

function provider(fetchBars = vi.fn().mockResolvedValue([rawBar()])): MarketDataProvider {
  return {
    providerId: "primary",
    fetchBars,
    fetchDividends: vi.fn().mockResolvedValue([]),
    reserveCapacity: vi.fn().mockResolvedValue(undefined),
  };
}

describe("closeRefreshService", () => {
  it("uses the primary daily provider before close-only fallbacks", async () => {
    const upsertBars = vi.fn().mockResolvedValue(undefined);
    const twseStockDay = { fetchCloseOnlyBar: vi.fn() };
    const result = await runCloseRefresh({
      pairs: [{ ticker: "2330", marketCode: "TW" }],
      persistence: { getLatestBarsByTickerMarket: vi.fn().mockResolvedValue([]) },
      tradingCalendar: { isTradingDay: vi.fn().mockResolvedValue(true) },
      marketDataProviders: new Map([["TW", provider()]]),
      fallbackProviders: { twseStockDay },
      upsertBars,
      closeRefreshGraceMinutes: 0,
      supportedMarkets: ["TW", "US", "AU", "KR"],
      now: new Date("2026-06-17T05:45:00.000Z"),
      log: { info: vi.fn(), warn: vi.fn() },
    });

    expect(result.summary.refreshed).toBe(1);
    expect(upsertBars).toHaveBeenCalledWith(
      [expect.objectContaining({ quality: "full_bar", source: "primary" })],
      "TW",
    );
    expect(twseStockDay.fetchCloseOnlyBar).not.toHaveBeenCalled();
  });

  it("falls back to TWSE close-only for TW when the primary provider has no bar", async () => {
    const closeOnlyBar = {
      ticker: "2330",
      barDate: "2026-06-17",
      open: 1010,
      high: 1010,
      low: 1010,
      close: 1010,
      volume: 0,
      quality: "close_only" as const,
      source: "twse-stock-day-close",
      ingestedAt: "2026-06-17T06:00:00.000Z",
    };
    const upsertBars = vi.fn().mockResolvedValue(undefined);
    const result = await runCloseRefresh({
      pairs: [{ ticker: "2330", marketCode: "TW" }],
      persistence: { getLatestBarsByTickerMarket: vi.fn().mockResolvedValue([]) },
      tradingCalendar: { isTradingDay: vi.fn().mockResolvedValue(true) },
      marketDataProviders: new Map([["TW", provider(vi.fn().mockResolvedValue([]))]]),
      fallbackProviders: {
        twseStockDay: { fetchCloseOnlyBar: vi.fn().mockResolvedValue(closeOnlyBar) },
        yahooChartClose: { fetchCloseOnlyBar: vi.fn() },
      },
      upsertBars,
      closeRefreshGraceMinutes: 0,
      supportedMarkets: ["TW", "US", "AU", "KR"],
      now: new Date("2026-06-17T05:45:00.000Z"),
      log: { info: vi.fn(), warn: vi.fn() },
    });

    expect(result.items[0]).toMatchObject({
      status: "refreshed",
      source: "twse-stock-day-close",
      quality: "close_only",
    });
    expect(upsertBars).toHaveBeenCalledWith([closeOnlyBar], "TW");
  });

  it("skips provider calls when an existing daily bar already covers the close date", async () => {
    const fetchBars = vi.fn();
    const result = await runCloseRefresh({
      pairs: [{ ticker: "AAPL", marketCode: "US" }],
      persistence: {
        getLatestBarsByTickerMarket: vi.fn().mockResolvedValue([{
          ...rawBar({ ticker: "AAPL", sourceId: "primary" }),
          marketCode: "US",
          source: "primary",
          quality: "full_bar",
          ingestedAt: "2026-06-17T21:00:00.000Z",
        }]),
      },
      tradingCalendar: { isTradingDay: vi.fn().mockResolvedValue(true) },
      marketDataProviders: new Map([["US", provider(fetchBars)]]),
      upsertBars: vi.fn(),
      closeRefreshGraceMinutes: 0,
      supportedMarkets: ["TW", "US", "AU", "KR"],
      now: new Date("2026-06-17T21:00:00.000Z"),
      log: { info: vi.fn(), warn: vi.fn() },
    });

    expect(result.items[0]).toMatchObject({ status: "current", barDate: "2026-06-17" });
    expect(fetchBars).not.toHaveBeenCalled();
  });

  it("refreshes an existing close-only row so it can upgrade to a full bar", async () => {
    const fullBar = rawBar({ sourceId: "primary", volume: 54_321 });
    const fetchBars = vi.fn().mockResolvedValue([fullBar]);
    const upsertBars = vi.fn();
    const result = await runCloseRefresh({
      pairs: [{ ticker: "2330", marketCode: "TW" }],
      persistence: {
        getLatestBarsByTickerMarket: vi.fn().mockResolvedValue([{
          ...rawBar({ sourceId: "twse-stock-day-close", volume: 0 }),
          marketCode: "TW",
          source: "twse-stock-day-close",
          quality: "close_only",
          ingestedAt: "2026-06-17T06:00:00.000Z",
        }]),
      },
      tradingCalendar: { isTradingDay: vi.fn().mockResolvedValue(true) },
      marketDataProviders: new Map([["TW", provider(fetchBars)]]),
      fallbackProviders: {
        twseStockDay: { fetchCloseOnlyBar: vi.fn() },
      },
      upsertBars,
      closeRefreshGraceMinutes: 0,
      supportedMarkets: ["TW", "US", "AU", "KR"],
      now: new Date("2026-06-17T05:45:00.000Z"),
      log: { info: vi.fn(), warn: vi.fn() },
    });

    expect(fetchBars).toHaveBeenCalledWith("2330", "2026-06-17", "2026-06-17");
    expect(result.items[0]).toMatchObject({
      status: "refreshed",
      barDate: "2026-06-17",
      quality: "full_bar",
      source: "primary",
    });
    expect(upsertBars).toHaveBeenCalledWith(
      [expect.objectContaining({ quality: "full_bar", volume: 54_321 })],
      "TW",
    );
  });

  it("rethrows provider rate limits so the close-refresh worker can retry the job", async () => {
    const rateLimitError = new RateLimitedError({ msUntilAvailable: 30_000 });
    const warn = vi.fn();
    await expect(runCloseRefresh({
      pairs: [{ ticker: "2330", marketCode: "TW" }],
      persistence: { getLatestBarsByTickerMarket: vi.fn().mockResolvedValue([]) },
      tradingCalendar: { isTradingDay: vi.fn().mockResolvedValue(true) },
      marketDataProviders: new Map([["TW", provider(vi.fn().mockRejectedValue(rateLimitError))]]),
      fallbackProviders: {
        twseStockDay: { fetchCloseOnlyBar: vi.fn() },
      },
      upsertBars: vi.fn(),
      closeRefreshGraceMinutes: 0,
      supportedMarkets: ["TW", "US", "AU", "KR"],
      now: new Date("2026-06-17T05:45:00.000Z"),
      log: { info: vi.fn(), warn },
    })).rejects.toBe(rateLimitError);

    expect(warn).not.toHaveBeenCalledWith(
      expect.anything(),
      "close_refresh_pair_failed",
    );
  });

  it("emits activity rows for refreshed and missing close-refresh outcomes", async () => {
    const activity = { createMarketCalendarActivityEvent: vi.fn().mockResolvedValue({}) };

    const refreshed = await runCloseRefresh({
      pairs: [{ ticker: "2330", marketCode: "TW" }],
      persistence: { getLatestBarsByTickerMarket: vi.fn().mockResolvedValue([]) },
      activityPersistence: activity as never,
      tradingCalendar: { isTradingDay: vi.fn().mockResolvedValue(true) },
      marketDataProviders: new Map([["TW", provider()]]),
      upsertBars: vi.fn(),
      closeRefreshGraceMinutes: 0,
      supportedMarkets: ["TW", "US", "AU", "KR"],
      now: new Date("2026-06-17T05:45:00.000Z"),
      log: { info: vi.fn(), warn: vi.fn() },
    });
    expect(refreshed.items[0]?.status).toBe("refreshed");
    expect(activity.createMarketCalendarActivityEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "close_refresh_refreshed",
      category: "daily_close",
      result: "success",
      source: "system",
    }));

    activity.createMarketCalendarActivityEvent.mockClear();
    const missing = await runCloseRefresh({
      pairs: [{ ticker: "2330", marketCode: "TW" }],
      persistence: { getLatestBarsByTickerMarket: vi.fn().mockResolvedValue([]) },
      activityPersistence: activity as never,
      tradingCalendar: { isTradingDay: vi.fn().mockResolvedValue(true) },
      marketDataProviders: new Map([["TW", provider(vi.fn().mockResolvedValue([]))]]),
      fallbackProviders: {
        twseStockDay: { fetchCloseOnlyBar: vi.fn().mockResolvedValue(null) },
        yahooChartClose: { fetchCloseOnlyBar: vi.fn().mockResolvedValue(null) },
      },
      upsertBars: vi.fn(),
      closeRefreshGraceMinutes: 0,
      supportedMarkets: ["TW", "US", "AU", "KR"],
      now: new Date("2026-06-17T05:45:00.000Z"),
      log: { info: vi.fn(), warn: vi.fn() },
    });
    expect(missing.items[0]?.status).toBe("missing");
    expect(activity.createMarketCalendarActivityEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "close_refresh_missing",
      category: "daily_close",
      result: "warning",
    }));
  });
});
