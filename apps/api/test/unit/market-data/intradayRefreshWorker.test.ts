import { describe, expect, it, vi } from "vitest";
import {
  createIntradayRefreshHandler,
  enqueueIntradayRefresh,
  intradayRefreshSingletonKey,
} from "../../../src/services/market-data/intradayRefreshWorker.js";
import { RateLimitedError } from "../../../src/services/market-data/types.js";

describe("intradayRefreshWorker", () => {
  const overlay = {
    ticker: "AAPL",
    marketCode: "US",
    price: 212.45,
    previousClose: 211.8,
    asOfDate: "2026-06-17",
    asOfTimestamp: "2026-06-17T15:05:00.000Z",
    observedAt: "2026-06-17T15:05:10.000Z",
    sourceKind: "intraday_yahoo_chart" as const,
    source: "yahoo-finance-chart",
    currency: "USD",
  };

  it("uses a worker-level request budget seam instead of a process-local provider limiter", async () => {
    const requestBudget = {
      tryConsume: vi.fn().mockResolvedValue({ allowed: true as const }),
    };
    const cache = { setLatest: vi.fn().mockResolvedValue(undefined) };
    const fetchOverlay = vi.fn().mockResolvedValue(overlay);
    const handler = createIntradayRefreshHandler({
      requestBudget,
      cache,
      fetchOverlay,
      log: { info: vi.fn(), warn: vi.fn() },
    });

    await handler([{ id: "job-1", data: { ticker: "AAPL", marketCode: "US", requestedAt: overlay.observedAt } }] as never);

    expect(requestBudget.tryConsume).toHaveBeenCalledWith(1);
    expect(fetchOverlay).toHaveBeenCalledWith(expect.objectContaining({ ticker: "AAPL", marketCode: "US" }));
    expect(cache.setLatest).toHaveBeenCalledWith(expect.objectContaining({ sourceKind: "intraday_yahoo_chart" }));
  });

  it("rethrows budget exhaustion as RateLimitedError for queue-level retry handling", async () => {
    const handler = createIntradayRefreshHandler({
      requestBudget: {
        tryConsume: vi.fn().mockResolvedValue({ allowed: false as const, retryAfterMs: 42_000 }),
      },
      cache: { setLatest: vi.fn() },
      fetchOverlay: vi.fn(),
      log: { info: vi.fn(), warn: vi.fn() },
    });

    await expect(
      handler([{ id: "job-2", data: { ticker: "2330", marketCode: "TW", requestedAt: overlay.observedAt } }] as never),
    ).rejects.toBeInstanceOf(RateLimitedError);
  });

  it("uses singleton keys per market+ticker and no-ops when no boss is available", async () => {
    expect(intradayRefreshSingletonKey("2330", "TW")).toBe("intraday-refresh:TW:2330");
    await expect(
      enqueueIntradayRefresh(null, { ticker: "2330", marketCode: "TW", requestedAt: overlay.observedAt }),
    ).resolves.toBeNull();
  });
});
