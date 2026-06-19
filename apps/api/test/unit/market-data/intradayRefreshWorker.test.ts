import { describe, expect, it, vi } from "vitest";
import {
  createIntradayRefreshHandler,
  type IntradayRefreshWorkerDeps,
} from "../../../src/services/market-data/intradayRefreshWorker.js";
import { RateLimitedError } from "../../../src/services/market-data/types.js";

function workerDeps(overrides: Partial<IntradayRefreshWorkerDeps> = {}): IntradayRefreshWorkerDeps {
  return {
    cache: { setLatest: vi.fn().mockResolvedValue(undefined) },
    fetchOverlay: vi.fn().mockResolvedValue({
      ticker: "2330",
      marketCode: "TW",
      price: 1010,
      previousClose: 1000,
      asOfDate: "2026-06-19",
      asOfTimestamp: "2026-06-19T02:25:00.000Z",
      observedAt: "2026-06-19T02:26:00.000Z",
      sourceKind: "intraday_yahoo_chart",
      source: "yahoo-finance-chart",
      currency: "TWD",
    }),
    requestBudget: { tryConsume: vi.fn().mockResolvedValue({ allowed: true }) },
    persistence: { createMarketCalendarActivityEvent: vi.fn().mockResolvedValue({}) } as never,
    log: { info: vi.fn(), warn: vi.fn() },
    ...overrides,
  };
}

describe("intradayRefreshWorker", () => {
  it("emits started and completed activity events for successful Yahoo refreshes", async () => {
    const deps = workerDeps();

    await createIntradayRefreshHandler(deps)([{
      id: "job-1",
      data: { ticker: "2330", marketCode: "TW", requestedAt: "2026-06-19T02:20:00.000Z" },
    } as never]);

    expect(deps.persistence?.createMarketCalendarActivityEvent).toHaveBeenNthCalledWith(1, expect.objectContaining({
      eventType: "intraday_refresh_started",
      result: "success",
      jobId: "job-1",
      ticker: "2330",
    }));
    expect(deps.persistence?.createMarketCalendarActivityEvent).toHaveBeenNthCalledWith(2, expect.objectContaining({
      eventType: "intraday_refresh_completed",
      result: "success",
      jobId: "job-1",
      ticker: "2330",
    }));
  });

  it("emits rate-limited activity before retrying the job", async () => {
    const deps = workerDeps({
      requestBudget: { tryConsume: vi.fn().mockResolvedValue({ allowed: false, retryAfterMs: 30_000 }) },
    });

    await expect(createIntradayRefreshHandler(deps)([{
      id: "job-2",
      data: { ticker: "2330", marketCode: "TW", requestedAt: "2026-06-19T02:20:00.000Z" },
    } as never])).rejects.toBeInstanceOf(RateLimitedError);

    expect(deps.persistence?.createMarketCalendarActivityEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "intraday_refresh_rate_limited",
      result: "rate_limited",
      jobId: "job-2",
    }));
  });

  it("emits warning and error activity for missing quotes and worker failures", async () => {
    const missingDeps = workerDeps({
      fetchOverlay: vi.fn().mockResolvedValue(null),
    });
    await createIntradayRefreshHandler(missingDeps)([{
      id: "job-3",
      data: { ticker: "2330", marketCode: "TW", requestedAt: "2026-06-19T02:20:00.000Z" },
    } as never]);
    expect(missingDeps.persistence?.createMarketCalendarActivityEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "intraday_refresh_no_same_day_quote",
      result: "warning",
      jobId: "job-3",
    }));

    const failedDeps = workerDeps({
      fetchOverlay: vi.fn().mockRejectedValue(new Error("yahoo exploded")),
    });
    await expect(createIntradayRefreshHandler(failedDeps)([{
      id: "job-4",
      data: { ticker: "2330", marketCode: "TW", requestedAt: "2026-06-19T02:20:00.000Z" },
    } as never])).rejects.toThrow("yahoo exploded");
    expect(failedDeps.persistence?.createMarketCalendarActivityEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "intraday_refresh_failed",
      result: "error",
      jobId: "job-4",
    }));
  });
});
