import { describe, expect, it, vi } from "vitest";
import type { JobWithMetadata } from "pg-boss";
import { createCatalogSyncHandler, CATALOG_SYNC_QUEUE } from "../../src/services/market-data/registerCatalogSyncWorker.js";
import { RateLimitedError } from "../../src/services/market-data/types.js";

function createJob(data: Record<string, never> = {}): JobWithMetadata<Record<string, never>> {
  return {
    data,
    retryCount: 0,
    retryLimit: 3,
  } as JobWithMetadata<Record<string, never>>;
}

function createDeps() {
  const boss = { send: vi.fn().mockResolvedValue(undefined) };
  // KZO-163: catalogRegistry replaces the finmind+rateLimiter deps. The provider's internal
  // rate limiter signals exhaustion via RateLimitedError; the worker catches and reschedules.
  // `reserveCapacity` defaults to a no-op; tests targeting the pre-flight starvation guard
  // override it to throw RateLimitedError before runCatalogSync runs.
  const catalogProvider = {
    reserveCapacity: vi.fn(),
    fetchInstrumentCatalog: vi.fn(),
    fetchDelistingHistory: vi.fn(),
    // KZO-190 — interface contract: every InstrumentCatalogProvider declares whether
    // its `fetchInstrumentMetadata` consumes a rate-limit slot. The catalog sync
    // handler does not read this field, but the mock satisfies the interface so
    // future code paths (or accidental same-mock reuse in metadata-aware tests)
    // see a correct value. TW = no-op metadata = false.
    supportsMetadataEnrichment: false,
    // KZO-195 — TW (FinMind) is the only provider with a real delisting feed.
    supportsDelistingFeed: true,
    absenceDetectionEnabled: false,
  };
  const catalogRegistry = new Map([["TW", catalogProvider]]);
  const persistence = {
    upsertInstrumentCatalog: vi.fn(),
    // KZO-185: getAllMonitoredTickers now returns {ticker, marketCode}[] pairs.
    // enqueueDailyRefreshFn is always injected as a mock in these tests so this
    // mock is never invoked, but the return value is set to the correct shape.
    getAllMonitoredTickers: vi.fn().mockResolvedValue([]),
    createRefreshBatch: vi.fn(),
    // KZO-195 — admin notification fan-out deps. Default: empty admin list +
    // no-op create. Tests that exercise the fan-out can override per-suite.
    listAdminUserIds: vi.fn().mockResolvedValue([]),
    createNotification: vi.fn().mockResolvedValue("notif-1"),
  };
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { boss, catalogProvider, catalogRegistry, persistence, log };
}

