import { describe, expect, it, vi } from "vitest";
import {
  closeRefreshSingletonKey,
  createCloseRefreshHandler,
  enqueueCloseRefresh,
  enqueueScheduledCloseRefreshes,
} from "../../../src/services/market-data/closeRefreshWorker.js";

describe("closeRefreshWorker", () => {
  it("uses singleton keys per market+ticker and no-ops when no boss is available", async () => {
    expect(closeRefreshSingletonKey("2330", "TW")).toBe("ticker-close-refresh:TW:2330");
    await expect(
      enqueueCloseRefresh(null, { ticker: "2330", marketCode: "TW", requestedAt: "2026-06-17T06:00:00.000Z" }),
    ).resolves.toBeNull();
  });

  it("delegates jobs through close-refresh orchestration dependencies", async () => {
    const provider = {
      providerId: "primary",
      fetchBars: vi.fn().mockResolvedValue([{
        ticker: "2330",
        barDate: "2026-06-17",
        open: 1000,
        high: 1015,
        low: 995,
        close: 1010,
        volume: 12_345,
        sourceId: "primary",
      }]),
      fetchDividends: vi.fn(),
      reserveCapacity: vi.fn(),
    };
    const upsertBars = vi.fn().mockResolvedValue(undefined);
    const handler = createCloseRefreshHandler({
      persistence: { getLatestBarsByTickerMarket: vi.fn().mockResolvedValue([]) },
      tradingCalendar: { isTradingDay: vi.fn().mockResolvedValue(true) },
      marketDataProviders: new Map([["TW", provider]]),
      upsertBars,
      closeRefreshGraceMinutes: 0,
      supportedMarkets: ["TW", "US", "AU", "KR"],
      log: { info: vi.fn(), warn: vi.fn() },
    });

    await handler([{ id: "job-1", data: { ticker: "2330", marketCode: "TW", requestedAt: "2026-06-17T06:00:00.000Z" } }] as never);

    expect(provider.fetchBars).toHaveBeenCalledWith("2330", "2026-06-17", "2026-06-17");
    expect(upsertBars).toHaveBeenCalledWith(
      [expect.objectContaining({ ticker: "2330", quality: "full_bar" })],
      "TW",
    );
  });

  it("resolves close-refresh supported markets per job", async () => {
    const provider = {
      providerId: "primary",
      fetchBars: vi.fn().mockResolvedValue([{
        ticker: "2330",
        barDate: "2026-06-17",
        open: 1000,
        high: 1015,
        low: 995,
        close: 1010,
        volume: 12_345,
        sourceId: "primary",
      }]),
      fetchDividends: vi.fn(),
      reserveCapacity: vi.fn(),
    };
    const resolveRuntimeConfig = vi.fn()
      .mockReturnValueOnce({ closeRefreshGraceMinutes: 0, supportedMarkets: ["US"] })
      .mockReturnValueOnce({ closeRefreshGraceMinutes: 0, supportedMarkets: ["TW"] });
    const handler = createCloseRefreshHandler({
      persistence: { getLatestBarsByTickerMarket: vi.fn().mockResolvedValue([]) },
      tradingCalendar: { isTradingDay: vi.fn().mockResolvedValue(true) },
      marketDataProviders: new Map([["TW", provider]]),
      upsertBars: vi.fn().mockResolvedValue(undefined),
      closeRefreshGraceMinutes: 180,
      supportedMarkets: ["TW", "US", "AU", "KR"],
      resolveRuntimeConfig,
      log: { info: vi.fn(), warn: vi.fn() },
    });

    await handler([
      { id: "job-1", data: { ticker: "2330", marketCode: "TW", requestedAt: "2026-06-17T06:00:00.000Z" } },
      { id: "job-2", data: { ticker: "2330", marketCode: "TW", requestedAt: "2026-06-17T06:00:00.000Z" } },
    ] as never);

    expect(resolveRuntimeConfig).toHaveBeenCalledTimes(2);
    expect(provider.fetchBars).toHaveBeenCalledTimes(1);
  });

  it("fans out scheduled scans into singleton per-pair close refresh jobs", async () => {
    const boss = { send: vi.fn().mockResolvedValueOnce("job-1").mockResolvedValueOnce(null) };
    const log = { info: vi.fn(), warn: vi.fn() };

    const result = await enqueueScheduledCloseRefreshes({
      boss,
      persistence: {
        listHeldTickerMarketPairs: vi.fn().mockResolvedValue([
          { ticker: "2330", marketCode: "TW" },
          { ticker: "AAPL", marketCode: "US" },
          { ticker: "7203", marketCode: "JP" },
        ]),
      },
      requestedAt: "2026-06-17T08:30:00.000Z",
      supportedMarkets: ["TW", "US", "AU", "KR"],
      log,
    });

    expect(result).toEqual({ pairCount: 2, enqueuedCount: 1, droppedCount: 1 });
    expect(boss.send).toHaveBeenCalledWith(
      "ticker-close-refresh",
      { ticker: "2330", marketCode: "TW", requestedAt: "2026-06-17T08:30:00.000Z" },
      { singletonKey: "ticker-close-refresh:TW:2330" },
    );
    expect(boss.send).toHaveBeenCalledWith(
      "ticker-close-refresh",
      { ticker: "AAPL", marketCode: "US", requestedAt: "2026-06-17T08:30:00.000Z" },
      { singletonKey: "ticker-close-refresh:US:AAPL" },
    );
    expect(log.info).toHaveBeenCalledWith(
      { pairCount: 2, enqueuedCount: 1, droppedCount: 1 },
      "close_refresh_scheduled_scan_enqueued",
    );
  });

  it("resolves scheduled scan supported markets per job", async () => {
    const boss = { send: vi.fn().mockResolvedValue("job-1") };
    const resolveRuntimeConfig = vi.fn()
      .mockReturnValueOnce({ closeRefreshGraceMinutes: 0, supportedMarkets: ["TW"] })
      .mockReturnValueOnce({ closeRefreshGraceMinutes: 0, supportedMarkets: ["US"] });
    const handler = createCloseRefreshHandler({
      boss,
      persistence: {
        getLatestBarsByTickerMarket: vi.fn(),
        listHeldTickerMarketPairs: vi.fn().mockResolvedValue([
          { ticker: "2330", marketCode: "TW" },
          { ticker: "AAPL", marketCode: "US" },
        ]),
      },
      tradingCalendar: { isTradingDay: vi.fn() },
      marketDataProviders: new Map(),
      upsertBars: vi.fn(),
      closeRefreshGraceMinutes: 180,
      supportedMarkets: ["TW", "US", "AU", "KR"],
      resolveRuntimeConfig,
      log: { info: vi.fn(), warn: vi.fn() },
    });

    await handler([
      { id: "scan-1", data: { kind: "scheduled_scan", requestedAt: "2026-06-17T08:30:00.000Z" } },
      { id: "scan-2", data: { kind: "scheduled_scan", requestedAt: "2026-06-17T08:30:00.000Z" } },
    ] as never);

    expect(resolveRuntimeConfig).toHaveBeenCalledTimes(2);
    expect(boss.send).toHaveBeenCalledWith(
      "ticker-close-refresh",
      { ticker: "2330", marketCode: "TW", requestedAt: "2026-06-17T08:30:00.000Z" },
      { singletonKey: "ticker-close-refresh:TW:2330" },
    );
    expect(boss.send).toHaveBeenCalledWith(
      "ticker-close-refresh",
      { ticker: "AAPL", marketCode: "US", requestedAt: "2026-06-17T08:30:00.000Z" },
      { singletonKey: "ticker-close-refresh:US:AAPL" },
    );
  });
});
