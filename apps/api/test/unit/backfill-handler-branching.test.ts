import { describe, expect, it, vi } from "vitest";
import type { JobWithMetadata } from "pg-boss";
import type { RawDailyBar, DividendRecord } from "../../src/services/market-data/types.js";
import { createBackfillHandler } from "../../src/services/market-data/backfillWorker.js";

function createJob(
  data: Record<string, unknown>,
  retryCount = 0,
  retryLimit = 3,
  priority?: number,
): JobWithMetadata<Record<string, unknown>> {
  return {
    data,
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
    },
  ];
}

function createDeps() {
  return {
    pool: { query: vi.fn().mockResolvedValue({ rowCount: 1 }) },
    finmind: {
      fetchDailyBars: vi.fn().mockResolvedValue(createSuccessBars()),
      fetchDividendEvents: vi.fn().mockResolvedValue(createSuccessDividends()),
    },
    rateLimiter: {
      canConsume: vi.fn().mockReturnValue(true),
      consume: vi.fn(),
      msUntilAvailable: vi.fn(),
    },
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
    const barsCall = deps.finmind.fetchDailyBars.mock.calls[0] ?? [];
    const dividendsCall = deps.finmind.fetchDividendEvents.mock.calls[0] ?? [];
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
    deps.finmind.fetchDailyBars.mockRejectedValue(new Error("FinMind outage"));
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
    deps.finmind.fetchDailyBars.mockRejectedValue(new Error("No bars"));
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
    deps.rateLimiter.canConsume.mockReturnValue(false);
    deps.rateLimiter.msUntilAvailable.mockReturnValue(30_000);
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

    expect(deps.boss.send).toHaveBeenCalledWith(
      "finmind-backfill",
      { ticker: "2330", trigger: "daily_refresh", startDate: "2026-03-24" },
      { startAfter: 30, singletonKey: "2330", priority: 10 },
    );
    expect(deps.updateBackfillStatus).not.toHaveBeenCalled();
    expect(deps.finmind.fetchDailyBars).not.toHaveBeenCalled();
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
    expect(deps.finmind.fetchDailyBars).toHaveBeenCalledWith("2330", "2026-03-01", "2026-03-31");
    expect(deps.finmind.fetchDividendEvents).toHaveBeenCalledWith("2330", "2026-03-01", "2026-03-31");
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

    expect(deps.finmind.fetchDailyBars).not.toHaveBeenCalled();
    expect(deps.finmind.fetchDividendEvents).toHaveBeenCalledTimes(1);
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

    expect(deps.finmind.fetchDailyBars).toHaveBeenCalledTimes(1);
    expect(deps.finmind.fetchDividendEvents).not.toHaveBeenCalled();
    expect(deps.eventBus.publishEvent).toHaveBeenNthCalledWith(2, "user-repair", "repair_complete", {
      ticker: "2330",
      barsCount: 1,
      dividendsCount: 0,
    });
  });

  it("repair flow: on final retry emits repair_failed and never updates backfill status", async () => {
    const deps = createDeps();
    deps.finmind.fetchDailyBars.mockRejectedValue(new Error("repair bars failed"));
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

  it("rate-limiter cost: repair with single dataset consumes one call and preserves job priority on reschedule", async () => {
    const deps = createDeps();
    deps.rateLimiter.canConsume.mockImplementation((cost: number) => cost < 2);
    deps.rateLimiter.msUntilAvailable.mockReturnValue(20_000);
    const handler = createBackfillHandler(deps as never);

    await handler([
      createJob(
        {
          ticker: "2330",
          userId: "user-repair",
          trigger: "repair",
          includeBars: false,
          includeDividends: true,
        },
        0,
        3,
        5,
      ) as never,
    ]);

    expect(deps.rateLimiter.canConsume).toHaveBeenCalledWith(1);
    expect(deps.boss.send).not.toHaveBeenCalled();
    expect(deps.rateLimiter.consume).toHaveBeenCalledWith(1);
  });
});