describe("catalog sync worker", () => {
  it("runs catalog sync and then enqueues the daily refresh chain", async () => {
    const deps = createDeps();
    const runCatalogSyncFn = vi.fn().mockResolvedValue({ upserted: 3, delisted: 1, absent: 0, guardTripped: false, absentTickers: [] });
    const enqueueDailyRefreshFn = vi.fn().mockResolvedValue(2);

    const handler = createCatalogSyncHandler({
      boss: deps.boss,
      catalogRegistry: deps.catalogRegistry as never,
      persistence: deps.persistence,
      log: deps.log,
      runCatalogSyncFn,
      enqueueDailyRefreshFn,
    });

    await handler([createJob()]);

    expect(runCatalogSyncFn).toHaveBeenCalledWith(
      expect.objectContaining({
        catalogProvider: deps.catalogProvider,
        persistence: deps.persistence,
        log: deps.log,
      }),
    );
    expect(enqueueDailyRefreshFn).toHaveBeenCalledWith(deps.boss, deps.persistence, deps.log);
  });

  it("still enqueues daily refresh when catalog sync fails for a non-rate-limit reason", async () => {
    const deps = createDeps();
    const runCatalogSyncFn = vi.fn().mockRejectedValue(new Error("catalog exploded"));
    const enqueueDailyRefreshFn = vi.fn().mockResolvedValue(2);

    const handler = createCatalogSyncHandler({
      boss: deps.boss,
      catalogRegistry: deps.catalogRegistry as never,
      persistence: deps.persistence,
      log: deps.log,
      runCatalogSyncFn,
      enqueueDailyRefreshFn,
    });

    await expect(handler([createJob()])).rejects.toThrow("catalog exploded");
    expect(enqueueDailyRefreshFn).toHaveBeenCalledWith(deps.boss, deps.persistence, deps.log);
  });

  // -------------------------------------------------------------------------
  // QA-owned: N8 behavioral test — catalog sync reschedules on RateLimitedError.
  // Asserts: rateLimiter pre-check is gone; worker iterates catalogRegistry, calls
  // runCatalogSyncFn per provider, catches RateLimitedError, reschedules. The
  // enqueueDailyRefreshFn must NOT be called when we reschedule early.
  // -------------------------------------------------------------------------
  it("reschedules catalog sync and skips daily-refresh enqueue when runCatalogSyncFn throws RateLimitedError", async () => {
    const deps = createDeps();
    const runCatalogSyncFn = vi.fn().mockRejectedValue(new RateLimitedError({ msUntilAvailable: 60_000 }));
    const enqueueDailyRefreshFn = vi.fn();

    const handler = createCatalogSyncHandler({
      boss: deps.boss,
      catalogRegistry: deps.catalogRegistry as never,
      persistence: deps.persistence,
      log: deps.log,
      runCatalogSyncFn,
      enqueueDailyRefreshFn,
    });

    // Must NOT throw — worker reschedules and returns cleanly
    await handler([createJob()]);

    // KZO-170 S6: reschedule body now carries `pendingMarkets` (the markets that
    // weren't completed before the rate-limit fired). The legacy `{}` body is
    // gone — the per-market reschedule shape is the new contract.
    // startAfter: ceil(60_000 / 1000) = 60
    expect(deps.boss.send).toHaveBeenCalledWith(
      CATALOG_SYNC_QUEUE,
      { pendingMarkets: ["TW"] },
      expect.objectContaining({ startAfter: 60, singletonKey: CATALOG_SYNC_QUEUE }),
    );
    // runCatalogSyncFn was attempted exactly once (the provider threw, not the registry lookup)
    expect(runCatalogSyncFn).toHaveBeenCalledTimes(1);
    // Daily refresh enqueue must NOT fire when we reschedule early
    expect(enqueueDailyRefreshFn).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // KZO-163 HIGH-1 fix (Codex review) — pre-flight starvation guard for catalog sync.
  // The worker calls `reserveCapacity(2)` on each catalog provider BEFORE
  // runCatalogSync runs the catalog + delisting fetches. If reserveCapacity
  // throws, the worker reschedules with the 2-slot wait time and runCatalogSync
  // never executes — preventing the catalog→delisting starvation pattern under
  // one-slot-at-a-time replenishment.
  // -------------------------------------------------------------------------
  it("reschedules without invoking runCatalogSync when reserveCapacity throws (HIGH-1 starvation guard)", async () => {
    const deps = createDeps();
    deps.catalogProvider.reserveCapacity.mockImplementation(() => {
      throw new RateLimitedError({ msUntilAvailable: 120_000 });
    });
    const runCatalogSyncFn = vi.fn();
    const enqueueDailyRefreshFn = vi.fn();

    const handler = createCatalogSyncHandler({
      boss: deps.boss,
      catalogRegistry: deps.catalogRegistry as never,
      persistence: deps.persistence,
      log: deps.log,
      runCatalogSyncFn,
      enqueueDailyRefreshFn,
    });

    await handler([createJob()]);

    // KZO-170 S6: reschedule body carries `pendingMarkets` — the pre-flight
    // starvation guard fires BEFORE any market completes, so all markets are still
    // pending. With a single TW provider in the registry, that's `["TW"]`.
    expect(deps.boss.send).toHaveBeenCalledWith(
      CATALOG_SYNC_QUEUE,
      { pendingMarkets: ["TW"] },
      expect.objectContaining({ startAfter: 120, singletonKey: CATALOG_SYNC_QUEUE }),
    );
    // Critical: runCatalogSync never ran — the pre-flight guard short-circuited
    expect(runCatalogSyncFn).not.toHaveBeenCalled();
    expect(enqueueDailyRefreshFn).not.toHaveBeenCalled();
  });

  // KZO-163 MEDIUM-2 — singleton drop is logged, not thrown.
  it("logs a warning when singleton policy drops the rate-limit reschedule", async () => {
    const deps = createDeps();
    // boss.send returns null when an existing singleton already covers this work
    deps.boss.send.mockResolvedValue(null);
    const runCatalogSyncFn = vi.fn().mockRejectedValue(new RateLimitedError({ msUntilAvailable: 30_000 }));
    const enqueueDailyRefreshFn = vi.fn();

    const handler = createCatalogSyncHandler({
      boss: deps.boss,
      catalogRegistry: deps.catalogRegistry as never,
      persistence: deps.persistence,
      log: deps.log,
      runCatalogSyncFn,
      enqueueDailyRefreshFn,
    });

    await handler([createJob()]);

    expect(deps.log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ delaySec: 30 }),
      expect.stringContaining("catalog_sync_rate_limit_reschedule_dropped"),
    );
  });
});
