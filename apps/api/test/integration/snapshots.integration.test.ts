import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp, type AppInstance } from "../../src/app.js";
import type { MemoryPersistence } from "../../src/persistence/memory.js";
import type { DailyBar } from "@vakwen/domain";
import { transactionPayload, type TransactionType } from "../helpers/fixtures.js";

let app: AppInstance;
let persistence: MemoryPersistence;

let idempotencyCounter = 0;

function makeBar(ticker: string, date: string, close: number): DailyBar {
  return {
    ticker,
    barDate: date,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1000,
    quality: "full_bar",
    source: "test",
    ingestedAt: new Date().toISOString(),
  };
}

async function createTrade(
  overrides: Parameters<typeof transactionPayload>[0] = {},
) {
  idempotencyCounter += 1;
  const res = await app.inject({
    method: "POST",
    url: "/portfolio/transactions",
    headers: { "idempotency-key": `k-snap-${idempotencyCounter}` },
    payload: transactionPayload(overrides),
  });
  expect(res.statusCode).toBe(200);
  return res.json() as { id: string; accountId: string; ticker: string };
}

function collectBusEvents(userId = "user-1") {
  const events: Array<{ type: string; data: unknown }> = [];
  const unsub = app.eventBus.subscribe(userId, (event) => events.push(event));
  return {
    events,
    unsub,
    waitFor: (type: string, timeoutMs = 2000) =>
      new Promise<{ type: string; data: unknown }>((resolve, reject) => {
        const existing = events.find((e) => e.type === type);
        if (existing) { resolve(existing); return; }
        const timer = setTimeout(
          () => reject(new Error(`Timeout waiting for event "${type}" after ${timeoutMs}ms`)),
          timeoutMs,
        );
        const checkUnsub = app.eventBus.subscribe(userId, (event) => {
          if (event.type === type) {
            clearTimeout(timer);
            checkUnsub();
            resolve(event);
          }
        });
      }),
  };
}

async function waitForAsync(ms = 200) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

beforeEach(async () => {
  idempotencyCounter = 0;
  app = await buildApp({ persistenceBackend: "memory" });
  persistence = app.persistence as MemoryPersistence;
});

afterEach(async () => {
  if (app) await app.close();
});

describe("POST /portfolio/snapshots/generate", () => {
  it("returns 202 with generationRunId and generates snapshots via SSE", async () => {
    persistence._seedDailyBars([
      makeBar("2330", "2025-01-02", 100),
      makeBar("2330", "2025-01-03", 105),
    ]);
    await createTrade({ tradeDate: "2025-01-02", quantity: 10, unitPrice: 100, commissionAmount: 0, taxAmount: 0 });

    const { events, unsub } = collectBusEvents();

    const res = await app.inject({
      method: "POST",
      url: "/portfolio/snapshots/generate",
    });

    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.generationRunId).toBeDefined();
    expect(typeof body.generationRunId).toBe("string");

    await waitForAsync();
    unsub();

    const sseEvent = events.find((e) => e.type === "snapshots_generated");
    expect(sseEvent).toBeDefined();
    const data = sseEvent!.data as Record<string, unknown>;
    expect(data.totalRows).toBe(2);
    expect(data.provisionalRows).toBe(0);
    expect(data.generationRunId).toBe(body.generationRunId);
  });

  it("full generation: multiple tickers produce correct row counts", async () => {
    persistence._seedDailyBars([
      makeBar("2330", "2025-01-02", 100),
      makeBar("2330", "2025-01-03", 105),
      makeBar("2317", "2025-01-02", 50),
      makeBar("2317", "2025-01-03", 55),
    ]);
    await createTrade({ ticker: "2330", tradeDate: "2025-01-02", quantity: 10, unitPrice: 100, commissionAmount: 0, taxAmount: 0 });
    await createTrade({ ticker: "2317", tradeDate: "2025-01-02", quantity: 20, unitPrice: 50, commissionAmount: 0, taxAmount: 0 });

    const { events, unsub } = collectBusEvents();

    await app.inject({ method: "POST", url: "/portfolio/snapshots/generate" });
    await waitForAsync();
    unsub();

    const sseEvent = events.find((e) => e.type === "snapshots_generated");
    expect(sseEvent).toBeDefined();
    const data = sseEvent!.data as Record<string, unknown>;
    expect(data.totalRows).toBe(4); // 2 dates × 2 tickers

    // Verify per-ticker snapshots
    const snapshots2330 = await persistence.getHoldingSnapshotsForTicker("user-1", "acc-1", "2330", "2025-01-01", "2025-12-31");
    const snapshots2317 = await persistence.getHoldingSnapshotsForTicker("user-1", "acc-1", "2317", "2025-01-01", "2025-12-31");
    expect(snapshots2330).toHaveLength(2);
    expect(snapshots2317).toHaveLength(2);
  });

  it("idempotent: re-run produces same row count (upsert, not append)", async () => {
    persistence._seedDailyBars([
      makeBar("2330", "2025-01-02", 100),
      makeBar("2330", "2025-01-03", 105),
    ]);
    await createTrade({ tradeDate: "2025-01-02", quantity: 10, unitPrice: 100, commissionAmount: 0, taxAmount: 0 });

    // First generation
    await app.inject({ method: "POST", url: "/portfolio/snapshots/generate" });
    await waitForAsync();

    const snapshotsAfterFirst = await persistence.getHoldingSnapshotsForTicker("user-1", "acc-1", "2330", "2025-01-01", "2025-12-31");
    expect(snapshotsAfterFirst).toHaveLength(2);

    // Second generation
    await app.inject({ method: "POST", url: "/portfolio/snapshots/generate" });
    await waitForAsync();

    const snapshotsAfterSecond = await persistence.getHoldingSnapshotsForTicker("user-1", "acc-1", "2330", "2025-01-01", "2025-12-31");
    expect(snapshotsAfterSecond).toHaveLength(2); // Same count, not 4
  });
});

