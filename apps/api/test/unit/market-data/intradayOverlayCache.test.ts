import { describe, expect, it, vi } from "vitest";
import { createIntradayOverlayCache } from "../../../src/services/market-data/intradayOverlayCache.js";

describe("intradayOverlayCache", () => {
  const overlay = {
    ticker: "2330",
    marketCode: "TW",
    price: 1010,
    previousClose: 1005,
    asOfDate: "2026-06-17",
    asOfTimestamp: "2026-06-17T05:01:00.000Z",
    observedAt: "2026-06-17T05:02:00.000Z",
    sourceKind: "intraday_yahoo_chart" as const,
    source: "yahoo-finance-chart",
    currency: "TWD",
  };

  it("returns null and logs when the backing cache read fails", async () => {
    const log = { warn: vi.fn() };
    const cache = createIntradayOverlayCache({
      getLatestIntradayOverlay: vi.fn().mockRejectedValue(new Error("redis down")),
      getLatestIntradayOverlays: vi.fn(),
      setLatestIntradayOverlay: vi.fn(),
      deleteLatestIntradayOverlay: vi.fn(),
    }, log);

    await expect(cache.getLatest("2330", "TW")).resolves.toBeNull();
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ ticker: "2330", marketCode: "TW" }),
      "intraday_overlay_cache_read_failed_falling_back_to_daily_bars",
    );
  });

  it("delegates writes and preserves the stable sourceKind fact", async () => {
    const setLatestIntradayOverlay = vi.fn().mockResolvedValue(undefined);
    const cache = createIntradayOverlayCache({
      getLatestIntradayOverlay: vi.fn(),
      getLatestIntradayOverlays: vi.fn(),
      setLatestIntradayOverlay,
      deleteLatestIntradayOverlay: vi.fn(),
    });

    await cache.setLatest(overlay);

    expect(setLatestIntradayOverlay).toHaveBeenCalledWith(
      expect.objectContaining({ sourceKind: "intraday_yahoo_chart" }),
    );
  });
});
