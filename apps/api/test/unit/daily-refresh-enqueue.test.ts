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
    const persistence = { getAllMonitoredTickers: vi.fn().mockResolvedValue(["0050", "2330"]) };
    const log = { info: vi.fn() };

    const count = await enqueueDailyRefresh(boss, persistence, log);

    expect(count).toBe(2);
    expect(boss.send).toHaveBeenCalledTimes(2);
    expect(boss.send).toHaveBeenCalledWith(
      BACKFILL_QUEUE,
      { ticker: "0050", trigger: "daily_refresh", startDate: "2026-03-24" },
      { priority: DAILY_REFRESH_PRIORITY, singletonKey: "0050" },
    );
    expect(boss.send).toHaveBeenCalledWith(
      BACKFILL_QUEUE,
      { ticker: "2330", trigger: "daily_refresh", startDate: "2026-03-24" },
      { priority: DAILY_REFRESH_PRIORITY, singletonKey: "2330" },
    );
  });

  it("skips enqueueing when no monitored tickers are eligible", async () => {
    const boss = { send: vi.fn().mockResolvedValue(undefined) };
    const persistence = { getAllMonitoredTickers: vi.fn().mockResolvedValue([]) };
    const log = { info: vi.fn() };

    const count = await enqueueDailyRefresh(boss, persistence, log);

    expect(count).toBe(0);
    expect(boss.send).not.toHaveBeenCalled();
  });

  it("computes the lookback start date using the configured day window", () => {
    const now = new Date("2026-03-31T23:59:59Z");

    expect(DAILY_REFRESH_LOOKBACK_DAYS).toBe(7);
    expect(getDailyRefreshStartDate(now)).toBe("2026-03-24");
  });
});
