import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BACKFILL_QUEUE } from "../../src/services/market-data/backfillWorker.js";
import {
  DAILY_REFRESH_LOOKBACK_DAYS,
  DAILY_REFRESH_PRIORITY,
  enqueueDailyRefresh,
  getDailyRefreshStartDate,
} from "../../src/services/market-data/dailyRefreshEnqueue.js";

describe("daily refresh enqueue", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("enqueues one high-priority backfill job per monitored ticker", async () => {
    vi.setSystemTime(new Date("2026-03-31T09:30:00Z"));
    const boss = { send: vi.fn().mockResolvedValue(undefined) };
    const batchId = "batch-001";
    const persistence = {
      // KZO-185: getAllMonitoredTickers returns `{ticker, marketCode}` pairs.
      getAllMonitoredTickers: vi.fn().mockResolvedValue([
        { ticker: "0050", marketCode: "TW" },
        { ticker: "2330", marketCode: "TW" },
      ]),
      createRefreshBatch: vi.fn().mockResolvedValue(batchId),
    };
    const log = { info: vi.fn() };

    const result = await enqueueDailyRefresh(boss, persistence, log);

    expect(result.tickerCount).toBe(2);
    expect(persistence.createRefreshBatch).toHaveBeenCalledWith(null, 2);
    expect(boss.send).toHaveBeenCalledTimes(2);
    // KZO-185: producer stamps `marketCode` and uses composite singletonKey
    // `${ticker}:${marketCode}`.
    expect(boss.send).toHaveBeenCalledWith(
      BACKFILL_QUEUE,
      { ticker: "0050", marketCode: "TW", trigger: "daily_refresh", startDate: "2026-03-24", batchId },
      { priority: DAILY_REFRESH_PRIORITY, singletonKey: "0050:TW" },
    );
    expect(boss.send).toHaveBeenCalledWith(
      BACKFILL_QUEUE,
      { ticker: "2330", marketCode: "TW", trigger: "daily_refresh", startDate: "2026-03-24", batchId },
      { priority: DAILY_REFRESH_PRIORITY, singletonKey: "2330:TW" },
    );
  });

  it("skips enqueueing when no monitored tickers are eligible", async () => {
    const boss = { send: vi.fn().mockResolvedValue(undefined) };
    const persistence = {
      getAllMonitoredTickers: vi.fn().mockResolvedValue([]),
      createRefreshBatch: vi.fn(),
    };
    const log = { info: vi.fn() };

    const result = await enqueueDailyRefresh(boss, persistence, log);

    expect(result.tickerCount).toBe(0);
    expect(boss.send).not.toHaveBeenCalled();
  });

  it("computes the lookback start date using the configured day window", () => {
    const now = new Date("2026-03-31T23:59:59Z");

    expect(DAILY_REFRESH_LOOKBACK_DAYS).toBe(7);
    expect(getDailyRefreshStartDate(now)).toBe("2026-03-24");
  });

  // KZO-185 (D2): cross-market tickers must produce independent singleton keys
  // so BHP/AU and BHP/US don't collide in the pg-boss singleton namespace.
  // Validates that the composite `${ticker}:${marketCode}` singletonKey is correct
  // when the same ticker string appears in different markets.
  it("cross-market tickers produce independent composite singletonKeys", async () => {
    vi.setSystemTime(new Date("2026-03-31T09:30:00Z"));
    const boss = { send: vi.fn().mockResolvedValue(undefined) };
    const batchId = "batch-cross-002";
    const persistence = {
      getAllMonitoredTickers: vi.fn().mockResolvedValue([
        { ticker: "BHP", marketCode: "AU" },
        { ticker: "BHP", marketCode: "US" },
      ]),
      createRefreshBatch: vi.fn().mockResolvedValue(batchId),
    };
    const log = { info: vi.fn() };

    const result = await enqueueDailyRefresh(boss, persistence, log);

    expect(result.tickerCount).toBe(2);
    // Two distinct jobs: AU and US have separate singleton slots.
    expect(boss.send).toHaveBeenCalledWith(
      BACKFILL_QUEUE,
      { ticker: "BHP", marketCode: "AU", trigger: "daily_refresh", startDate: "2026-03-24", batchId },
      { priority: DAILY_REFRESH_PRIORITY, singletonKey: "BHP:AU" },
    );
    expect(boss.send).toHaveBeenCalledWith(
      BACKFILL_QUEUE,
      { ticker: "BHP", marketCode: "US", trigger: "daily_refresh", startDate: "2026-03-24", batchId },
      { priority: DAILY_REFRESH_PRIORITY, singletonKey: "BHP:US" },
    );
  });
});
