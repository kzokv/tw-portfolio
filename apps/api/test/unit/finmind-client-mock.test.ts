import { describe, it, expect } from "vitest";
import { MockFinMindClient } from "../../src/services/market-data/finmindClient.mock.js";

describe("MockFinMindClient", () => {
  it("returns deterministic daily bars for a ticker", async () => {
    const client = new MockFinMindClient();
    const bars = await client.fetchDailyBars("2330");

    expect(bars.length).toBe(30);
    expect(bars[0]).toMatchObject({
      ticker: "2330",
      barDate: "2025-01-02",
    });
    expect(bars[0]!.open).toBeGreaterThan(0);
    expect(bars[0]!.high).toBeGreaterThan(bars[0]!.low);
    expect(bars[0]!.volume).toBeGreaterThan(0);
  });

  it("returns deterministic dividend events for a ticker", async () => {
    const client = new MockFinMindClient();
    const dividends = await client.fetchDividendEvents("2330");

    expect(dividends.length).toBe(2);
    expect(dividends[0]).toMatchObject({
      ticker: "2330",
      exDividendDate: "2025-06-15",
      cashDividendPerShare: 2.5,
    });
  });

  it("tracks method calls", async () => {
    const client = new MockFinMindClient();
    await client.fetchDailyBars("2330");
    await client.fetchDividendEvents("0050");

    expect(client.calls).toEqual([
      { method: "fetchDailyBars", ticker: "2330" },
      { method: "fetchDividendEvents", ticker: "0050" },
    ]);
  });
});
