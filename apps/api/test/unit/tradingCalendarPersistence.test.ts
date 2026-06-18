import { describe, expect, it } from "vitest";
import { MemoryPersistence } from "../../src/persistence/memory.js";

describe("trading calendar persistence helpers", () => {
  it("MemoryPersistence.getDistinctBarDates returns ascending distinct dates filtered by market and cutoff", async () => {
    const persistence = new MemoryPersistence();
    persistence._seedDailyBars([
      {
        ticker: "KZO173M1",
        marketCode: "TW",
        barDate: "2026-05-01",
        open: 1,
        high: 1,
        low: 1,
        close: 1,
        volume: 1,
        source: "test",
        ingestedAt: "2026-05-01T00:00:00.000Z",
      },
      {
        ticker: "KZO173M2",
        marketCode: "TW",
        barDate: "2026-05-03",
        open: 1,
        high: 1,
        low: 1,
        close: 1,
        volume: 1,
        source: "test",
        ingestedAt: "2026-05-03T00:00:00.000Z",
      },
      {
        ticker: "KZO173M3",
        marketCode: "TW",
        barDate: "2026-05-03",
        open: 1,
        high: 1,
        low: 1,
        close: 1,
        volume: 1,
        source: "test",
        ingestedAt: "2026-05-03T00:00:00.000Z",
      },
      {
        ticker: "KZO173M4",
        marketCode: "US",
        barDate: "2026-05-04",
        open: 1,
        high: 1,
        low: 1,
        close: 1,
        volume: 1,
        source: "test",
        ingestedAt: "2026-05-04T00:00:00.000Z",
      },
    ]);

    await expect(persistence.getDistinctBarDates("TW", "2026-05-02")).resolves.toEqual([
      "2026-05-03",
    ]);
  });

  it("MemoryPersistence._seedDailyBars replaces matching ticker-market-date rows", async () => {
    const persistence = new MemoryPersistence();
    persistence._seedDailyBars([{
      ticker: "2330",
      marketCode: "TW",
      barDate: "2026-06-17",
      open: 2385,
      high: 2385,
      low: 2385,
      close: 2385,
      volume: 0,
      source: "twse-stock-day-close",
      quality: "close_only",
      ingestedAt: "2026-06-17T06:00:00.000Z",
    }]);
    persistence._seedDailyBars([{
      ticker: "2330",
      marketCode: "TW",
      barDate: "2026-06-17",
      open: 2390,
      high: 2420,
      low: 2380,
      close: 2410,
      volume: 123_456,
      source: "finmind",
      quality: "full_bar",
      ingestedAt: "2026-06-17T07:00:00.000Z",
    }]);

    await expect(persistence.getDailyBarsForTickerMarket("2330", "TW", "2026-06-17", "2026-06-17"))
      .resolves.toEqual([expect.objectContaining({
        close: 2410,
        volume: 123_456,
        source: "finmind",
        quality: "full_bar",
      })]);
  });

  it("MemoryPersistence._seedDailyBars preserves full bars when a close-only row conflicts", async () => {
    const persistence = new MemoryPersistence();
    persistence._seedDailyBars([{
      ticker: "2330",
      marketCode: "TW",
      barDate: "2026-06-17",
      open: 2390,
      high: 2420,
      low: 2380,
      close: 2410,
      volume: 123_456,
      source: "finmind",
      quality: "full_bar",
      ingestedAt: "2026-06-17T07:00:00.000Z",
    }]);
    persistence._seedDailyBars([{
      ticker: "2330",
      marketCode: "TW",
      barDate: "2026-06-17",
      open: 2385,
      high: 2385,
      low: 2385,
      close: 2385,
      volume: 0,
      source: "twse-stock-day-close",
      quality: "close_only",
      ingestedAt: "2026-06-17T08:00:00.000Z",
    }]);

    await expect(persistence.getDailyBarsForTickerMarket("2330", "TW", "2026-06-17", "2026-06-17"))
      .resolves.toEqual([expect.objectContaining({
        close: 2410,
        volume: 123_456,
        source: "finmind",
        quality: "full_bar",
      })]);
  });
});
