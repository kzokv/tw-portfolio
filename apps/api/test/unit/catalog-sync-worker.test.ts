import { describe, expect, it, vi } from "vitest";
import type { JobWithMetadata } from "pg-boss";
import { createCatalogSyncHandler, CATALOG_SYNC_QUEUE } from "../../src/services/market-data/registerCatalogSyncWorker.js";

function createJob(data: Record<string, never> = {}): JobWithMetadata<Record<string, never>> {
  return {
    data,
    retryCount: 0,
    retryLimit: 3,
  } as JobWithMetadata<Record<string, never>>;
}

describe("catalog sync worker", () => {
  it("runs catalog sync and then enqueues the daily refresh chain", async () => {
    const boss = { send: vi.fn().mockResolvedValue(undefined) };
    const rateLimiter = {
      canConsume: vi.fn().mockReturnValue(true),
      consume: vi.fn(),
      msUntilAvailable: vi.fn(),
    };
    const persistence = {
      upsertInstrumentCatalog: vi.fn(),
      getAllMonitoredTickers: vi.fn(),
      createRefreshBatch: vi.fn(),
    };
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const runCatalogSyncFn = vi.fn().mockResolvedValue({ upserted: 3, delisted: 1 });
    const enqueueDailyRefreshFn = vi.fn().mockResolvedValue(2);

    const handler = createCatalogSyncHandler({
      boss,
      rateLimiter: rateLimiter as never,
      persistence,
      log,
      runCatalogSyncFn,
      enqueueDailyRefreshFn,
      finmind: {} as never,
    });

    await handler([createJob()]);

    expect(runCatalogSyncFn).toHaveBeenCalledWith(
      expect.objectContaining({
        boss,
        persistence,
        rateLimiter,
        log,
      }),
    );
    expect(enqueueDailyRefreshFn).toHaveBeenCalledWith(boss, persistence, log);
  });

  it("still enqueues daily refresh when catalog sync fails", async () => {
    const boss = { send: vi.fn().mockResolvedValue(undefined) };
    const rateLimiter = {
      canConsume: vi.fn().mockReturnValue(true),
      consume: vi.fn(),
      msUntilAvailable: vi.fn(),
    };
    const persistence = {
      upsertInstrumentCatalog: vi.fn(),
      getAllMonitoredTickers: vi.fn(),
      createRefreshBatch: vi.fn(),
    };
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const runCatalogSyncFn = vi.fn().mockRejectedValue(new Error("catalog exploded"));
    const enqueueDailyRefreshFn = vi.fn().mockResolvedValue(2);

    const handler = createCatalogSyncHandler({
      boss,
      rateLimiter: rateLimiter as never,
      persistence,
      log,
      runCatalogSyncFn,
      enqueueDailyRefreshFn,
      finmind: {} as never,
    });

    await expect(handler([createJob()])).rejects.toThrow("catalog exploded");
    expect(enqueueDailyRefreshFn).toHaveBeenCalledWith(boss, persistence, log);
  });

  it("reschedules instead of running when the rate limit budget is exhausted", async () => {
    const boss = { send: vi.fn().mockResolvedValue(undefined) };
    const rateLimiter = {
      canConsume: vi.fn().mockReturnValue(false),
      msUntilAvailable: vi.fn().mockReturnValue(60_000),
    };
    const persistence = {
      upsertInstrumentCatalog: vi.fn(),
      getAllMonitoredTickers: vi.fn(),
      createRefreshBatch: vi.fn(),
    };
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const runCatalogSyncFn = vi.fn();
    const enqueueDailyRefreshFn = vi.fn();

    const handler = createCatalogSyncHandler({
      boss,
      rateLimiter: rateLimiter as never,
      persistence,
      log,
      runCatalogSyncFn,
      enqueueDailyRefreshFn,
      finmind: {} as never,
    });

    await handler([createJob()]);

    expect(boss.send).toHaveBeenCalledWith(
      CATALOG_SYNC_QUEUE,
      {},
      { startAfter: 60, singletonKey: CATALOG_SYNC_QUEUE, priority: 0 },
    );
    expect(runCatalogSyncFn).not.toHaveBeenCalled();
    expect(enqueueDailyRefreshFn).not.toHaveBeenCalled();
  });
});
