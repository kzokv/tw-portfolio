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
});
