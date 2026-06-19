import type { IntradayPriceOverlay, MarketCode } from "@vakwen/domain";
import { describe, expect, it, vi } from "vitest";
import {
  enqueueDemandIntradayRefreshes,
  type IntradayDemandRefreshInput,
} from "../../../src/services/market-data/intradayDemandRefresh.js";

const effectiveConfig: IntradayDemandRefreshInput["config"] = {
  closeRefreshGraceMinutes: 180,
  intradayEnabled: true,
  intradayRefreshIntervalMinutes: 5,
  intradayFreshnessToleranceMinutes: 20,
  yahooChartRequestLimitPerMinute: 120,
  queueConcurrency: 4,
  maxTickersPerRefreshCycle: 10,
  supportedMarkets: ["TW", "US", "AU", "KR"],
  regularSessionOnly: true,
  yahooChartRange: "5d",
  yahooChartInterval: "1m",
  refreshCloseRateLimitWindowMs: 60_000,
  refreshCloseRateLimitMax: 10,
  syncTickerCap: 25,
  activityDetailedRetentionDays: 7,
  activitySummaryRetentionDays: 90,
  calendarHistoryRetentionDays: 730,
};

function overlay(input: Partial<IntradayPriceOverlay> = {}): IntradayPriceOverlay {
  return {
    ticker: "2330",
    marketCode: "TW",
    price: 1010,
    previousClose: 1000,
    asOfDate: "2026-06-17",
    asOfTimestamp: "2026-06-17T02:24:00.000Z",
    observedAt: "2026-06-17T02:28:00.000Z",
    sourceKind: "intraday_yahoo_chart",
    source: "yahoo-finance-chart",
    currency: "TWD",
    ...input,
  };
}

function persistenceWithOverlays(overlays: Map<string, IntradayPriceOverlay>) {
  return {
    getLatestIntradayOverlay: vi.fn(),
    getLatestIntradayOverlays: vi.fn().mockResolvedValue(overlays),
    setLatestIntradayOverlay: vi.fn(),
    deleteLatestIntradayOverlay: vi.fn(),
    createMarketCalendarActivityEvent: vi.fn(),
  };
}

describe("intradayDemandRefresh", () => {
  it("enqueues only missing or cadence-stale held pairs while their market is open", async () => {
    const send = vi.fn().mockResolvedValue("job-1");
    const result = await enqueueDemandIntradayRefreshes({
      pairs: [
        { ticker: "2330", marketCode: "TW" },
        { ticker: "2330", marketCode: "TW" },
        { ticker: "2317", marketCode: "TW" },
        { ticker: "AAPL", marketCode: "US" },
        { ticker: "7203", marketCode: "JP" as MarketCode },
      ],
      boss: { send },
      persistence: persistenceWithOverlays(new Map([
        ["2330:TW", overlay({ ticker: "2330", observedAt: "2026-06-17T02:28:00.000Z" })],
      ])),
      tradingCalendar: { isTradingDay: vi.fn().mockResolvedValue(true) },
      log: { info: vi.fn(), warn: vi.fn() },
      now: new Date("2026-06-17T02:30:00.000Z"),
      config: effectiveConfig,
    });

    expect(result).toMatchObject({
      considered: 3,
      open: 2,
      staleOrMissing: 1,
      enqueued: 1,
    });
    expect(send).toHaveBeenCalledWith(
      "intraday-refresh",
      expect.objectContaining({ ticker: "2317", marketCode: "TW" }),
      expect.objectContaining({ singletonKey: "intraday-refresh:TW:2317" }),
    );
  });

  it("respects the per-cycle cap before enqueueing", async () => {
    const send = vi.fn().mockResolvedValue("job-1");
    const result = await enqueueDemandIntradayRefreshes({
      pairs: [
        { ticker: "2330", marketCode: "TW" },
        { ticker: "2317", marketCode: "TW" },
      ],
      boss: { send },
      persistence: persistenceWithOverlays(new Map()),
      tradingCalendar: { isTradingDay: vi.fn().mockResolvedValue(true) },
      log: { info: vi.fn(), warn: vi.fn() },
      now: new Date("2026-06-17T02:30:00.000Z"),
      config: { ...effectiveConfig, maxTickersPerRefreshCycle: 1 },
    });

    expect(result.staleOrMissing).toBe(2);
    expect(result.capped).toBe(1);
    expect(result.enqueued).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("degrades to daily bars when pg-boss is unavailable", async () => {
    const log = { info: vi.fn(), warn: vi.fn() };
    const result = await enqueueDemandIntradayRefreshes({
      pairs: [{ ticker: "2330", marketCode: "TW" }],
      boss: null,
      persistence: persistenceWithOverlays(new Map()),
      tradingCalendar: { isTradingDay: vi.fn().mockResolvedValue(true) },
      log,
      now: new Date("2026-06-17T02:30:00.000Z"),
      config: effectiveConfig,
    });

    expect(result).toMatchObject({ queueUnavailable: 1, enqueued: 0 });
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ pairCount: 1 }),
      "intraday_demand_refresh_queue_unavailable",
    );
  });

  it("enqueues trading-day after-hours pairs when regular-session-only is disabled", async () => {
    const send = vi.fn().mockResolvedValue("job-1");
    const result = await enqueueDemandIntradayRefreshes({
      pairs: [{ ticker: "2330", marketCode: "TW" }],
      boss: { send },
      persistence: persistenceWithOverlays(new Map()),
      tradingCalendar: { isTradingDay: vi.fn().mockResolvedValue(true) },
      log: { info: vi.fn(), warn: vi.fn() },
      now: new Date("2026-06-17T07:00:00.000Z"),
      config: { ...effectiveConfig, regularSessionOnly: false },
    });

    expect(result).toMatchObject({
      considered: 1,
      open: 1,
      staleOrMissing: 1,
      enqueued: 1,
    });
    expect(send).toHaveBeenCalledWith(
      "intraday-refresh",
      expect.objectContaining({ ticker: "2330", marketCode: "TW" }),
      expect.objectContaining({ singletonKey: "intraday-refresh:TW:2330" }),
    );
  });

  it("does not enqueue when current-day calendar coverage is missing for the market year", async () => {
    const send = vi.fn().mockResolvedValue("job-1");
    const persistence = persistenceWithOverlays(new Map());
    const result = await enqueueDemandIntradayRefreshes({
      pairs: [{ ticker: "2330", marketCode: "TW" }],
      boss: { send },
      persistence,
      tradingCalendar: {
        isTradingDay: vi.fn().mockResolvedValue(false),
        getOfficialCalendarDayStatus: vi.fn().mockResolvedValue({
          localDate: "2026-06-17",
          calendarYear: 2026,
          status: "calendar_unknown",
          reason: "calendar_unknown",
        }),
      },
      log: { info: vi.fn(), warn: vi.fn() },
      now: new Date("2026-06-17T02:30:00.000Z"),
      config: effectiveConfig,
    });

    expect(result).toMatchObject({
      considered: 1,
      open: 0,
      staleOrMissing: 0,
      enqueued: 0,
      calendarUnknownSkips: 1,
    });
    expect(send).not.toHaveBeenCalled();
    expect(persistence.createMarketCalendarActivityEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        marketCode: "TW",
        eventType: "calendar_unknown_intraday_skip",
        result: "skipped",
      }),
    );
  });
});
