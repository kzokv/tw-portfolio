import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp, type AppInstance } from "../../src/app.js";
import { generateHoldingSnapshots, recomputeSnapshotsForTicker } from "../../src/services/snapshotGeneration.js";
import type { BookedTradeEvent } from "../../src/types/store.js";
import type { DailyBar } from "@tw-portfolio/domain";
import type { MemoryPersistence } from "../../src/persistence/memory.js";

let app: AppInstance;
let persistence: MemoryPersistence;

const DEFAULT_FEE_SNAPSHOT = {
  id: "fp-default",
  name: "Default Broker",
  boardCommissionRate: 1.425,
  commissionDiscountPercent: 0,
  minimumCommissionAmount: 20,
  commissionCurrency: "TWD" as const,
  commissionRoundingMode: "FLOOR" as const,
  taxRoundingMode: "FLOOR" as const,
  stockSellTaxRateBps: 30,
  stockDayTradeTaxRateBps: 15,
  etfSellTaxRateBps: 10,
  bondEtfSellTaxRateBps: 0,
  commissionChargeMode: "CHARGED_UPFRONT" as const,
};

function makeTrade(overrides: Partial<BookedTradeEvent> = {}): BookedTradeEvent {
  return {
    id: randomUUID(),
    userId: "user-1",
    accountId: "acc-1",
    ticker: "2330",
    instrumentType: "STOCK",
    type: "BUY",
    quantity: 10,
    unitPrice: 100,
    priceCurrency: "TWD",
    tradeDate: "2025-01-02",
    commissionAmount: 20,
    taxAmount: 0,
    isDayTrade: false,
    feeSnapshot: DEFAULT_FEE_SNAPSHOT,
    ...overrides,
  };
}

function makeBar(ticker: string, date: string, close: number): DailyBar {
  return {
    ticker,
    barDate: date,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1000,
    source: "test",
    ingestedAt: new Date().toISOString(),
  };
}

beforeEach(async () => {
  app = await buildApp();
  persistence = app.persistence as MemoryPersistence;
});

afterEach(async () => {
  await app.close();
});

