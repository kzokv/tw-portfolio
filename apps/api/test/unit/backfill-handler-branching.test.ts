import { describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import type { JobWithMetadata } from "pg-boss";
import type { MarketCode } from "@vakwen/domain";
import type { RawDailyBar, DividendRecord } from "../../src/services/market-data/types.js";
import { RateLimitedError } from "../../src/services/market-data/types.js";
import { BACKFILL_QUEUE, createBackfillHandler } from "../../src/services/market-data/backfillWorker.js";

function createJob(
  data: Record<string, unknown>,
  retryCount = 0,
  retryLimit = 3,
  priority?: number,
): JobWithMetadata<Record<string, unknown>> {
  // KZO-185: BackfillJobData.marketCode is required and validated via Zod at
  // handler entry. Default to "TW" so existing test cases keep their semantics
  // (all of these tests were originally written when every ticker resolved to
  // TW). Tests that intentionally exercise the missing-marketCode path should
  // pass `data` without `marketCode` (and expect a ZodError). KZO-170 deleted
  // the legacy `resolveMarketCode` heuristic entirely.
  const dataWithMarket = "marketCode" in data ? data : { ...data, marketCode: "TW" };
  return {
    data: dataWithMarket,
    retryCount,
    retryLimit,
    priority,
  } as JobWithMetadata<Record<string, unknown>>;
}

function createSuccessBars(): RawDailyBar[] {
  return [
    {
      ticker: "2330",
      barDate: "2026-03-30",
      open: 950,
      high: 960,
      low: 940,
      close: 955,
      volume: 1_000_000,
      sourceId: "finmind",
    },
  ];
}

function createSuccessDividends(): DividendRecord[] {
  return [
    {
      ticker: "2330",
      exDividendDate: "2026-03-15",
      paymentDate: "2026-04-10",
      cashDividendPerShare: 4,
      stockDividendPerShare: 0,
      sourceId: "finmind",
    },
  ];
}

function createDeps() {
  // KZO-163: provider mock implements MarketDataProvider; rate-limiter is no longer a worker
  // dep — it's owned by the provider and signals exhaustion via RateLimitedError. The
  // `reserveCapacity` mock returns undefined (no-op) by default; tests targeting the pre-flight
  // starvation guard override it to throw RateLimitedError.
  const provider = {
    reserveCapacity: vi.fn(),
    fetchBars: vi.fn().mockResolvedValue(createSuccessBars()),
    fetchDividends: vi.fn().mockResolvedValue(createSuccessDividends()),
  };
  // KZO-172: catalog provider for metadata enrichment. Defaults to a no-op (returns
  // null) so the existing tests' assertions about bars/dividends paths continue to
  // hold — the metadata branch is exercised in dedicated tests added later.
  const catalogProvider = {
    // KZO-190: TW catalog provider's `fetchInstrumentMetadata` is a no-op (returns null)
    // and consumes no rate-limit slot. Worker uses this flag to right-size reserveCapacity.
    supportsMetadataEnrichment: false,
    fetchInstrumentMetadata: vi.fn().mockResolvedValue(null),
  };
  const marketDataRegistry = new Map<MarketCode, typeof provider>();
  marketDataRegistry.set("TW", provider);
  const catalogRegistry = new Map<MarketCode, typeof catalogProvider>();
  catalogRegistry.set("TW", catalogProvider);
  return {
    pool: { query: vi.fn().mockResolvedValue({ rowCount: 1 }) },
    provider,
    catalogProvider,
    marketDataRegistry,
    // KZO-172: catalog registry for `fetchInstrumentMetadata` after bars+dividends.
    // Same-instance dual-registration mirrors the production AU path.
    catalogRegistry,
    // KZO-172: persistence shim for `upsertInstrumentCatalog` writes during
    // metadata enrichment. The default catalogProvider returns null so this is
    // never called in the existing tests; tests targeting the enrichment branch
    // override the catalogProvider mock.
    persistence: { upsertInstrumentCatalog: vi.fn().mockResolvedValue({ upserted: 1, delisted: 0, absent: 0, guardTripped: false, absentTickers: [] }) },
    // KZO-170: `resolveMarketCode` was deleted entirely (heuristic removed).
    // Producers now stamp `marketCode` directly on `BackfillJobData`, and the
    // worker validates via Zod schema at handler entry.
    eventBus: { publishEvent: vi.fn().mockResolvedValue(undefined) },
    boss: { send: vi.fn().mockResolvedValue(undefined) },
    // KZO-189: implementation-coupled stub — defaults to "conditional" (the
    // production default). Tests that exercise mode-specific branches override
    // this resolved value as needed.
    getEffectiveMetadataEnrichmentMode: vi.fn().mockResolvedValue("conditional"),
    updateBackfillStatus: vi.fn().mockResolvedValue(undefined),
    getUsersMonitoringTicker: vi.fn().mockResolvedValue(["user-1", "user-2"]),
    onBarsUpserted: vi.fn(),
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
}

describe("backfill handler trigger branching", () => {
  it("fan-outs completion events for daily refresh and preserves the ready status update", async () => {
    const deps = createDeps();
    const handler = createBackfillHandler(deps as never);

    await handler([
      createJob({
        ticker: "2330",
        trigger: "daily_refresh",
        startDate: "2026-03-24",
      }) as never,
    ]);

    expect(deps.updateBackfillStatus).toHaveBeenCalledTimes(1);
    expect(deps.updateBackfillStatus).toHaveBeenCalledWith("2330", "TW", "ready");
    const barsCall = deps.provider.fetchBars.mock.calls[0] ?? [];
    const dividendsCall = deps.provider.fetchDividends.mock.calls[0] ?? [];
    expect(barsCall[0]).toBe("2330");
    expect(barsCall[1]).toBe("2026-03-24");
    expect(dividendsCall[0]).toBe("2330");
    expect(dividendsCall[1]).toBe("2026-03-24");
    expect(deps.getUsersMonitoringTicker).toHaveBeenCalledWith("2330");
    expect(deps.onBarsUpserted).toHaveBeenCalledWith("TW", ["2026-03-30"]);
    expect(deps.eventBus.publishEvent).toHaveBeenCalledTimes(2);
    expect(deps.eventBus.publishEvent).toHaveBeenNthCalledWith(1, "user-1", "daily_refresh_complete", {
      ticker: "2330",
      barsCount: 1,
      dividendsCount: 1,
    });
    expect(deps.eventBus.publishEvent).toHaveBeenNthCalledWith(2, "user-2", "daily_refresh_complete", {
      ticker: "2330",
      barsCount: 1,
      dividendsCount: 1,
    });
  });

  it("logs lifecycle entries for operation-backed provider fixer jobs", async () => {
    const deps = createDeps();
    const providerOperationLogger = {
      getProviderOperation: vi.fn().mockResolvedValue({
        id: "provider-op-1",
        providerId: "finmind-tw",
        marketCode: "TW",
        phase: "running",
      }),
      updateProviderOperation: vi.fn(),
      createProviderOperationLog: vi.fn().mockResolvedValue({}),
    };
    const handler = createBackfillHandler({ ...deps, providerOperationLogger } as never);

    await handler([
      createJob({
        ticker: "2330",
        trigger: "admin_rerun",
        providerOperationId: "provider-op-1",
      }) as never,
    ]);

    expect(providerOperationLogger.getProviderOperation).toHaveBeenCalledWith("provider-op-1");
    expect(providerOperationLogger.createProviderOperationLog).toHaveBeenCalledWith(expect.objectContaining({
      operationId: "provider-op-1",
      phase: "running",
      level: "info",
      message: expect.stringContaining("job_started"),
      context: expect.objectContaining({
        providerId: "finmind-tw",
        marketCode: "TW",
        ticker: "2330",
        trigger: "admin_rerun",
      }),
    }));
    expect(providerOperationLogger.createProviderOperationLog).toHaveBeenCalledWith(expect.objectContaining({
      operationId: "provider-op-1",
      phase: "running",
      level: "info",
      message: expect.stringContaining("job_completed"),
      context: expect.objectContaining({ barsCount: 1, dividendsCount: 1 }),
    }));
  });

  it("completes operation-backed backfill batches after every queued job reports", async () => {
    const deps = createDeps();
    const onBatchComplete = vi.fn().mockResolvedValue(undefined);
    const providerOperationLogger = {
      getProviderOperation: vi.fn().mockResolvedValue({
        id: "provider-op-batch",
        providerId: "finmind-tw",
        marketCode: "TW",
        phase: "running",
        metadata: { source: "preview" },
      }),
      updateProviderOperation: vi.fn().mockResolvedValue({}),
      createProviderOperationLog: vi.fn().mockResolvedValue({}),
    };
    const updateBatchTickerResult = vi.fn().mockResolvedValue({
      jobsSucceeded: 2,
      jobsFailed: 0,
      jobsTotal: 2,
    });
    const handler = createBackfillHandler({
      ...deps,
      updateBatchTickerResult,
      onBatchComplete,
      providerOperationLogger,
    } as never);

    await handler([
      createJob({
        ticker: "2330",
        trigger: "admin_rerun",
        batchId: "batch-1",
        providerOperationId: "provider-op-batch",
      }) as never,
    ]);

    expect(updateBatchTickerResult).toHaveBeenCalledWith("batch-1", "2330", {
      status: "success",
      barsCount: 1,
      dividendsCount: 1,
    });
    expect(onBatchComplete).toHaveBeenCalledWith("batch-1");
    expect(providerOperationLogger.updateProviderOperation).toHaveBeenCalledWith({
      id: "provider-op-batch",
      phase: "completed",
      completedAt: expect.any(String),
      metadata: expect.objectContaining({
        source: "preview",
        batchId: "batch-1",
        jobsSucceeded: 2,
        jobsFailed: 0,
        jobsTotal: 2,
        progressPercent: 100,
      }),
    });
    expect(providerOperationLogger.createProviderOperationLog).toHaveBeenCalledWith(expect.objectContaining({
      operationId: "provider-op-batch",
      phase: "completed",
      level: "info",
      message: expect.stringContaining("backfill_batch_completed"),
      context: expect.objectContaining({ batchId: "batch-1", jobsTotal: 2 }),
    }));
  });

  it("requeues operation-backed jobs while the provider operation is paused", async () => {
    const deps = createDeps();
    const providerOperationLogger = {
      getProviderOperation: vi.fn().mockResolvedValue({
        id: "provider-op-paused",
        providerId: "finmind-tw",
        marketCode: "TW",
        phase: "paused",
      }),
      updateProviderOperation: vi.fn(),
      createProviderOperationLog: vi.fn().mockResolvedValue({}),
    };
    const handler = createBackfillHandler({ ...deps, providerOperationLogger } as never);

    await handler([
      createJob({
        ticker: "2330",
        trigger: "admin_rerun",
        providerOperationId: "provider-op-paused",
      }, 0, 3, 10) as never,
    ]);

    expect(deps.boss.send).toHaveBeenCalledWith(
      BACKFILL_QUEUE,
      expect.objectContaining({ providerOperationId: "provider-op-paused" }),
      expect.objectContaining({ startAfter: 60, singletonKey: "2330:TW", priority: 10 }),
    );
    expect(deps.provider.fetchBars).not.toHaveBeenCalled();
    expect(providerOperationLogger.createProviderOperationLog).toHaveBeenCalledWith(expect.objectContaining({
      operationId: "provider-op-paused",
      phase: "paused",
      message: expect.stringContaining("job_deferred_paused_operation"),
    }));
  });

  it("drops operation-backed jobs when the provider operation is cancelled", async () => {
    const deps = createDeps();
    const providerOperationLogger = {
      getProviderOperation: vi.fn().mockResolvedValue({
        id: "provider-op-cancelled",
        providerId: "finmind-tw",
        marketCode: "TW",
        phase: "cancelled",
      }),
      updateProviderOperation: vi.fn(),
      createProviderOperationLog: vi.fn().mockResolvedValue({}),
    };
    const handler = createBackfillHandler({ ...deps, providerOperationLogger } as never);

    await handler([
      createJob({
        ticker: "2330",
        trigger: "admin_rerun",
        providerOperationId: "provider-op-cancelled",
      }) as never,
    ]);

    expect(deps.boss.send).not.toHaveBeenCalled();
    expect(deps.provider.fetchBars).not.toHaveBeenCalled();
    expect(providerOperationLogger.createProviderOperationLog).toHaveBeenCalledWith(expect.objectContaining({
      operationId: "provider-op-cancelled",
      phase: "cancelled",
      message: expect.stringContaining("job_cancelled"),
    }));
  });

  it("keeps daily refresh failures out of backfill status transitions and notifies monitoring users on the last retry", async () => {
    const deps = createDeps();
    deps.provider.fetchBars.mockRejectedValue(new Error("FinMind outage"));
    const handler = createBackfillHandler(deps as never);

    await expect(
      handler([
        createJob(
          {
            ticker: "2330",
            trigger: "daily_refresh",
            startDate: "2026-03-24",
          },
          3,
          3,
        ) as never,
      ]),
    ).rejects.toThrow("FinMind outage");

    expect(deps.updateBackfillStatus).not.toHaveBeenCalled();
    expect(deps.getUsersMonitoringTicker).toHaveBeenCalledWith("2330");
    expect(deps.eventBus.publishEvent).toHaveBeenNthCalledWith(1, "user-1", "daily_refresh_failed", {
      ticker: "2330",
      reason: "FinMind outage",
    });
    expect(deps.eventBus.publishEvent).toHaveBeenNthCalledWith(2, "user-2", "daily_refresh_failed", {
      ticker: "2330",
      reason: "FinMind outage",
    });
  });

  it("preserves the existing user-selection failure flow", async () => {
    const deps = createDeps();
    deps.provider.fetchBars.mockRejectedValue(new Error("No bars"));
    const handler = createBackfillHandler(deps as never);

    await expect(
      handler([
        createJob(
          {
            ticker: "2330",
            userId: "user-9",
            trigger: "user_selection",
          },
          3,
          3,
        ) as never,
      ]),
    ).rejects.toThrow("No bars");

    expect(deps.updateBackfillStatus).toHaveBeenNthCalledWith(1, "2330", "TW", "backfilling");
    expect(deps.updateBackfillStatus).toHaveBeenNthCalledWith(2, "2330", "TW", "failed");
    expect(deps.eventBus.publishEvent).toHaveBeenNthCalledWith(1, "user-9", "backfill_started", { ticker: "2330" });
    expect(deps.eventBus.publishEvent).toHaveBeenNthCalledWith(2, "user-9", "backfill_failed", {
      ticker: "2330",
      reason: "No bars",
      retriesExhausted: true,
    });
    expect(deps.getUsersMonitoringTicker).not.toHaveBeenCalled();
  });

  it("reschedules rate-limited daily refresh jobs with the refresh priority intact", async () => {
    const deps = createDeps();
    // KZO-163: provider throws RateLimitedError instead of pre-checking rateLimiter.canConsume.
    deps.provider.fetchBars.mockRejectedValue(new RateLimitedError({ msUntilAvailable: 30_000 }));
    const handler = createBackfillHandler(deps as never);

    await handler([
      createJob(
        {
          ticker: "2330",
          trigger: "daily_refresh",
          startDate: "2026-03-24",
        },
        0,
        3,
        10,
      ) as never,
    ]);

    // KZO-185: reschedule enqueues the parsed (validated) payload, which
    // includes the producer-stamped marketCode.
    expect(deps.boss.send).toHaveBeenCalledWith(
      "finmind-backfill",
      { ticker: "2330", marketCode: "TW", trigger: "daily_refresh", startDate: "2026-03-24" },
      { startAfter: 30, singletonKey: "2330:TW", priority: 10 },
    );
    // Status must NOT flip to "failed" on a reschedule.
    expect(deps.updateBackfillStatus).not.toHaveBeenCalledWith("2330", "TW", "failed");
  });

  it("repair flow: emits repair lifecycle events and skips backfill status mutations", async () => {
    const deps = createDeps();
    const handler = createBackfillHandler(deps as never);

    await handler([
      createJob({
        ticker: "2330",
        userId: "user-repair",
        trigger: "repair",
        startDate: "2026-03-01",
        endDate: "2026-03-31",
      }) as never,
    ]);

    expect(deps.updateBackfillStatus).not.toHaveBeenCalled();
    expect(deps.provider.fetchBars).toHaveBeenCalledWith("2330", "2026-03-01", "2026-03-31");
    expect(deps.provider.fetchDividends).toHaveBeenCalledWith("2330", "2026-03-01", "2026-03-31");
    expect(deps.eventBus.publishEvent).toHaveBeenNthCalledWith(1, "user-repair", "repair_started", { ticker: "2330" });
    expect(deps.eventBus.publishEvent).toHaveBeenNthCalledWith(2, "user-repair", "repair_complete", {
      ticker: "2330",
      barsCount: 1,
      dividendsCount: 1,
    });
    expect(deps.getUsersMonitoringTicker).not.toHaveBeenCalled();
  });

  it("repair flow: includeBars=false skips bars fetch and counts only dividends", async () => {
    const deps = createDeps();
    const handler = createBackfillHandler(deps as never);

    await handler([
      createJob({
        ticker: "2330",
        userId: "user-repair",
        trigger: "repair",
        includeBars: false,
        includeDividends: true,
      }) as never,
    ]);

    expect(deps.provider.fetchBars).not.toHaveBeenCalled();
    expect(deps.provider.fetchDividends).toHaveBeenCalledTimes(1);
    expect(deps.eventBus.publishEvent).toHaveBeenNthCalledWith(2, "user-repair", "repair_complete", {
      ticker: "2330",
      barsCount: 0,
      dividendsCount: 1,
    });
  });

  it("repair flow: includeDividends=false skips dividends fetch and counts only bars", async () => {
    const deps = createDeps();
    const handler = createBackfillHandler(deps as never);

    await handler([
      createJob({
        ticker: "2330",
        userId: "user-repair",
        trigger: "repair",
        includeBars: true,
        includeDividends: false,
      }) as never,
    ]);

    expect(deps.provider.fetchBars).toHaveBeenCalledTimes(1);
    expect(deps.provider.fetchDividends).not.toHaveBeenCalled();
    expect(deps.eventBus.publishEvent).toHaveBeenNthCalledWith(2, "user-repair", "repair_complete", {
      ticker: "2330",
      barsCount: 1,
      dividendsCount: 0,
    });
  });

  it("repair flow: on final retry emits repair_failed and never updates backfill status", async () => {
    const deps = createDeps();
    deps.provider.fetchBars.mockRejectedValue(new Error("repair bars failed"));
    const handler = createBackfillHandler(deps as never);

    await expect(
      handler([
        createJob(
          {
            ticker: "2330",
            userId: "user-repair",
            trigger: "repair",
          },
          3,
          3,
        ) as never,
      ]),
    ).rejects.toThrow("repair bars failed");

    expect(deps.updateBackfillStatus).not.toHaveBeenCalled();
    expect(deps.eventBus.publishEvent).toHaveBeenNthCalledWith(1, "user-repair", "repair_started", { ticker: "2330" });
    expect(deps.eventBus.publishEvent).toHaveBeenNthCalledWith(2, "user-repair", "repair_failed", {
      ticker: "2330",
      reason: "repair bars failed",
      retriesExhausted: true,
    });
  });

  it("repair flow: creates persistent notification on success with bar and dividend counts", async () => {
    const deps = createDeps();
    const createNotification = vi.fn().mockResolvedValue("notif-1");
    const handler = createBackfillHandler({ ...deps, createNotification } as never);

    await handler([
      createJob({
        ticker: "2330",
        userId: "user-repair",
        trigger: "repair",
      }) as never,
    ]);

    expect(createNotification).toHaveBeenCalledWith({
      userId: "user-repair",
      severity: "info",
      source: "repair",
      title: "Repair completed — 2330",
      body: "1 daily bars, 1 dividend events",
      detail: { ticker: "2330", barsCount: 1, dividendsCount: 1 },
    });
  });

  it("repair flow: creates persistent error notification on final retry failure", async () => {
    const deps = createDeps();
    deps.provider.fetchBars.mockRejectedValue(new Error("FinMind timeout"));
    const createNotification = vi.fn().mockResolvedValue("notif-2");
    const handler = createBackfillHandler({ ...deps, createNotification } as never);

    await expect(
      handler([
        createJob(
          {
            ticker: "2330",
            userId: "user-repair",
            trigger: "repair",
          },
          3,
          3,
        ) as never,
      ]),
    ).rejects.toThrow("FinMind timeout");

    expect(createNotification).toHaveBeenCalledWith({
      userId: "user-repair",
      severity: "error",
      source: "repair",
      title: "Repair failed — 2330",
      body: "FinMind timeout",
      detail: { ticker: "2330", reason: "FinMind timeout" },
    });
  });

  it("repair flow: skips error notification on non-final retry", async () => {
    const deps = createDeps();
    deps.provider.fetchBars.mockRejectedValue(new Error("transient"));
    const createNotification = vi.fn().mockResolvedValue("notif-3");
    const handler = createBackfillHandler({ ...deps, createNotification } as never);

    await expect(
      handler([
        createJob(
          {
            ticker: "2330",
            userId: "user-repair",
            trigger: "repair",
          },
          1,
          3,
        ) as never,
      ]),
    ).rejects.toThrow("transient");

    expect(createNotification).not.toHaveBeenCalled();
  });

  it("re-throws RateLimitedError from the dividend fetch (warn-and-continue path must not swallow it)", async () => {
    // KZO-163 invariant: the dividend try/catch in backfillWorker must re-throw RateLimitedError
    // so the outer reschedule path runs. Without this, the rate-limit signal would be lost when
    // it surfaces during the dividend fetch (as opposed to the bars fetch).
    const deps = createDeps();
    deps.provider.fetchDividends.mockRejectedValue(new RateLimitedError({ msUntilAvailable: 15_000 }));
    const handler = createBackfillHandler(deps as never);

    await handler([
      createJob({
        ticker: "2330",
        userId: "user-9",
        trigger: "user_selection",
      }) as never,
    ]);

    // Reschedule, not completion notification.
    // KZO-185: parsed (validated) payload includes producer-stamped marketCode.
    expect(deps.boss.send).toHaveBeenCalledWith(
      "finmind-backfill",
      { ticker: "2330", marketCode: "TW", userId: "user-9", trigger: "user_selection" },
      expect.objectContaining({ startAfter: 15, singletonKey: "2330:TW" }),
    );
    expect(deps.eventBus.publishEvent).not.toHaveBeenCalledWith(
      "user-9",
      "backfill_complete",
      expect.anything(),
    );
  });

  // -------------------------------------------------------------------------
  // QA-owned: N8 / D5 behavioral test — reschedule on RateLimitedError from provider.
  // Asserts: (a) RateLimitedError from provider is the catch contract,
  // (b) msUntilAvailable drives startAfter, (c) job completes cleanly (no rethrow).
  // -------------------------------------------------------------------------
  it("reschedules backfill and completes cleanly when provider throws RateLimitedError", async () => {
    const deps = createDeps();
    const provider = deps.marketDataRegistry.get("TW")!;
    // Make the provider throw RateLimitedError — the new catch contract (replaces pre-call canConsume check)
    provider.fetchBars.mockRejectedValue(new RateLimitedError({ msUntilAvailable: 45_000 }));
    const handler = createBackfillHandler(deps as never);

    // Handler must NOT throw — job completes successfully so pg-boss does not retry
    await handler([
      createJob({
        ticker: "2330",
        trigger: "daily_refresh",
        startDate: "2026-03-24",
      }) as never,
    ]);

    // Reschedule sent with correct startAfter: ceil(45_000 / 1000) = 45.
    // KZO-185: parsed (validated) payload includes producer-stamped marketCode.
    expect(deps.boss.send).toHaveBeenCalledWith(
      BACKFILL_QUEUE,
      { ticker: "2330", marketCode: "TW", trigger: "daily_refresh", startDate: "2026-03-24" },
      expect.objectContaining({ startAfter: 45, singletonKey: "2330:TW" }),
    );
    // Status must NOT flip — this is a reschedule, not a failure or success
    expect(deps.updateBackfillStatus).not.toHaveBeenCalledWith("2330", "TW", "failed");
    // fetchBars was actually called (unlike the old canConsume-false path which blocked before the call)
    expect(provider.fetchBars).toHaveBeenCalledWith("2330", expect.any(String), undefined);
  });

  // -------------------------------------------------------------------------
  // KZO-163 HIGH-1 fix (Codex review) — pre-flight starvation guard.
  // When `reserveCapacity(2)` throws RateLimitedError BEFORE any fetch runs, the
  // worker must reschedule with the limiter's full N-slot wait time and skip
  // both fetches entirely (no wasted bars call that would leave dividends still
  // rate-limited on the next attempt).
  // -------------------------------------------------------------------------
  it("reschedules without fetching when reserveCapacity throws RateLimitedError (HIGH-1 starvation guard)", async () => {
    const deps = createDeps();
    const provider = deps.marketDataRegistry.get("TW")!;
    provider.reserveCapacity.mockImplementation(() => {
      throw new RateLimitedError({ msUntilAvailable: 90_000 });
    });
    const handler = createBackfillHandler(deps as never);

    await handler([
      createJob({
        ticker: "2330",
        trigger: "daily_refresh",
        startDate: "2026-03-24",
      }) as never,
    ]);

    // Reschedule fired with the full 2-slot wait time (90s, not 1s for the next single slot).
    // KZO-185: parsed (validated) payload includes producer-stamped marketCode.
    expect(deps.boss.send).toHaveBeenCalledWith(
      BACKFILL_QUEUE,
      { ticker: "2330", marketCode: "TW", trigger: "daily_refresh", startDate: "2026-03-24" },
      expect.objectContaining({ startAfter: 90, singletonKey: "2330:TW" }),
    );
    // Critical: NEITHER fetch ran — that's the whole point of the pre-flight guard
    expect(provider.fetchBars).not.toHaveBeenCalled();
    expect(provider.fetchDividends).not.toHaveBeenCalled();
    expect(deps.updateBackfillStatus).not.toHaveBeenCalled();
  });

  // KZO-190: reserveCapacity is now dynamic per (includeBars, includeDividends,
  // shouldEnrich && supportsMetadataEnrichment). For TW + bars-only + repair (which
  // is on the unconditional-enrich ALLOW list, so shouldEnrich=true), the formula
  // resolves to 1 (bars only) — TW's `fetchInstrumentMetadata` is a no-op so its
  // `supportsMetadataEnrichment` is false. Pre-KZO-190 this asserted 3 (the static
  // over-reservation that KZO-172 introduced and KZO-189 carried forward).
  it("reserves bars-only slot for TW + repair + includeDividends=false (KZO-190 dynamic count)", async () => {
    const deps = createDeps();
    const provider = deps.marketDataRegistry.get("TW")!;
    const handler = createBackfillHandler(deps as never);

    await handler([
      createJob({
        ticker: "2330",
        userId: "user-repair",
        trigger: "repair",
        includeBars: true,
        includeDividends: false,
      }) as never,
    ]);

    expect(provider.reserveCapacity).toHaveBeenCalledTimes(1);
    expect(provider.reserveCapacity).toHaveBeenCalledWith(1);
    expect(provider.fetchBars).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // KZO-185 (D3 / typed-transient-error-catch-audit.md): old-shape rejection.
  // The BackfillJobDataSchema.parse() is placed BEFORE the existing try block
  // so a ZodError on a malformed job (missing `marketCode`) propagates straight
  // to pg-boss without running ANY side effects. This test verifies:
  //   (a) ZodError is thrown (job.data missing `marketCode` fails Zod)
  //   (b) no bars fetch, no dividend fetch
  //   (c) no status update, no SSE event, no reschedule boss.send
  //   (d) the existing try/catch does NOT swallow ZodError — it propagates
  //       cleanly because the parse is BEFORE the try block.
  // -------------------------------------------------------------------------
  it("rejects old-shape job.data missing marketCode with ZodError before any side effects", async () => {
    const deps = createDeps();
    const handler = createBackfillHandler(deps as never);

    // Construct old-shape job directly (bypass createJob's `marketCode` default)
    // to simulate a pre-KZO-169 in-flight job that lacks `marketCode`. Cast
    // through `unknown` because `JobWithMetadata` requires ~17 additional
    // pg-boss-internal fields the handler never reads — the parse runs at
    // entry, and the test's only assertion is that ZodError surfaces before
    // any of those fields would be touched.
    const oldShapeJob = {
      data: { ticker: "2330", userId: "u1", trigger: "daily_refresh" },
      retryCount: 0,
      retryLimit: 3,
    } as unknown as JobWithMetadata<Record<string, unknown>>;

    await expect(handler([oldShapeJob as never])).rejects.toThrow(ZodError);

    // Nothing must have run after the parse — all side-effect spies must be zero.
    expect(deps.pool.query).not.toHaveBeenCalled();
    expect(deps.eventBus.publishEvent).not.toHaveBeenCalled();
    expect(deps.updateBackfillStatus).not.toHaveBeenCalled();
    expect(deps.boss.send).not.toHaveBeenCalled();
    // Provider is only reached after a successful parse; neither fetch ran.
    const twProvider = deps.marketDataRegistry.get("TW")!;
    expect(twProvider.fetchBars).not.toHaveBeenCalled();
    expect(twProvider.fetchDividends).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // KZO-172 — AU metadata enrichment via `fetchInstrumentMetadata`.
  //
  // Per scope-todo Phase 5 + .claude/rules/typed-transient-error-catch-audit.md:
  //   1. Worker resolves BOTH `marketDataRegistry.get("AU")` (bars/dividends)
  //      AND `catalogRegistry.get("AU")` (metadata). For AU, the same provider
  //      instance is registered to both.
  //   2. After fetchBars + fetchDividends, the worker calls
  //      `catalogProvider.fetchInstrumentMetadata(ticker)`.
  //   3. Generic errors from `fetchInstrumentMetadata` use warn-and-continue
  //      semantics — the backfill still flips status to `ready`.
  //   4. `RateLimitedError` from `fetchInstrumentMetadata` MUST re-throw to the
  //      outer catch so the reschedule path engages — same load-bearing
  //      contract as the dividend warn-and-continue catch.
  //
  // These tests build their own `BackfillWorkerDeps` with both registries
  // because the existing `createDeps()` only stamps `marketDataRegistry`.
  // -------------------------------------------------------------------------

  function createAuDeps() {
    // The AU provider implements both interfaces — same instance under both maps.
    const auProvider = {
      providerId: "yahoo-finance-au",
      // KZO-190: AU's `fetchInstrumentMetadata` is a real Yahoo `quote()` call that
      // consumes one rate-limit slot. Worker reads this flag to size reserveCapacity.
      supportsMetadataEnrichment: true,
      reserveCapacity: vi.fn(),
      fetchBars: vi.fn().mockResolvedValue([
        {
          ticker: "BHP",
          barDate: "2024-06-15",
          open: 45,
          high: 46,
          low: 44.5,
          close: 45.5,
          volume: 1_000_000,
          sourceId: "yahoo-finance-au",
        },
      ]),
      fetchDividends: vi.fn().mockResolvedValue([]),
      fetchInstrumentCatalog: vi.fn().mockResolvedValue([]),
      fetchDelistingHistory: vi.fn().mockResolvedValue([]),
      fetchInstrumentMetadata: vi.fn().mockResolvedValue({
        ticker: "BHP",
        name: "BHP Group Limited",
        typeRaw: "ASX",
        industryCategory: "EQUITY",
        date: "2026-05-02",
      }),
      searchInstruments: vi.fn().mockResolvedValue([]),
    };
    const marketDataRegistry = new Map<MarketCode, typeof auProvider>();
    marketDataRegistry.set("AU", auProvider);
    const catalogRegistry = new Map<MarketCode, typeof auProvider>();
    catalogRegistry.set("AU", auProvider);
    return {
      pool: { query: vi.fn().mockResolvedValue({ rowCount: 1 }) },
      auProvider,
      marketDataRegistry,
      catalogRegistry,
      // KZO-172 (Phase 4 F5): persistence shim so the worker's metadata
      // enrichment branch can call `persistence.upsertInstrumentCatalog([row], [])`
      // after `fetchInstrumentMetadata` returns. Without this shim the worker's
      // metadata-write step throws and is swallowed by the outer warn-and-continue
      // catch — the AU happy-path test would still see status=ready but the
      // upsert would never be observed. The added `toHaveBeenCalledTimes(1)`
      // assertion in the happy-path test pins the contract.
      persistence: { upsertInstrumentCatalog: vi.fn().mockResolvedValue({ upserted: 1, delisted: 0, absent: 0, guardTripped: false, absentTickers: [] }) },
      eventBus: { publishEvent: vi.fn().mockResolvedValue(undefined) },
      boss: { send: vi.fn().mockResolvedValue(undefined) },
      // KZO-189: implementation-coupled stub — defaults to "conditional".
      // KZO-189-specific tests (mode × trigger truth-table cases) override
      // this resolved value to exercise both branches.
      getEffectiveMetadataEnrichmentMode: vi.fn().mockResolvedValue("conditional"),
      updateBackfillStatus: vi.fn().mockResolvedValue(undefined),
      getUsersMonitoringTicker: vi.fn().mockResolvedValue([]),
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    };
  }

  it("AU happy path: fetchInstrumentMetadata is invoked after fetchBars + fetchDividends, and status flips to ready", async () => {
    const deps = createAuDeps();
    const handler = createBackfillHandler(deps as never);

    await handler([
      createJob({
        ticker: "BHP",
        marketCode: "AU",
        userId: "user-1",
        trigger: "user_selection",
        startDate: "2024-01-02",
      }) as never,
    ]);

    // Metadata enrichment was called for AU.
    expect(deps.auProvider.fetchInstrumentMetadata).toHaveBeenCalledWith("BHP");

    // KZO-172 (Phase 4 F5): metadata's RawInstrumentInfo result must flow
    // through to `persistence.upsertInstrumentCatalog([row], [])` exactly
    // once. Without the toHaveBeenCalledTimes(1) pin, a silent error inside
    // the metadata-write step (e.g. throw swallowed by warn-and-continue)
    // would leave the rest of the assertions green while the enrichment
    // itself never landed.
    expect(deps.persistence.upsertInstrumentCatalog).toHaveBeenCalledTimes(1);

    // Standard backfill flow ran end-to-end.
    expect(deps.auProvider.fetchBars).toHaveBeenCalledWith(
      "BHP",
      expect.any(String),
      undefined,
    );
    expect(deps.auProvider.fetchDividends).toHaveBeenCalledWith(
      "BHP",
      expect.any(String),
      undefined,
    );
    expect(deps.updateBackfillStatus).toHaveBeenLastCalledWith("BHP", "AU", "ready");

    // Reschedule was NOT called (this is a clean completion, not a retry).
    expect(deps.boss.send).not.toHaveBeenCalled();
  });

  it("AU warn-and-continue: generic error from fetchInstrumentMetadata does NOT abort the backfill", async () => {
    const deps = createAuDeps();
    deps.auProvider.fetchInstrumentMetadata.mockRejectedValueOnce(
      new Error("yahoo quote() timed out"),
    );
    const handler = createBackfillHandler(deps as never);

    // Handler must NOT throw — the metadata enrichment failure is non-fatal.
    await handler([
      createJob({
        ticker: "BHP",
        marketCode: "AU",
        userId: "user-1",
        trigger: "user_selection",
        startDate: "2024-01-02",
      }) as never,
    ]);

    // The bars + dividends fetched successfully; status flipped to ready.
    expect(deps.auProvider.fetchBars).toHaveBeenCalledTimes(1);
    expect(deps.auProvider.fetchDividends).toHaveBeenCalledTimes(1);
    expect(deps.updateBackfillStatus).toHaveBeenLastCalledWith("BHP", "AU", "ready");
    expect(deps.updateBackfillStatus).not.toHaveBeenCalledWith("BHP", "AU", "failed");

    // The metadata error was logged via warn (NOT thrown).
    expect(deps.log.warn).toHaveBeenCalled();
  });

  it("AU RateLimitedError re-throw: fetchInstrumentMetadata RateLimitedError engages the reschedule path", async () => {
    // Load-bearing assertion per .claude/rules/typed-transient-error-catch-audit.md
    // — the metadata try/catch must re-throw RateLimitedError so the outer
    // catch block reschedules. Without this, the rate-limit signal is silently
    // swallowed and the worker reports "ready" while the limiter is exhausted,
    // creating a half-success that AC #3 (`<60s`) will eventually mask.
    const deps = createAuDeps();
    deps.auProvider.fetchInstrumentMetadata.mockRejectedValueOnce(
      new RateLimitedError({ msUntilAvailable: 25_000 }),
    );
    const handler = createBackfillHandler(deps as never);

    // Handler must NOT throw (reschedule is a clean completion).
    await handler([
      createJob(
        {
          ticker: "BHP",
          marketCode: "AU",
          userId: "user-1",
          trigger: "user_selection",
          startDate: "2024-01-02",
        },
        0,
        3,
        10,
      ) as never,
    ]);

    // Reschedule fired with composite singletonKey + 25s startAfter
    // (`Math.ceil(25000/1000)`).
    expect(deps.boss.send).toHaveBeenCalledWith(
      BACKFILL_QUEUE,
      expect.objectContaining({ ticker: "BHP", marketCode: "AU" }),
      expect.objectContaining({ startAfter: 25, singletonKey: "BHP:AU" }),
    );

    // Status must NOT flip to "failed" — this is a reschedule.
    expect(deps.updateBackfillStatus).not.toHaveBeenCalledWith("BHP", "AU", "failed");
  });

  it("AU pre-1988 trade-date truncation: startDate before historyStartFor('AU') is replaced with the AU start", async () => {
    const deps = createAuDeps();
    const handler = createBackfillHandler(deps as never);

    await handler([
      createJob({
        ticker: "BHP",
        marketCode: "AU",
        userId: "user-1",
        trigger: "user_selection",
        startDate: "1985-01-01", // pre-1988-01-28 (AU history start)
      }) as never,
    ]);

    // The provider was called with the truncated start (>= "1988-01-28") —
    // never the original "1985-01-01".
    const [, fetchBarsStartDate] = deps.auProvider.fetchBars.mock.calls[0]!;
    expect(typeof fetchBarsStartDate).toBe("string");
    expect(fetchBarsStartDate >= "1988-01-28").toBe(true);
    expect(fetchBarsStartDate).not.toBe("1985-01-01");
  });

  // ── KZO-189: metadata enrichment gate ─────────────────────────────────────
  //
  // Four cases from the locked truth table:
  //   unconditional × daily_refresh   → shouldEnrich=true  → reserveCapacity(3), fetchInstrumentMetadata called
  //   conditional   × daily_refresh   → shouldEnrich=false → reserveCapacity(2), fetchInstrumentMetadata NOT called
  //   conditional   × user_selection  → shouldEnrich=true  → reserveCapacity(3) (sanity)
  //   conditional   × repair          → shouldEnrich=true  → reserveCapacity(3) (allowlist regression guard)
  //
  // Each test overrides `deps.getEffectiveMetadataEnrichmentMode.mockResolvedValueOnce(...)`
  // per the truth-table row under test. All four use `createAuDeps()` (AU path) because:
  //   - `catalogRegistry.get("AU")` returns a provider with `fetchInstrumentMetadata`
  //   - Both call and no-call can be asserted on `auProvider.fetchInstrumentMetadata`
  //   - `reserveCapacity` is on the same AU provider instance
  //
  // TDD-red gates (will be RED until Implementer completes scope-todo items 7+9):
  //   - `deps.getEffectiveMetadataEnrichmentMode` — mock injected by Implementer in createAuDeps()
  //   - `reserveCapacity(2)` for the daily_refresh/conditional row — Implementer changes flat `3` → dynamic
  //   - `fetchInstrumentMetadata` guard — Implementer wraps block in `if (shouldEnrich)`

  describe("metadata enrichment gate (KZO-189)", () => {
    it("unconditional × daily_refresh → enriches: reserveCapacity(3), fetchInstrumentMetadata called", async () => {
      const deps = createAuDeps();
      // Override: unconditional mode — all triggers enrich regardless
      deps.getEffectiveMetadataEnrichmentMode.mockResolvedValueOnce("unconditional");
      const handler = createBackfillHandler(deps as never);

      await handler([
        createJob({
          ticker: "BHP",
          marketCode: "AU",
          userId: "user-1",
          trigger: "daily_refresh",
          startDate: "2024-01-02",
        }) as never,
      ]);

      // reserveCapacity(3) because shouldEnrich=true
      expect(deps.auProvider.reserveCapacity).toHaveBeenCalledWith(3);
      // Metadata enrichment ran
      expect(deps.auProvider.fetchInstrumentMetadata).toHaveBeenCalledWith("BHP");
      expect(deps.persistence.upsertInstrumentCatalog).toHaveBeenCalledTimes(1);
      // KZO-189 gates enrichment only — status flow is unchanged for daily_refresh
    });

    it("conditional × daily_refresh → skips: reserveCapacity(2), fetchInstrumentMetadata NOT called", async () => {
      const deps = createAuDeps();
      // Override: conditional mode + daily_refresh → shouldEnrich=false
      deps.getEffectiveMetadataEnrichmentMode.mockResolvedValueOnce("conditional");
      const handler = createBackfillHandler(deps as never);

      await handler([
        createJob({
          ticker: "BHP",
          marketCode: "AU",
          userId: "user-1",
          trigger: "daily_refresh",
          startDate: "2024-01-02",
        }) as never,
      ]);

      // reserveCapacity(2) because shouldEnrich=false (metadata slot not needed)
      expect(deps.auProvider.reserveCapacity).toHaveBeenCalledWith(2);
      // Metadata enrichment did NOT run
      expect(deps.auProvider.fetchInstrumentMetadata).not.toHaveBeenCalled();
      expect(deps.persistence.upsertInstrumentCatalog).not.toHaveBeenCalled();
      // Backfill still completed (bars + dividends fetched)
      expect(deps.auProvider.fetchBars).toHaveBeenCalledTimes(1);
      expect(deps.auProvider.fetchDividends).toHaveBeenCalledTimes(1);
    });

    it("conditional × user_selection → enriches: reserveCapacity(3) (sanity — ALLOW list)", async () => {
      const deps = createAuDeps();
      // Override: conditional mode + user_selection → shouldEnrich=true (in ALLOW list)
      deps.getEffectiveMetadataEnrichmentMode.mockResolvedValueOnce("conditional");
      const handler = createBackfillHandler(deps as never);

      await handler([
        createJob({
          ticker: "BHP",
          marketCode: "AU",
          userId: "user-1",
          trigger: "user_selection",
          startDate: "2024-01-02",
        }) as never,
      ]);

      expect(deps.auProvider.reserveCapacity).toHaveBeenCalledWith(3);
      expect(deps.auProvider.fetchInstrumentMetadata).toHaveBeenCalledWith("BHP");
      expect(deps.persistence.upsertInstrumentCatalog).toHaveBeenCalledTimes(1);
      expect(deps.updateBackfillStatus).toHaveBeenLastCalledWith("BHP", "AU", "ready");
    });

    it("conditional × repair → enriches: reserveCapacity(3) (regression guard for ALLOW-list lock)", async () => {
      // Repair is in the ALLOW list — conditional mode must NOT skip it.
      // Without this guard, a future refactor that accidentally includes `repair`
      // in the skip-list would cause silent metadata starvation for repair flows.
      const deps = createAuDeps();
      deps.getEffectiveMetadataEnrichmentMode.mockResolvedValueOnce("conditional");
      const handler = createBackfillHandler(deps as never);

      await handler([
        createJob({
          ticker: "BHP",
          marketCode: "AU",
          userId: "user-repair",
          trigger: "repair",
          startDate: "2024-01-02",
        }) as never,
      ]);

      expect(deps.auProvider.reserveCapacity).toHaveBeenCalledWith(3);
      expect(deps.auProvider.fetchInstrumentMetadata).toHaveBeenCalledWith("BHP");
      expect(deps.persistence.upsertInstrumentCatalog).toHaveBeenCalledTimes(1);
    });
  });

  // ── KZO-190: reserveCapacity dynamic count formula ────────────────────────
  //
  // 5 truth-table cells verifying the new formula:
  //   N = (includeBars ? 1 : 0)
  //     + (includeDividends ? 1 : 0)
  //     + (shouldEnrich && catalogProvider?.supportsMetadataEnrichment ? 1 : 0)
  //
  // AU provider (supportsMetadataEnrichment=true): adds the metadata slot when shouldEnrich=T.
  // TW provider (supportsMetadataEnrichment=false): skips the metadata slot even when shouldEnrich=T.
  // includeBars / includeDividends contribute independently regardless of provider.
  //
  // Assertion scope: `reserveCapacity(N)` only. Fetch-call and status-transition
  // coverage lives in other tests; inheriting those assertions here would blur the
  // per-cell contract and create false `not.toHaveBeenCalled` scope-bleed
  // (per `.claude/rules/agent-team-workflow.md § QA assertion scope-bleed`).
  //
  describe("reserveCapacity dynamic count formula (KZO-190)", () => {
    it("AU enrich both: N=3 (bars=1 + dividends=1 + AU-metadata=1)", async () => {
      const deps = createAuDeps();
      // unconditional mode → shouldEnrich=T for all triggers
      deps.getEffectiveMetadataEnrichmentMode.mockResolvedValueOnce("unconditional");
      const handler = createBackfillHandler(deps as never);

      await handler([
        createJob({
          ticker: "BHP",
          marketCode: "AU",
          userId: "user-1",
          trigger: "user_selection",
          startDate: "2024-01-02",
        }) as never,
      ]);

      // AU supportsMetadataEnrichment=true, shouldEnrich=T: 1+1+1=3
      expect(deps.auProvider.reserveCapacity).toHaveBeenCalledWith(3);
    });

    it("TW enrich both (over-reserve fix): N=2, not 3 (bars=1 + dividends=1, TW-metadata no slot)", async () => {
      // KZO-190 fix: FinMind's fetchInstrumentMetadata is a no-op (returns null) that
      // consumes no rate-limit slot. With supportsMetadataEnrichment=false, the metadata
      // slot is not reserved even when shouldEnrich=true. Pre-KZO-190: reserveCapacity(3).
      const deps = createDeps();
      // unconditional mode → shouldEnrich=T
      deps.getEffectiveMetadataEnrichmentMode.mockResolvedValueOnce("unconditional");
      const handler = createBackfillHandler(deps as never);

      await handler([
        createJob({
          ticker: "2330",
          userId: "user-1",
          trigger: "user_selection",
        }) as never,
      ]);

      // TW supportsMetadataEnrichment=false, shouldEnrich=T: 1+1+0=2
      expect(deps.provider.reserveCapacity).toHaveBeenCalledWith(2);
    });

    it("AU no-enrich both (KZO-189 path retained): N=2 (bars=1 + dividends=1, shouldEnrich=F)", async () => {
      // Regression guard: the KZO-189 conditional/daily_refresh skip path is unchanged
      // after KZO-190. AU supportsMetadataEnrichment=true but shouldEnrich=F → no slot added.
      const deps = createAuDeps();
      // conditional + daily_refresh → shouldEnrich=F
      deps.getEffectiveMetadataEnrichmentMode.mockResolvedValueOnce("conditional");
      const handler = createBackfillHandler(deps as never);

      await handler([
        createJob({
          ticker: "BHP",
          marketCode: "AU",
          userId: "user-1",
          trigger: "daily_refresh",
          startDate: "2024-01-02",
        }) as never,
      ]);

      // AU supportsMetadataEnrichment=true, shouldEnrich=F: 1+1+0=2
      expect(deps.auProvider.reserveCapacity).toHaveBeenCalledWith(2);
    });

    it("TW bars-only enrich: N=1 (bars=1, dividends skipped, TW-metadata no slot)", async () => {
      const deps = createDeps();
      // unconditional mode + repair trigger → shouldEnrich=T; dividends explicitly excluded
      deps.getEffectiveMetadataEnrichmentMode.mockResolvedValueOnce("unconditional");
      const handler = createBackfillHandler(deps as never);

      await handler([
        createJob({
          ticker: "2330",
          userId: "user-repair",
          trigger: "repair",
          includeBars: true,
          includeDividends: false,
        }) as never,
      ]);

      // TW supportsMetadataEnrichment=false, shouldEnrich=T, includeDividends=F: 1+0+0=1
      expect(deps.provider.reserveCapacity).toHaveBeenCalledWith(1);
    });

    it("TW dividends-only no-enrich: N=1 (bars skipped, dividends=1, shouldEnrich=F)", async () => {
      const deps = createDeps();
      // conditional + daily_refresh → shouldEnrich=F; bars explicitly excluded
      deps.getEffectiveMetadataEnrichmentMode.mockResolvedValueOnce("conditional");
      const handler = createBackfillHandler(deps as never);

      await handler([
        createJob({
          ticker: "2330",
          trigger: "daily_refresh",
          startDate: "2024-01-02",
          includeBars: false,
          includeDividends: true,
        }) as never,
      ]);

      // TW supportsMetadataEnrichment=false, shouldEnrich=F, includeBars=F: 0+1+0=1
      expect(deps.provider.reserveCapacity).toHaveBeenCalledWith(1);
    });
  });
});
