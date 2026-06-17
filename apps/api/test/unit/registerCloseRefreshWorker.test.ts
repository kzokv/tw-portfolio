import { describe, expect, it, vi } from "vitest";
import {
  buildCloseRefreshWorkerConfig,
  registerCloseRefreshWorker,
} from "../../src/services/market-data/registerCloseRefreshWorker.js";
import {
  CLOSE_REFRESH_QUEUE,
  CLOSE_REFRESH_SCHEDULE_CRON,
} from "../../src/services/market-data/closeRefreshWorker.js";

describe("registerCloseRefreshWorker", () => {
  it("maps effective ticker price freshness config into worker runtime settings", () => {
    expect(buildCloseRefreshWorkerConfig({ queueConcurrency: 5 })).toEqual({
      concurrency: 5,
      retryLimit: 5,
      retryDelaySeconds: 60,
      retryBackoff: true,
      expireInSeconds: 1800,
    });
  });

  it("registers the queue, worker, and scheduled close-refresh scan", async () => {
    const boss = {
      createQueue: vi.fn().mockResolvedValue(undefined),
      work: vi.fn().mockResolvedValue(undefined),
      schedule: vi.fn().mockResolvedValue(undefined),
    };
    const config = buildCloseRefreshWorkerConfig({ queueConcurrency: 3 });

    await registerCloseRefreshWorker(
      boss as never,
      config,
      {
        persistence: { getLatestBarsByTickerMarket: vi.fn(), listHeldTickerMarketPairs: vi.fn() },
        tradingCalendar: { isTradingDay: vi.fn() },
        marketDataProviders: new Map(),
        upsertBars: vi.fn(),
        closeRefreshGraceMinutes: 10,
        supportedMarkets: ["TW", "US", "AU", "KR"],
        log: { info: vi.fn(), warn: vi.fn() },
      } as never,
    );

    expect(boss.createQueue).toHaveBeenCalledWith(
      CLOSE_REFRESH_QUEUE,
      expect.objectContaining({ retryLimit: 5, retryDelay: 60, expireInSeconds: 1800 }),
    );
    expect(boss.work).toHaveBeenCalledWith(
      CLOSE_REFRESH_QUEUE,
      expect.objectContaining({ batchSize: 1, includeMetadata: true, teamSize: 3 }),
      expect.any(Function),
    );
    expect(boss.schedule).toHaveBeenCalledWith(
      CLOSE_REFRESH_QUEUE,
      CLOSE_REFRESH_SCHEDULE_CRON,
      { kind: "scheduled_scan" },
    );
  });
});