describe("generateHoldingSnapshots", () => {
  it("buy → hold: generates snapshot rows on trading days", async () => {
    const store = await persistence.loadStore("user-1");
    store.accounting.facts.tradeEvents.push(
      makeTrade({ tradeDate: "2025-01-02", quantity: 10, unitPrice: 100 }),
    );
    await persistence.saveStore(store);

    persistence._seedDailyBars([
      makeBar("2330", "2025-01-02", 100),
      makeBar("2330", "2025-01-03", 105),
      makeBar("2330", "2025-01-06", 110),
    ]);

    const result = await generateHoldingSnapshots("user-1", persistence);

    expect(result.totalRows).toBe(3);
    expect(result.provisionalRows).toBe(0);
    expect(result.dateRange).toEqual({ from: "2025-01-02", to: "2025-01-06" });

    const snapshots = await persistence.getHoldingSnapshotsForTicker(
      "user-1", "acc-1", "2330", "2025-01-01", "2025-12-31",
    );
    expect(snapshots).toHaveLength(3);

    // Day 1: buy 10 @ 100, close 100
    expect(snapshots[0].quantity).toBe(10);
    expect(snapshots[0].costBasis).toBe(1020); // 10*100 + 20 commission
    expect(snapshots[0].closePrice).toBe(100);
    expect(snapshots[0].marketValue).toBe(1000);

    // Day 2: hold, close 105
    expect(snapshots[1].quantity).toBe(10);
    expect(snapshots[1].closePrice).toBe(105);
    expect(snapshots[1].marketValue).toBe(1050);

    // Day 3: hold, close 110
    expect(snapshots[2].quantity).toBe(10);
    expect(snapshots[2].closePrice).toBe(110);
    expect(snapshots[2].marketValue).toBe(1100);
  });

  it("buy → sell: accumulates realized PnL", async () => {
    const store = await persistence.loadStore("user-1");
    store.accounting.facts.tradeEvents.push(
      makeTrade({ tradeDate: "2025-01-02", type: "BUY", quantity: 10, unitPrice: 100, commissionAmount: 20, taxAmount: 0 }),
      makeTrade({ tradeDate: "2025-01-03", type: "SELL", quantity: 5, unitPrice: 120, commissionAmount: 10, taxAmount: 5 }),
    );
    await persistence.saveStore(store);

    persistence._seedDailyBars([
      makeBar("2330", "2025-01-02", 100),
      makeBar("2330", "2025-01-03", 120),
      makeBar("2330", "2025-01-06", 115),
    ]);

    const result = await generateHoldingSnapshots("user-1", persistence);
    expect(result.totalRows).toBe(3);

    const snapshots = await persistence.getHoldingSnapshotsForTicker(
      "user-1", "acc-1", "2330", "2025-01-01", "2025-12-31",
    );

    // Day 1: buy 10 @ 100, cost = 1020 (with 20 commission)
    expect(snapshots[0].quantity).toBe(10);
    expect(snapshots[0].costBasis).toBe(1020);
    expect(snapshots[0].cumulativeRealizedPnl).toBe(0);

    // Day 2: sell 5 @ 120, commission 10, tax 5
    // cost per share = 1020/10 = 102, allocated = 102*5 = 510
    // proceeds = 5*120 - 10 - 5 = 585
    // realized = 585 - 510 = 75
    expect(snapshots[1].quantity).toBe(5);
    expect(snapshots[1].costBasis).toBe(510); // 1020 - 510
    expect(snapshots[1].cumulativeRealizedPnl).toBe(75);
    expect(snapshots[1].closePrice).toBe(120);
    expect(snapshots[1].marketValue).toBe(600); // 5 * 120

    // Day 3: hold 5 shares
    expect(snapshots[2].quantity).toBe(5);
    expect(snapshots[2].cumulativeRealizedPnl).toBe(75);
  });

  it("sell to zero: continues rows with cumulative values", async () => {
    const store = await persistence.loadStore("user-1");
    store.accounting.facts.tradeEvents.push(
      makeTrade({ tradeDate: "2025-01-02", type: "BUY", quantity: 10, unitPrice: 100, commissionAmount: 0, taxAmount: 0 }),
      makeTrade({ tradeDate: "2025-01-03", type: "SELL", quantity: 10, unitPrice: 110, commissionAmount: 0, taxAmount: 0 }),
    );
    await persistence.saveStore(store);

    persistence._seedDailyBars([
      makeBar("2330", "2025-01-02", 100),
      makeBar("2330", "2025-01-03", 110),
      makeBar("2330", "2025-01-06", 115),
    ]);

    await generateHoldingSnapshots("user-1", persistence);
    const snapshots = await persistence.getHoldingSnapshotsForTicker(
      "user-1", "acc-1", "2330", "2025-01-01", "2025-12-31",
    );

    expect(snapshots).toHaveLength(3);

    // Day 2 after sell: quantity 0, realized PnL = 100 (1100 - 1000)
    expect(snapshots[1].quantity).toBe(0);
    expect(snapshots[1].cumulativeRealizedPnl).toBe(100);
    expect(snapshots[1].costBasis).toBe(0);

    // Day 3: zero-qty carry forward with cumulative values
    expect(snapshots[2].quantity).toBe(0);
    expect(snapshots[2].cumulativeRealizedPnl).toBe(100);
  });

  it("provisional rows: marks rows when daily_bars missing", async () => {
    const store = await persistence.loadStore("user-1");
    store.accounting.facts.tradeEvents.push(
      makeTrade({ tradeDate: "2025-01-02", quantity: 10, unitPrice: 100 }),
    );
    await persistence.saveStore(store);

    // No daily bars seeded — all rows should be provisional
    const result = await generateHoldingSnapshots("user-1", persistence);

    expect(result.provisionalRows).toBe(1);
    expect(result.tickersNeedingBackfill).toContain("2330");

    const snapshots = await persistence.getHoldingSnapshotsForTicker(
      "user-1", "acc-1", "2330", "2025-01-01", "2025-12-31",
    );
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].isProvisional).toBe(true);
    expect(snapshots[0].closePrice).toBeNull();
    expect(snapshots[0].marketValue).toBeNull();
  });

  it("trading-days-only: skips non-trading days", async () => {
    const store = await persistence.loadStore("user-1");
    store.accounting.facts.tradeEvents.push(
      makeTrade({ tradeDate: "2025-01-02", quantity: 10, unitPrice: 100 }),
    );
    await persistence.saveStore(store);

    // Seed bars for Mon, Wed, Fri — skip Tue, Thu
    persistence._seedDailyBars([
      makeBar("2330", "2025-01-02", 100), // Thu
      makeBar("2330", "2025-01-03", 105), // Fri
      // No bars for Jan 4-5 (weekend)
      makeBar("2330", "2025-01-06", 110), // Mon
    ]);

    const result = await generateHoldingSnapshots("user-1", persistence);
    expect(result.totalRows).toBe(3); // Only 3 trading days
  });

  it("idempotent: re-run produces same row count", async () => {
    const store = await persistence.loadStore("user-1");
    store.accounting.facts.tradeEvents.push(
      makeTrade({ tradeDate: "2025-01-02", quantity: 10, unitPrice: 100 }),
    );
    await persistence.saveStore(store);

    persistence._seedDailyBars([
      makeBar("2330", "2025-01-02", 100),
      makeBar("2330", "2025-01-03", 105),
    ]);

    const result1 = await generateHoldingSnapshots("user-1", persistence);
    const result2 = await generateHoldingSnapshots("user-1", persistence);

    expect(result1.totalRows).toBe(result2.totalRows);

    const snapshots = await persistence.getHoldingSnapshotsForTicker(
      "user-1", "acc-1", "2330", "2025-01-01", "2025-12-31",
    );
    // Should have exactly 2 rows, not 4 (upsert, not append)
    expect(snapshots).toHaveLength(2);
  });

  it("multiple tickers: generates snapshots per (account, ticker)", async () => {
    const store = await persistence.loadStore("user-1");
    store.accounting.facts.tradeEvents.push(
      makeTrade({ tradeDate: "2025-01-02", ticker: "2330", quantity: 10, unitPrice: 100 }),
      makeTrade({ tradeDate: "2025-01-02", ticker: "2317", quantity: 20, unitPrice: 50 }),
    );
    await persistence.saveStore(store);

    persistence._seedDailyBars([
      makeBar("2330", "2025-01-02", 100),
      makeBar("2330", "2025-01-03", 105),
      makeBar("2317", "2025-01-02", 50),
      makeBar("2317", "2025-01-03", 55),
    ]);

    const result = await generateHoldingSnapshots("user-1", persistence);
    expect(result.totalRows).toBe(4); // 2 dates × 2 tickers
  });
});

