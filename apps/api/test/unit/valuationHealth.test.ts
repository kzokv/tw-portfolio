import { describe, expect, it, vi } from "vitest";
import { buildValuationHealth } from "../../src/services/valuationHealth.js";

function scopeKey(accountId: string, ticker: string, marketCode: string): string {
  return `${accountId}\0${ticker}\0${marketCode}`;
}

describe("buildValuationHealth", () => {
  it("treats rounding-only deltas below the minor-unit tolerance as healthy", async () => {
    const dto = await buildValuationHealth({
      app: {
        persistence: {
          getLatestBarDatesForReconciliation: vi.fn().mockResolvedValue(new Map([["BHP:AU", "2026-06-13"]])),
          getLatestHoldingSnapshotDatesByScope: vi.fn().mockResolvedValue(new Map([["acc-1\0BHP\0AU", "2026-06-13"]])),
          getInstrument: vi.fn().mockResolvedValue({ barsBackfillStatus: "ready" }),
        },
      } as never,
      userId: "user-1",
      store: {} as never,
      reportingCurrency: "AUD",
      currentValueAmount: 100.004,
      asOf: "2026-06-14T10:00:00.000Z",
      holdingGroups: [
        {
          ticker: "BHP",
          marketCode: "AU",
          reportingMarketValueAmount: 100.004,
          children: [{ accountId: "acc-1", ticker: "BHP", marketCode: "AU" }],
        },
      ] as never,
      performance: {
        points: [
          { fxAvailable: true, marketValueAmount: 100.0 },
        ],
        diagnostics: {
          latestReliableValuationDate: "2026-06-13",
          latestSnapshotDate: "2026-06-13",
          expectedLatestValuationDate: "2026-06-13",
        },
      } as never,
    });

    expect(dto.status).toBe("healthy");
    expect(dto.reason).toBe("within_minor_unit_tolerance");
    expect(dto.deltaAmount).toBeCloseTo(0.004, 6);
    expect(dto.latestBarAsOf).toBe("2026-06-13");
    expect(dto.affectedHoldings).toEqual([]);
  });

  it("marks a valuation as material when the relative threshold trips", async () => {
    const dto = await buildValuationHealth({
      app: {
        persistence: {
          getLatestBarDatesForReconciliation: vi.fn().mockResolvedValue(new Map([["2330:TW", "2026-06-13"]])),
          getLatestHoldingSnapshotDatesByScope: vi.fn().mockResolvedValue(new Map([[scopeKey("acc-1", "2330", "TW"), "2026-06-12"]])),
          getInstrument: vi.fn().mockResolvedValue({ barsBackfillStatus: "ready" }),
        },
      } as never,
      userId: "user-1",
      store: {} as never,
      reportingCurrency: "TWD",
      currentValueAmount: 10_000,
      asOf: "2026-06-14T10:00:00.000Z",
      holdingGroups: [
        {
          ticker: "2330",
          marketCode: "TW",
          reportingMarketValueAmount: 10_000,
          children: [{ accountId: "acc-1", ticker: "2330", marketCode: "TW" }],
        },
      ] as never,
      performance: {
        points: [
          { fxAvailable: true, marketValueAmount: 9_900 },
        ],
        diagnostics: {
          latestReliableValuationDate: "2026-06-13",
          latestSnapshotDate: "2026-06-12",
          expectedLatestValuationDate: "2026-06-13",
        },
      } as never,
    });

    expect(dto.status).toBe("material");
    expect(dto.reason).toBe("relative_threshold_exceeded");
    expect(dto.relativeDeltaBps).toBe(100);
  });

  it("surfaces active-held diagnostics from latest bars, snapshots, and backfill state", async () => {
    const dto = await buildValuationHealth({
      app: {
        persistence: {
          getLatestBarDatesForReconciliation: vi.fn().mockResolvedValue(new Map([
            ["7203:US", null],
            ["005930:KR", "2026-06-13"],
          ])),
          getLatestHoldingSnapshotDatesByScope: vi.fn().mockResolvedValue(new Map([
            [scopeKey("acc-1", "7203", "US"), null],
            [scopeKey("acc-2", "005930", "KR"), "2026-06-11"],
          ])),
          getInstrument: vi.fn().mockImplementation(async (ticker: string) => {
            if (ticker === "7203") return { barsBackfillStatus: "failed" };
            return { barsBackfillStatus: "ready" };
          }),
        },
      } as never,
      userId: "user-1",
      store: {} as never,
      reportingCurrency: "USD",
      currentValueAmount: 500,
      asOf: "2026-06-14T10:00:00.000Z",
      holdingGroups: [
        {
          ticker: "7203",
          marketCode: "US",
          reportingMarketValueAmount: 250,
          children: [{ accountId: "acc-1", ticker: "7203", marketCode: "US" }],
        },
        {
          ticker: "005930",
          marketCode: "KR",
          reportingMarketValueAmount: 250,
          children: [{ accountId: "acc-2", ticker: "005930", marketCode: "KR" }],
        },
      ] as never,
      performance: {
        points: [{ fxAvailable: true, marketValueAmount: 500 }],
        diagnostics: {
          latestReliableValuationDate: "2026-06-13",
          latestSnapshotDate: "2026-06-12",
          expectedLatestValuationDate: "2026-06-13",
        },
      } as never,
    });

    expect(dto.affectedHoldings).toEqual([
      expect.objectContaining({
        ticker: "7203",
        status: "backfill_failed",
        recommendedAction: "run_backfill",
      }),
      expect.objectContaining({
        ticker: "005930",
        status: "stale_snapshot",
        recommendedAction: "run_snapshot_repair",
      }),
    ]);
    expect(dto.recommendedActions).toEqual(["run_backfill", "run_snapshot_repair"]);
  });

  it("keeps holdings healthy when their snapshot matches their own market bar date", async () => {
    const dto = await buildValuationHealth({
      app: {
        persistence: {
          getLatestBarDatesForReconciliation: vi.fn().mockResolvedValue(new Map([
            ["2330:TW", "2026-06-12"],
            ["AAPL:US", "2026-06-13"],
          ])),
          getLatestHoldingSnapshotDatesByScope: vi.fn().mockResolvedValue(new Map([
            [scopeKey("acc-1", "2330", "TW"), "2026-06-12"],
            [scopeKey("acc-2", "AAPL", "US"), "2026-06-13"],
          ])),
          getInstrument: vi.fn().mockResolvedValue({ barsBackfillStatus: "ready" }),
        },
      } as never,
      userId: "user-1",
      store: {} as never,
      reportingCurrency: "USD",
      currentValueAmount: 500,
      asOf: "2026-06-14T10:00:00.000Z",
      holdingGroups: [
        {
          ticker: "2330",
          marketCode: "TW",
          reportingMarketValueAmount: 250,
          children: [{ accountId: "acc-1", ticker: "2330", marketCode: "TW" }],
        },
        {
          ticker: "AAPL",
          marketCode: "US",
          reportingMarketValueAmount: 250,
          children: [{ accountId: "acc-2", ticker: "AAPL", marketCode: "US" }],
        },
      ] as never,
      performance: {
        points: [{ fxAvailable: true, marketValueAmount: 500 }],
        diagnostics: {
          latestReliableValuationDate: "2026-06-13",
          latestSnapshotDate: "2026-06-13",
          expectedLatestValuationDate: "2026-06-13",
        },
      } as never,
    });

    expect(dto.latestBarAsOf).toBe("2026-06-13");
    expect(dto.expectedLatestValuationDate).toBe("2026-06-13");
    expect(dto.affectedHoldings).toEqual([]);
    expect(dto.recommendedActions).toEqual([]);
  });

  it("marks holdings stale against their own latest bar date", async () => {
    const dto = await buildValuationHealth({
      app: {
        persistence: {
          getLatestBarDatesForReconciliation: vi.fn().mockResolvedValue(new Map([["BHP:AU", "2026-06-13"]])),
          getLatestHoldingSnapshotDatesByScope: vi.fn().mockResolvedValue(new Map([[scopeKey("acc-1", "BHP", "AU"), "2026-06-12"]])),
          getInstrument: vi.fn().mockResolvedValue({ barsBackfillStatus: "ready" }),
        },
      } as never,
      userId: "user-1",
      store: {} as never,
      reportingCurrency: "AUD",
      currentValueAmount: 10_500,
      asOf: "2026-06-14T10:00:00.000Z",
      holdingGroups: [
        {
          ticker: "BHP",
          marketCode: "AU",
          reportingMarketValueAmount: 10_500,
          children: [{ accountId: "acc-1", ticker: "BHP", marketCode: "AU" }],
        },
      ] as never,
      performance: {
        points: [{ fxAvailable: true, marketValueAmount: 10_000 }],
        diagnostics: {
          latestReliableValuationDate: "2026-06-12",
          latestSnapshotDate: "2026-06-12",
          expectedLatestValuationDate: "2026-06-13",
        },
      } as never,
    });

    expect(dto.status).toBe("material");
    expect(dto.affectedHoldings).toEqual([
      expect.objectContaining({
        ticker: "BHP",
        latestSnapshotDate: "2026-06-12",
        status: "stale_snapshot",
        recommendedAction: "run_snapshot_repair",
      }),
    ]);
    expect(dto.recommendedActions).toEqual(["run_snapshot_repair"]);
  });

  it("does not recommend snapshot repair when a holding opens after the latest available bar", async () => {
    const dto = await buildValuationHealth({
      app: {
        persistence: {
          getLatestBarDatesForReconciliation: vi.fn().mockResolvedValue(new Map([["VRT:US", "2026-06-13"]])),
          getLatestHoldingSnapshotDatesByScope: vi.fn().mockResolvedValue(new Map([[scopeKey("acc-1", "VRT", "US"), null]])),
          getInstrument: vi.fn().mockResolvedValue({ barsBackfillStatus: "ready" }),
        },
      } as never,
      userId: "user-1",
      store: {
        accounting: {
          facts: {
            tradeEvents: [
              {
                id: "trade-1",
                accountId: "acc-1",
                ticker: "VRT",
                marketCode: "US",
                type: "BUY",
                quantity: 10,
                tradeDate: "2026-06-14",
              },
            ],
          },
        },
      } as never,
      reportingCurrency: "USD",
      currentValueAmount: 1_000,
      asOf: "2026-06-14T10:00:00.000Z",
      holdingGroups: [
        {
          ticker: "VRT",
          marketCode: "US",
          reportingMarketValueAmount: 1_000,
          children: [{ accountId: "acc-1", ticker: "VRT", marketCode: "US" }],
        },
      ] as never,
      performance: {
        points: [{ fxAvailable: true, marketValueAmount: 0 }],
        diagnostics: {
          latestReliableValuationDate: "2026-06-13",
          latestSnapshotDate: "2026-06-13",
          expectedLatestValuationDate: "2026-06-13",
        },
      } as never,
    });

    expect(dto.status).toBe("material");
    expect(dto.affectedHoldings).toEqual([]);
    expect(dto.recommendedActions).toEqual([]);
  });
});
