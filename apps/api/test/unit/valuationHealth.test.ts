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
});