describe("recomputeSnapshotsForTicker", () => {
  it("scoped recompute: only regenerates from given date", async () => {
    const store = await persistence.loadStore("user-1");
    store.accounting.facts.tradeEvents.push(
      makeTrade({ tradeDate: "2025-01-02", quantity: 10, unitPrice: 100, commissionAmount: 0, taxAmount: 0 }),
    );
    await persistence.saveStore(store);

    persistence._seedDailyBars([
      makeBar("2330", "2025-01-02", 100),
      makeBar("2330", "2025-01-03", 105),
      makeBar("2330", "2025-01-06", 110),
    ]);

    // First: full generation
    await generateHoldingSnapshots("user-1", persistence);
    let snapshots = await persistence.getHoldingSnapshotsForTicker(
      "user-1", "acc-1", "2330", "2025-01-01", "2025-12-31",
    );
    expect(snapshots).toHaveLength(3);

    // Now recompute from Jan 3 — should delete Jan 3 & Jan 6, regenerate
    const result = await recomputeSnapshotsForTicker(
      "user-1", "acc-1", "2330", "2025-01-03", persistence,
    );
    expect(result.totalRows).toBe(2); // Jan 3 + Jan 6

    snapshots = await persistence.getHoldingSnapshotsForTicker(
      "user-1", "acc-1", "2330", "2025-01-01", "2025-12-31",
    );
    // Jan 2 (kept) + Jan 3 (regenerated) + Jan 6 (regenerated)
    expect(snapshots).toHaveLength(3);
  });
});

describe("getAggregatedSnapshots", () => {
  it("aggregates portfolio-level sums by date", async () => {
    const store = await persistence.loadStore("user-1");
    store.accounting.facts.tradeEvents.push(
      makeTrade({ tradeDate: "2025-01-02", ticker: "2330", quantity: 10, unitPrice: 100, commissionAmount: 0, taxAmount: 0 }),
      makeTrade({ tradeDate: "2025-01-02", ticker: "2317", quantity: 20, unitPrice: 50, commissionAmount: 0, taxAmount: 0 }),
    );
    await persistence.saveStore(store);

    persistence._seedDailyBars([
      makeBar("2330", "2025-01-02", 100),
      makeBar("2317", "2025-01-02", 50),
    ]);

    await generateHoldingSnapshots("user-1", persistence);

    const aggregated = await persistence.getAggregatedSnapshots("user-1", "2025-01-01", "2025-12-31");
    expect(aggregated).toHaveLength(1);
    expect(aggregated[0].date).toBe("2025-01-02");
    expect(aggregated[0].totalCostBasis).toBe(2000); // 10*100 + 20*50
    expect(aggregated[0].totalMarketValue).toBe(2000); // 10*100 + 20*50
    expect(aggregated[0].isProvisional).toBe(false);
  });

  it("zero-quantity rows included in aggregates", async () => {
    const store = await persistence.loadStore("user-1");
    store.accounting.facts.tradeEvents.push(
      makeTrade({ tradeDate: "2025-01-02", type: "BUY", ticker: "2330", quantity: 10, unitPrice: 100, commissionAmount: 0, taxAmount: 0 }),
      makeTrade({ tradeDate: "2025-01-03", type: "SELL", ticker: "2330", quantity: 10, unitPrice: 110, commissionAmount: 0, taxAmount: 0 }),
      makeTrade({ tradeDate: "2025-01-02", type: "BUY", ticker: "2317", quantity: 5, unitPrice: 50, commissionAmount: 0, taxAmount: 0 }),
    );
    await persistence.saveStore(store);

    persistence._seedDailyBars([
      makeBar("2330", "2025-01-02", 100),
      makeBar("2330", "2025-01-03", 110),
      makeBar("2317", "2025-01-02", 50),
      makeBar("2317", "2025-01-03", 55),
    ]);

    await generateHoldingSnapshots("user-1", persistence);

    const aggregated = await persistence.getAggregatedSnapshots("user-1", "2025-01-03", "2025-01-03");
    expect(aggregated).toHaveLength(1);
    // 2330 sold to zero: costBasis=0, realizedPnl=100
    // 2317 still held: costBasis=250, marketValue=275
    expect(aggregated[0].totalCostBasis).toBe(250); // just 2317
    expect(aggregated[0].cumulativeRealizedPnl).toBe(100); // from 2330 sell
  });
});
