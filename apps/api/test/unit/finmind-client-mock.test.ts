import { describe, it, expect } from "vitest";
import { MockFinMindMarketDataProvider } from "../../src/services/market-data/providers/index.js";

describe("MockFinMindMarketDataProvider", () => {
  it("returns deterministic daily bars for a ticker", async () => {
    const client = new MockFinMindMarketDataProvider();
    const bars = await client.fetchBars("2330");

    expect(bars.length).toBe(30);
    expect(bars[0]).toMatchObject({
      ticker: "2330",
      barDate: "2025-01-02",
      sourceId: "finmind",
    });
    expect(bars[0]!.open).toBeGreaterThan(0);
    expect(bars[0]!.high).toBeGreaterThan(bars[0]!.low);
    expect(bars[0]!.volume).toBeGreaterThan(0);
  });

  it("returns deterministic dividend events for a ticker", async () => {
    const client = new MockFinMindMarketDataProvider();
    const dividends = await client.fetchDividends("2330");

    expect(dividends.length).toBe(2);
    expect(dividends[0]).toMatchObject({
      ticker: "2330",
      exDividendDate: "2025-06-15",
      cashDividendPerShare: 2.5,
      sourceId: "finmind",
    });
  });

  it("tracks method calls", async () => {
    const client = new MockFinMindMarketDataProvider();
    await client.fetchBars("2330", "2026-03-24");
    await client.fetchDividends("0050");

    expect(client.calls).toEqual([
      { method: "fetchBars", ticker: "2330", startDate: "2026-03-24" },
      { method: "fetchDividends", ticker: "0050" },
    ]);
  });
});
