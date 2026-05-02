import { describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import type { JobWithMetadata } from "pg-boss";
import type { MarketCode } from "@tw-portfolio/domain";
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
  const marketDataRegistry = new Map<MarketCode, typeof provider>();
  marketDataRegistry.set("TW", provider);
  return {
    pool: { query: vi.fn().mockResolvedValue({ rowCount: 1 }) },
    provider,
    marketDataRegistry,
    // KZO-170: `resolveMarketCode` was deleted entirely (heuristic removed).
    // Producers now stamp `marketCode` directly on `BackfillJobData`, and the
    // worker validates via Zod schema at handler entry.
    eventBus: { publishEvent: vi.fn().mockResolvedValue(undefined) },
    boss: { send: vi.fn().mockResolvedValue(undefined) },
    updateBackfillStatus: vi.fn().mockResolvedValue(undefined),
    getUsersMonitoringTicker: vi.fn().mockResolvedValue(["user-1", "user-2"]),
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
    expect(deps.updateBackfillStatus).toHaveBeenCalledWith("2330", "ready");
    const barsCall = deps.provider.fetchBars.mock.calls[0] ?? [];
    const dividendsCall = deps.provider.fetchDividends.mock.calls[0] ?? [];
    expect(barsCall[0]).toBe("2330");
    expect(barsCall[1]).toBe("2026-03-24");
    expect(dividendsCall[0]).toBe("2330");
    expect(dividendsCall[1]).toBe("2026-03-24");
    expect(deps.getUsersMonitoringTicker).toHaveBeenCalledWith("2330");
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

    expect(deps.updateBackfillStatus).toHaveBeenNthCalledWith(1, "2330", "backfilling");
    expect(deps.updateBackfillStatus).toHaveBeenNthCalledWith(2, "2330", "failed");
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
    expect(deps.updateBackfillStatus).not.toHaveBeenCalledWith("2330", "failed");
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
    expect(deps.updateBackfillStatus).not.toHaveBeenCalledWith("2330", "failed");
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

  // KZO-163 HIGH-1: single-call invocations (includeBars XOR includeDividends) must
  // skip the reserveCapacity pre-flight — there's no starvation risk with one call.
  it("skips reserveCapacity for single-call invocations (includeDividends=false)", async () => {
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

    expect(provider.reserveCapacity).not.toHaveBeenCalled();
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
});
