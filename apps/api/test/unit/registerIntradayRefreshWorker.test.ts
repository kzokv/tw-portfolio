import { describe, expect, it, vi } from "vitest";
import {
  buildIntradayRefreshWorkerConfig,
  registerIntradayRefreshWorker,
} from "../../src/services/market-data/registerIntradayRefreshWorker.js";
import { INTRADAY_REFRESH_QUEUE } from "../../src/services/market-data/intradayRefreshWorker.js";

describe("registerIntradayRefreshWorker", () => {
  it("maps effective ticker price freshness config into worker runtime settings", () => {
    expect(buildIntradayRefreshWorkerConfig({ queueConcurrency: 7 })).toEqual({
      concurrency: 7,
      maxRequestBudgetPerJob: 1,
      retryLimit: 20,
      retryDelaySeconds: 30,
      retryBackoff: true,
      expireInSeconds: 600,
    });
  });

  it("registers the queue with configured team size", async () => {
    const boss = {
      createQueue: vi.fn().mockResolvedValue(undefined),
      work: vi.fn().mockResolvedValue(undefined),
    };
    const config = buildIntradayRefreshWorkerConfig({ queueConcurrency: 4 });

    await registerIntradayRefreshWorker(
      boss as never,
      config,
      {
        cache: { setLatest: vi.fn() },
        fetchOverlay: vi.fn(),
        requestBudget: { tryConsume: vi.fn() },
        log: { info: vi.fn(), warn: vi.fn() },
      } as never,
    );

    expect(boss.createQueue).toHaveBeenCalledWith(
      INTRADAY_REFRESH_QUEUE,
      expect.objectContaining({ retryLimit: 20, retryDelay: 30, expireInSeconds: 600 }),
    );
    expect(boss.work).toHaveBeenCalledWith(
      INTRADAY_REFRESH_QUEUE,
      expect.objectContaining({ batchSize: 1, includeMetadata: true, teamSize: 4 }),
      expect.any(Function),
    );
  });
});