describe("scoped recompute via trade mutation", () => {
  it("patch with snapshotFromDate leaves earlier snapshots untouched", async () => {
    persistence._seedDailyBars([
      makeBar("2330", "2025-01-02", 100),
      makeBar("2330", "2025-01-03", 105),
      makeBar("2330", "2025-01-06", 110),
    ]);
    // Two trades: one on 2025-01-02, one on 2025-01-06.
    await createTrade({ tradeDate: "2025-01-02", quantity: 10, unitPrice: 100, commissionAmount: 0, taxAmount: 0 });
    const later = await createTrade({ tradeDate: "2025-01-06", quantity: 5, unitPrice: 110, commissionAmount: 0, taxAmount: 0 });

    // Baseline snapshots
    await app.inject({ method: "POST", url: "/portfolio/snapshots/generate" });
    await waitForAsync();

    const baseline = await persistence.getHoldingSnapshotsForTicker("user-1", "acc-1", "2330", "2025-01-01", "2025-12-31");
    expect(baseline).toHaveLength(3);
    // Record identities of the earlier snapshots so we can verify they aren't touched.
    const earlierIds = new Set([baseline[0].id, baseline[1].id]);
    const laterIdBefore = baseline[2].id;

    // Patch the LATER trade (2025-01-06) — scoped recompute should only
    // regenerate Jan 6 onwards, preserving Jan 2 and Jan 3.
    await app.inject({
      method: "PATCH",
      url: `/portfolio/transactions/${later.id}`,
      payload: { quantity: 10, keepManualFees: true },
    });
    await waitForAsync(500);

    const after = await persistence.getHoldingSnapshotsForTicker("user-1", "acc-1", "2330", "2025-01-01", "2025-12-31");
    expect(after).toHaveLength(3);

    // Jan 2 and Jan 3 rows must preserve their original ids (not regenerated).
    expect(earlierIds.has(after[0].id)).toBe(true);
    expect(earlierIds.has(after[1].id)).toBe(true);

    // Jan 6 must have been regenerated with a new id.
    expect(after[2].id).not.toBe(laterIdBefore);
  });

  it("edit trade → only affected ticker's snapshots regenerated", async () => {
    persistence._seedDailyBars([
      makeBar("2330", "2025-01-02", 100),
      makeBar("2330", "2025-01-03", 105),
      makeBar("2317", "2025-01-02", 50),
      makeBar("2317", "2025-01-03", 55),
    ]);
    await createTrade({ ticker: "2330", tradeDate: "2025-01-02", quantity: 10, unitPrice: 100, commissionAmount: 0, taxAmount: 0 });
    await createTrade({ ticker: "2317", tradeDate: "2025-01-02", quantity: 20, unitPrice: 50, commissionAmount: 0, taxAmount: 0 });

    // Generate initial snapshots
    await app.inject({ method: "POST", url: "/portfolio/snapshots/generate" });
    await waitForAsync();

    const initial2330 = await persistence.getHoldingSnapshotsForTicker("user-1", "acc-1", "2330", "2025-01-01", "2025-12-31");
    const initial2317 = await persistence.getHoldingSnapshotsForTicker("user-1", "acc-1", "2317", "2025-01-01", "2025-12-31");
    expect(initial2330).toHaveLength(2);
    expect(initial2317).toHaveLength(2);

    // Record 2317 generation run ID for later comparison
    const original2317RunId = initial2317[0].generationRunId;

    // Edit 2330 trade (change quantity) — this triggers scheduleReplayWithRetry for 2330 only
    const store = await persistence.loadStore("user-1");
    const trade2330 = store.accounting.facts.tradeEvents.find((t) => t.ticker === "2330");
    expect(trade2330).toBeDefined();

    await app.inject({
      method: "PATCH",
      url: `/portfolio/transactions/${trade2330!.id}`,
      payload: { quantity: 20, keepManualFees: true },
    });

    await waitForAsync(500); // Wait for async recompute

    // 2330 snapshots should be regenerated (cost basis changed)
    const after2330 = await persistence.getHoldingSnapshotsForTicker("user-1", "acc-1", "2330", "2025-01-01", "2025-12-31");
    expect(after2330).toHaveLength(2);
    expect(after2330[0].quantity).toBe(20); // Updated quantity

    // 2317 snapshots should be UNTOUCHED — same generation run ID
    const after2317 = await persistence.getHoldingSnapshotsForTicker("user-1", "acc-1", "2317", "2025-01-01", "2025-12-31");
    expect(after2317).toHaveLength(2);
    expect(after2317[0].generationRunId).toBe(original2317RunId);
  });
});

