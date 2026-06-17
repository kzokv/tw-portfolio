import { describe, expect, it, vi } from "vitest";
import { upsertDailyBars } from "../../../src/services/market-data/upserts.js";

describe("upsertDailyBars quality semantics", () => {
  it("stamps quality values and keeps full_bar rows authoritative on conflict", async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 2 });
    const pool = { query } as unknown as Parameters<typeof upsertDailyBars>[0];

    const rowCount = await upsertDailyBars(pool, [
      {
        ticker: "2330",
        marketCode: "TW",
        barDate: "2026-06-16",
        open: 950,
        high: 955,
        low: 945,
        close: 952,
        volume: 1000,
        quality: "close_only",
        sourceId: "twse-stock-day",
      },
      {
        ticker: "AAPL",
        marketCode: "US",
        barDate: "2026-06-16",
        open: 210,
        high: 212,
        low: 209,
        close: 211,
        volume: 2000,
        quality: "full_bar",
        sourceId: "yahoo-chart-close",
      },
    ]);

    expect(rowCount).toBe(2);
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("quality, source, ingested_at");
    expect(sql).toContain("quality = EXCLUDED.quality");
    expect(sql).toContain("WHERE market_data.daily_bars.quality <> 'full_bar' OR EXCLUDED.quality = 'full_bar'");
    expect(params[8]).toEqual(["close_only", "full_bar"]);
    expect(params[9]).toEqual(["twse-stock-day", "yahoo-chart-close"]);
  });

  it("defaults missing quality to full_bar for canonical provider rows", async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1 });
    const pool = { query } as unknown as Parameters<typeof upsertDailyBars>[0];

    await upsertDailyBars(pool, [{
      ticker: "BHP",
      marketCode: "AU",
      barDate: "2026-06-16",
      open: 44,
      high: 45,
      low: 43,
      close: 44.5,
      volume: 3000,
      sourceId: "yahoo-finance-au",
    }]);

    const [, params] = query.mock.calls[0] as [string, unknown[]];
    expect(params[8]).toEqual(["full_bar"]);
  });

  it("returns early without querying when the batch is empty", async () => {
    const query = vi.fn();
    const pool = { query } as unknown as Parameters<typeof upsertDailyBars>[0];

    await expect(upsertDailyBars(pool, [])).resolves.toBe(0);
    expect(query).not.toHaveBeenCalled();
  });
});
