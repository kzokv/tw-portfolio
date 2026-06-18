import { describe, expect, it, vi } from "vitest";
import { buildValuationHealth } from "../../src/services/valuationHealth.js";

function scopeKey(accountId: string, ticker: string, marketCode: string): string {
  return `${accountId}\0${ticker}\0${marketCode}`;
}

function dailyPriceState(overrides: Record<string, unknown> = {}) {
  return {
    basis: "today_close",
    chipState: "closed",
    marketState: "closed",
    source: "test",
    sourceKind: "primary_daily",
    asOfDate: "2026-06-13",
    asOfTimestamp: null,
    observedAt: "2026-06-13T00:00:00.000Z",
    delaySeconds: null,
    marketTimeZone: "UTC",
    quality: "full_bar",
    ...overrides,
  };
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
          priceState: dailyPriceState(),
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
          priceState: dailyPriceState(),
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

  it("suppresses overlay-only valuation deltas when displayed prices are intraday", async () => {
    const dto = await buildValuationHealth({
      app: {
        persistence: {
          getLatestBarDatesForReconciliation: vi.fn().mockResolvedValue(new Map([["2330:TW", "2026-06-13"]])),
          getLatestHoldingSnapshotDatesByScope: vi.fn().mockResolvedValue(new Map([[scopeKey("acc-1", "2330", "TW"), "2026-06-13"]])),
          getInstrument: vi.fn().mockResolvedValue({ barsBackfillStatus: "ready" }),
        },
      } as never,
      userId: "user-1",
      store: {} as never,
      reportingCurrency: "TWD",
      currentValueAmount: 10_000,
      asOf: "2026-06-17T10:00:00.000Z",
      holdingGroups: [
        {
          ticker: "2330",
          marketCode: "TW",
          reportingMarketValueAmount: 10_000,
          priceState: dailyPriceState({
            basis: "intraday",
            chipState: "open_fresh",
            marketState: "open",
            quality: null,
          }),
          children: [{ accountId: "acc-1", ticker: "2330", marketCode: "TW" }],
        },
      ] as never,
      performance: {
        points: [{ fxAvailable: true, marketValueAmount: 9_900 }],
        diagnostics: {
          latestReliableValuationDate: "2026-06-13",
          latestSnapshotDate: "2026-06-13",
          expectedLatestValuationDate: "2026-06-13",
        },
      } as never,
    });

    expect(dto.status).toBe("healthy");
    expect(dto.reason).toBe("within_threshold");
    expect(dto.affectedHoldings).toEqual([]);
  });

  it("keeps expected intraday current-day bar gaps from becoming material", async () => {
    const dto = await buildValuationHealth({
      app: {
        persistence: {
          getLatestBarDatesForReconciliation: vi.fn().mockResolvedValue(new Map([["2330:TW", "2026-06-17"]])),
          getLatestHoldingSnapshotDatesByScope: vi.fn().mockResolvedValue(new Map([[scopeKey("acc-1", "2330", "TW"), "2026-06-17"]])),
          getInstrument: vi.fn().mockResolvedValue({ barsBackfillStatus: "ready" }),
        },
        tradingCalendarCache: {
          isTradingDay: vi.fn().mockResolvedValue(true),
        },
      } as never,
      userId: "user-1",
      store: {} as never,
      reportingCurrency: "TWD",
      currentValueAmount: 12_000,
      asOf: "2026-06-18T02:00:00.000Z",
      holdingGroups: [
        {
          ticker: "2330",
          marketCode: "TW",
          reportingMarketValueAmount: 12_000,
          priceState: dailyPriceState({
            basis: "intraday",
            chipState: "open_fresh",
            marketState: "open",
            asOfDate: "2026-06-18",
            sourceKind: "intraday_yahoo_chart",
            quality: null,
          }),
          children: [{ accountId: "acc-1", ticker: "2330", marketCode: "TW" }],
        },
      ] as never,
      performance: {
        points: [{ fxAvailable: true, marketValueAmount: 10_000 }],
        diagnostics: {
          latestReliableValuationDate: "2026-06-17",
          latestSnapshotDate: "2026-06-17",
          expectedLatestValuationDate: "2026-06-18",
        },
      } as never,
    });

    expect(dto.status).toBe("healthy");
    expect(dto.reason).toBe("within_threshold");
    expect(dto.affectedHoldings).toEqual([
      expect.objectContaining({
        ticker: "2330",
        latestBarDate: "2026-06-17",
        latestSnapshotDate: "2026-06-17",
        status: "awaiting_latest_bar",
        recommendedAction: "none",
      }),
    ]);
    expect(dto.recommendedActions).toEqual([]);
  });

  it("does not let unrelated intraday movement escalate genuine stale snapshot diagnostics", async () => {
    const dto = await buildValuationHealth({
      app: {
        persistence: {
          getLatestBarDatesForReconciliation: vi.fn().mockResolvedValue(new Map([
            ["2330:TW", "2026-06-13"],
            ["AAPL:US", "2026-06-13"],
          ])),
          getLatestHoldingSnapshotDatesByScope: vi.fn().mockResolvedValue(new Map([
            [scopeKey("acc-1", "2330", "TW"), "2026-06-13"],
            [scopeKey("acc-2", "AAPL", "US"), "2026-06-12"],
          ])),
          getInstrument: vi.fn().mockResolvedValue({ barsBackfillStatus: "ready" }),
        },
      } as never,
      userId: "user-1",
      store: {} as never,
      reportingCurrency: "USD",
      currentValueAmount: 500,
      asOf: "2026-06-17T10:00:00.000Z",
      holdingGroups: [
        {
          ticker: "2330",
          marketCode: "TW",
          reportingMarketValueAmount: 600,
          priceState: dailyPriceState({
            basis: "intraday",
            chipState: "open_fresh",
            marketState: "open",
            quality: null,
          }),
          children: [{ accountId: "acc-1", ticker: "2330", marketCode: "TW" }],
        },
        {
          ticker: "AAPL",
          marketCode: "US",
          reportingMarketValueAmount: 250,
          priceState: dailyPriceState(),
          children: [{ accountId: "acc-2", ticker: "AAPL", marketCode: "US" }],
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

    expect(dto.status).toBe("healthy");
    expect(dto.reason).toBe("within_minor_unit_tolerance");
    expect(dto.affectedHoldings).toEqual([
      expect.objectContaining({
        ticker: "AAPL",
        status: "stale_snapshot",
        recommendedAction: "run_snapshot_repair",
      }),
    ]);
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
          priceState: dailyPriceState(),
          children: [{ accountId: "acc-1", ticker: "7203", marketCode: "US" }],
        },
        {
          ticker: "005930",
          marketCode: "KR",
          reportingMarketValueAmount: 250,
          priceState: dailyPriceState(),
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
          priceState: dailyPriceState(),
          children: [{ accountId: "acc-1", ticker: "2330", marketCode: "TW" }],
        },
        {
          ticker: "AAPL",
          marketCode: "US",
          reportingMarketValueAmount: 250,
          priceState: dailyPriceState(),
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

  it("does not label healthy partial diagnostics as out of sync", async () => {
    const dto = await buildValuationHealth({
      app: {
        persistence: {
          getLatestBarDatesForReconciliation: vi.fn().mockResolvedValue(new Map([
            ["2330:TW", "2026-06-16"],
            ["AVGO:US", "2026-06-16"],
          ])),
          getLatestHoldingSnapshotDatesByScope: vi.fn().mockResolvedValue(new Map([
            [scopeKey("acc-1", "2330", "TW"), "2026-06-16"],
            [scopeKey("acc-2", "AVGO", "US"), "2026-06-16"],
          ])),
          getInstrument: vi.fn().mockResolvedValue({ barsBackfillStatus: "ready" }),
        },
      } as never,
      userId: "user-1",
      store: {} as never,
      reportingCurrency: "USD",
      currentValueAmount: 695_751.36,
      asOf: "2026-06-16T10:00:00.000Z",
      holdingGroups: [
        {
          ticker: "2330",
          marketCode: "TW",
          reportingMarketValueAmount: 516_114.72,
          priceState: dailyPriceState(),
          children: [{ accountId: "acc-1", ticker: "2330", marketCode: "TW" }],
        },
        {
          ticker: "AVGO",
          marketCode: "US",
          reportingMarketValueAmount: 179_636.64,
          priceState: dailyPriceState(),
          children: [{ accountId: "acc-2", ticker: "AVGO", marketCode: "US" }],
        },
      ] as never,
      performance: {
        points: [{ fxAvailable: true, marketValueAmount: 695_751.36 }],
        diagnostics: {
          latestReliableValuationDate: "2026-06-16",
          latestSnapshotDate: "2026-06-16",
          latestComparableSnapshotDate: "2026-06-16",
          latestPartialSnapshotDate: "2026-06-03",
          expectedLatestValuationDate: "2026-06-16",
        },
      } as never,
    });

    expect(dto.status).toBe("healthy");
    expect(dto.title).toBeUndefined();
    expect(dto.latestPartialSnapshotDate).toBe("2026-06-03");
    expect(dto.affectedHoldings).toEqual([]);
  });

  it("prompts backfill when a market bar is behind the expected valuation trading date", async () => {
    const dto = await buildValuationHealth({
      app: {
        persistence: {
          getLatestBarDatesForReconciliation: vi.fn().mockResolvedValue(new Map([
            ["2330:TW", "2026-06-16"],
            ["AVGO:US", "2026-06-15"],
          ])),
          getLatestHoldingSnapshotDatesByScope: vi.fn().mockResolvedValue(new Map([
            [scopeKey("acc-1", "2330", "TW"), "2026-06-16"],
            [scopeKey("acc-2", "AVGO", "US"), "2026-06-15"],
          ])),
          getInstrument: vi.fn().mockResolvedValue({ barsBackfillStatus: "ready" }),
        },
        tradingCalendarCache: {
          isTradingDay: vi.fn().mockImplementation(async (marketCode: string, date: string) =>
            marketCode === "US" && date === "2026-06-16"),
        },
      } as never,
      userId: "user-1",
      store: {} as never,
      reportingCurrency: "USD",
      currentValueAmount: 700_000,
      asOf: "2026-06-16T10:00:00.000Z",
      holdingGroups: [
        {
          ticker: "2330",
          marketCode: "TW",
          reportingMarketValueAmount: 500_000,
          priceState: dailyPriceState(),
          children: [{ accountId: "acc-1", ticker: "2330", marketCode: "TW" }],
        },
        {
          ticker: "AVGO",
          marketCode: "US",
          reportingMarketValueAmount: 200_000,
          priceState: dailyPriceState(),
          children: [{ accountId: "acc-2", ticker: "AVGO", marketCode: "US" }],
        },
      ] as never,
      performance: {
        points: [{ fxAvailable: true, marketValueAmount: 691_000 }],
        diagnostics: {
          latestReliableValuationDate: "2026-06-15",
          latestSnapshotDate: "2026-06-16",
          latestComparableSnapshotDate: "2026-06-15",
          latestPartialSnapshotDate: "2026-06-16",
          expectedLatestValuationDate: "2026-06-15",
        },
      } as never,
    });

    expect(dto.affectedHoldings).toEqual([
      expect.objectContaining({
        ticker: "AVGO",
        marketCode: "US",
        latestBarDate: "2026-06-15",
        latestSnapshotDate: "2026-06-15",
        status: "missing_latest_bar",
        recommendedAction: "run_backfill",
      }),
    ]);
    expect(dto.marketFreshness).toEqual([
      expect.objectContaining({
        marketCode: "US",
        latestBarDate: "2026-06-15",
        latestSnapshotDate: "2026-06-15",
        missingTickerCount: 1,
      }),
    ]);
    expect(dto.recommendedActions).toEqual(["run_backfill"]);
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
          priceState: dailyPriceState(),
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

  it("surfaces a no-repair cause when a holding opens after the latest available bar", async () => {
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
          priceState: dailyPriceState(),
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
    expect(dto.affectedHoldings).toEqual([
      expect.objectContaining({
        ticker: "VRT",
        latestBarDate: "2026-06-13",
        latestSnapshotDate: null,
        status: "awaiting_latest_bar",
        recommendedAction: "none",
      }),
    ]);
    expect(dto.recommendedActions).toEqual([]);
  });

  it("replays same-day closes and reopens by booking sequence before timestamp", async () => {
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
                tradeDate: "2026-06-01",
                tradeTimestamp: "2026-06-01T09:00:00.000Z",
                bookingSequence: 1,
              },
              {
                id: "trade-2",
                accountId: "acc-1",
                ticker: "VRT",
                marketCode: "US",
                type: "SELL",
                quantity: 10,
                tradeDate: "2026-06-14",
                tradeTimestamp: "2026-06-14T10:00:00.000Z",
                bookingSequence: 2,
              },
              {
                id: "trade-3",
                accountId: "acc-1",
                ticker: "VRT",
                marketCode: "US",
                type: "BUY",
                quantity: 5,
                tradeDate: "2026-06-14",
                tradeTimestamp: "2026-06-14T08:00:00.000Z",
                bookingSequence: 3,
              },
            ],
          },
        },
      } as never,
      reportingCurrency: "USD",
      currentValueAmount: 500,
      asOf: "2026-06-14T10:00:00.000Z",
      holdingGroups: [
        {
          ticker: "VRT",
          marketCode: "US",
          reportingMarketValueAmount: 500,
          priceState: dailyPriceState(),
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

    expect(dto.affectedHoldings).toEqual([
      expect.objectContaining({
        ticker: "VRT",
        latestBarDate: "2026-06-13",
        latestSnapshotDate: null,
        status: "awaiting_latest_bar",
        recommendedAction: "none",
      }),
    ]);
    expect(dto.recommendedActions).toEqual([]);
  });
});
