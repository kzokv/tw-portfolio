import { describe, expect, it, vi } from "vitest";
import {
  deriveSeverity,
  handleBatchComplete,
  type BatchCompleteContext,
} from "../../src/services/notificationService.js";

describe("deriveSeverity", () => {
  it("all success → info", () => {
    expect(deriveSeverity(5, 0)).toBe("info");
  });

  it("partial failure → warning", () => {
    expect(deriveSeverity(3, 2)).toBe("warning");
  });

  it("all failed → error", () => {
    expect(deriveSeverity(0, 5)).toBe("error");
  });

  it("single ticker success → info", () => {
    expect(deriveSeverity(1, 0)).toBe("info");
  });

  it("single ticker failure → error", () => {
    expect(deriveSeverity(0, 1)).toBe("error");
  });
});

describe("handleBatchComplete", () => {
  function makeCtx(overrides: Partial<BatchCompleteContext> = {}): BatchCompleteContext {
    return {
      persistence: {
        getUsersMonitoringTicker: vi.fn().mockResolvedValue([]),
        createNotification: vi.fn().mockResolvedValue("notif-1"),
      },
      eventBus: { publishEvent: vi.fn().mockResolvedValue(undefined) },
      batchId: "batch-001",
      tickerResults: {},
      log: { info: vi.fn(), warn: vi.fn() },
      ...overrides,
    };
  }

  it("per-user filtering: filters ticker_results to user's monitored set", async () => {
    const getUsersMonitoringTicker = vi.fn()
      .mockResolvedValueOnce(["user-a"])          // ticker A
      .mockResolvedValueOnce(["user-a", "user-b"]) // ticker B
      .mockResolvedValueOnce(["user-b"]);          // ticker C

    const createNotification = vi.fn().mockResolvedValue("notif-1");

    const ctx = makeCtx({
      persistence: { getUsersMonitoringTicker, createNotification },
      tickerResults: {
        A: { status: "success", barsCount: 10, dividendsCount: 0 },
        B: { status: "success", barsCount: 5, dividendsCount: 1 },
        C: { status: "failed", reason: "timeout" },
      },
    });

    await handleBatchComplete(ctx);

    // user-a monitors A,B → 2 succeeded, 0 failed → info
    const userACall = createNotification.mock.calls.find(
      (c: unknown[]) => (c[0] as { userId: string }).userId === "user-a",
    );
    expect(userACall).toBeDefined();
    expect((userACall![0] as { severity: string }).severity).toBe("info");
    expect((userACall![0] as { detail: unknown }).detail).toEqual({
      A: { status: "success", barsCount: 10, dividendsCount: 0 },
      B: { status: "success", barsCount: 5, dividendsCount: 1 },
    });

    // user-b monitors B,C → 1 succeeded, 1 failed → warning
    const userBCall = createNotification.mock.calls.find(
      (c: unknown[]) => (c[0] as { userId: string }).userId === "user-b",
    );
    expect(userBCall).toBeDefined();
    expect((userBCall![0] as { severity: string }).severity).toBe("warning");
  });

  it("per-user filtering: user monitoring no tickers in batch → no notification", async () => {
    const createNotification = vi.fn();
    const ctx = makeCtx({
      persistence: {
        getUsersMonitoringTicker: vi.fn().mockResolvedValue([]),
        createNotification,
      },
      tickerResults: {
        A: { status: "success", barsCount: 10, dividendsCount: 0 },
      },
    });

    await handleBatchComplete(ctx);

    expect(createNotification).not.toHaveBeenCalled();
  });

  it("per-user filtering: severity derived from user's filtered subset, not global", async () => {
    // User monitors only the failed ticker → severity is "error" even though batch has mixed results
    const getUsersMonitoringTicker = vi.fn()
      .mockResolvedValueOnce([])         // ticker A (success) — user not monitoring
      .mockResolvedValueOnce(["user-x"]); // ticker B (failed) — user monitoring

    const createNotification = vi.fn().mockResolvedValue("notif-1");

    const ctx = makeCtx({
      persistence: { getUsersMonitoringTicker, createNotification },
      tickerResults: {
        A: { status: "success", barsCount: 5, dividendsCount: 0 },
        B: { status: "failed", reason: "rate limit" },
      },
    });

    await handleBatchComplete(ctx);

    expect(createNotification).toHaveBeenCalledTimes(1);
    expect((createNotification.mock.calls[0]![0] as { severity: string }).severity).toBe("error");
  });

  it("batch fan-in: notification title reflects severity and count", async () => {
    const createNotification = vi.fn().mockResolvedValue("notif-1");
    const getUsersMonitoringTicker = vi.fn().mockResolvedValue(["user-a"]);

    // All success → info title
    const ctxInfo = makeCtx({
      persistence: { getUsersMonitoringTicker, createNotification },
      tickerResults: {
        A: { status: "success", barsCount: 3, dividendsCount: 0 },
        B: { status: "success", barsCount: 5, dividendsCount: 1 },
      },
    });
    await handleBatchComplete(ctxInfo);

    const infoTitle = (createNotification.mock.calls[0]![0] as { title: string }).title;
    expect(infoTitle).toContain("completed");
    expect(infoTitle).toContain("2 tickers");

    createNotification.mockClear();
    getUsersMonitoringTicker.mockClear().mockResolvedValue(["user-a"]);

    // Partial failure → warning title with failure count
    const ctxWarning = makeCtx({
      persistence: { getUsersMonitoringTicker, createNotification },
      tickerResults: {
        A: { status: "success", barsCount: 3, dividendsCount: 0 },
        B: { status: "failed", reason: "timeout" },
        C: { status: "failed", reason: "rate limit" },
      },
    });
    await handleBatchComplete(ctxWarning);

    const warningTitle = (createNotification.mock.calls[0]![0] as { title: string }).title;
    expect(warningTitle).toContain("2 of 3 failed");
  });

  it("emits daily_refresh_summary SSE event per user", async () => {
    const publishEvent = vi.fn().mockResolvedValue(undefined);
    const getUsersMonitoringTicker = vi.fn().mockResolvedValue(["user-a"]);

    const ctx = makeCtx({
      persistence: {
        getUsersMonitoringTicker,
        createNotification: vi.fn().mockResolvedValue("notif-1"),
      },
      eventBus: { publishEvent },
      batchId: "batch-42",
      tickerResults: {
        A: { status: "success", barsCount: 5, dividendsCount: 1 },
        B: { status: "failed", reason: "timeout" },
      },
    });

    await handleBatchComplete(ctx);

    expect(publishEvent).toHaveBeenCalledWith("user-a", "daily_refresh_summary", {
      batchId: "batch-42",
      totalTickers: 2,
      succeeded: 1,
      failed: 1,
      severity: "warning",
    });
  });

  it("empty tickerResults → no notifications", async () => {
    const createNotification = vi.fn();
    const ctx = makeCtx({
      persistence: {
        getUsersMonitoringTicker: vi.fn(),
        createNotification,
      },
      tickerResults: {},
    });

    await handleBatchComplete(ctx);

    expect(createNotification).not.toHaveBeenCalled();
  });

  it("continues to next user if createNotification throws", async () => {
    const getUsersMonitoringTicker = vi.fn().mockResolvedValue(["user-a", "user-b"]);
    const createNotification = vi.fn()
      .mockRejectedValueOnce(new Error("db error"))
      .mockResolvedValueOnce("notif-2");
    const publishEvent = vi.fn().mockResolvedValue(undefined);

    const ctx = makeCtx({
      persistence: { getUsersMonitoringTicker, createNotification },
      eventBus: { publishEvent },
      tickerResults: {
        A: { status: "success", barsCount: 3, dividendsCount: 0 },
      },
    });

    await handleBatchComplete(ctx);

    // Both users attempted — error for user-a doesn't block user-b
    expect(createNotification).toHaveBeenCalledTimes(2);
    // SSE published for user-a (before the throw, actually the publish is after — but the
    // loop continues). user-b gets both notification + SSE.
    expect(publishEvent).toHaveBeenCalledTimes(2);
  });
});