describe("getAggregatedSnapshots", () => {
  it("GROUP BY returns correct portfolio-level sums", async () => {
    persistence._seedDailyBars([
      makeBar("2330", "2025-01-02", 100),
      makeBar("2317", "2025-01-02", 50),
    ]);
    await createTrade({ ticker: "2330", tradeDate: "2025-01-02", quantity: 10, unitPrice: 100, commissionAmount: 0, taxAmount: 0 });
    await createTrade({ ticker: "2317", tradeDate: "2025-01-02", quantity: 20, unitPrice: 50, commissionAmount: 0, taxAmount: 0 });

    await app.inject({ method: "POST", url: "/portfolio/snapshots/generate" });
    await waitForAsync();

    const aggregated = await persistence.getAggregatedSnapshots("user-1", "2025-01-01", "2025-12-31");
    expect(aggregated).toHaveLength(1);
    expect(aggregated[0].date).toBe("2025-01-02");
    expect(aggregated[0].totalCostBasis).toBe(2000); // 10*100 + 20*50
    expect(aggregated[0].totalMarketValue).toBe(2000); // 10*100 + 20*50
    expect(aggregated[0].isProvisional).toBe(false);
  });

  it("zero-quantity rows included in aggregates with cumulative realized PnL", async () => {
    persistence._seedDailyBars([
      makeBar("2330", "2025-01-02", 100),
      makeBar("2330", "2025-01-03", 110),
      makeBar("2317", "2025-01-02", 50),
      makeBar("2317", "2025-01-03", 55),
    ]);
    await createTrade({ ticker: "2330", tradeDate: "2025-01-02", type: "BUY" as TransactionType, quantity: 10, unitPrice: 100, commissionAmount: 0, taxAmount: 0 });
    await createTrade({ ticker: "2330", tradeDate: "2025-01-03", type: "SELL" as TransactionType, quantity: 10, unitPrice: 110, commissionAmount: 0, taxAmount: 0 });
    await createTrade({ ticker: "2317", tradeDate: "2025-01-02", type: "BUY" as TransactionType, quantity: 5, unitPrice: 50, commissionAmount: 0, taxAmount: 0 });

    await app.inject({ method: "POST", url: "/portfolio/snapshots/generate" });
    await waitForAsync();

    const aggregated = await persistence.getAggregatedSnapshots("user-1", "2025-01-03", "2025-01-03");
    expect(aggregated).toHaveLength(1);
    // 2330 sold to zero: costBasis=0, realizedPnl=100
    // 2317 still held: costBasis=250, marketValue=275
    expect(aggregated[0].totalCostBasis).toBe(250); // just 2317
    expect(aggregated[0].cumulativeRealizedPnl).toBe(100); // from 2330 sell
  });
});

describe("preview-impact snapshot count", () => {
  it("countHoldingSnapshotsAfterDate included in preview response", async () => {
    persistence._seedDailyBars([
      makeBar("2330", "2025-01-02", 100),
      makeBar("2330", "2025-01-03", 105),
      makeBar("2330", "2025-01-06", 110),
    ]);
    const trade = await createTrade({ tradeDate: "2025-01-02", quantity: 10, unitPrice: 100, commissionAmount: 0, taxAmount: 0 });

    // Generate snapshots first
    await app.inject({ method: "POST", url: "/portfolio/snapshots/generate" });
    await waitForAsync();

    // Preview impact of deleting this trade
    const res = await app.inject({
      method: "GET",
      url: `/portfolio/transactions/${trade.id}/preview-impact?action=delete`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.affectedRows.holdingSnapshots).toBe(3); // 3 snapshot rows from trade date onward
  });

  it("returns 0 holdingSnapshots when no snapshots exist", async () => {
    const trade = await createTrade({ tradeDate: "2025-01-02", quantity: 10, unitPrice: 100, commissionAmount: 0, taxAmount: 0 });

    const res = await app.inject({
      method: "GET",
      url: `/portfolio/transactions/${trade.id}/preview-impact?action=delete`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().affectedRows.holdingSnapshots).toBe(0);
  });
});
