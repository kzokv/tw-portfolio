import { describe, expect, it } from "vitest";
import { MemoryPersistence } from "../../src/persistence/memory.js";
import type { HoldingSnapshot } from "../../src/persistence/types.js";

describe("MemoryPersistence.getLatestHoldingSnapshotDatesByScope", () => {
  it("ignores newer incomplete holding snapshots", async () => {
    const persistence = new MemoryPersistence();
    await persistence.bulkUpsertHoldingSnapshots("user-1", [
      holdingSnapshot({ id: "snap-complete", snapshotDate: "2026-06-10" }),
      holdingSnapshot({
        id: "snap-incomplete",
        snapshotDate: "2026-06-11",
        marketValue: null,
        valueNative: null,
      }),
      holdingSnapshot({
        id: "snap-provisional",
        snapshotDate: "2026-06-12",
        isProvisional: true,
        closePrice: null,
        providerSource: null,
      }),
    ]);

    const result = await persistence.getLatestHoldingSnapshotDatesByScope("user-1", [
      { accountId: "acc-1", ticker: "2002", marketCode: "TW" },
      { accountId: "acc-1", ticker: "2330", marketCode: "TW" },
    ]);

    expect(result.get(scopeKey("acc-1", "2002", "TW"))).toBe("2026-06-10");
    expect(result.get(scopeKey("acc-1", "2330", "TW"))).toBeNull();
  });
});

function scopeKey(accountId: string, ticker: string, marketCode: string): string {
  return `${accountId}\0${ticker}\0${marketCode}`;
}

function holdingSnapshot(overrides: Partial<HoldingSnapshot>): HoldingSnapshot {
  return {
    id: "snap-1",
    userId: "user-1",
    accountId: "acc-1",
    ticker: "2002",
    marketCode: "TW",
    snapshotDate: "2026-06-10",
    quantity: 10,
    closePrice: 100,
    marketValue: 1000,
    costBasis: 900,
    unrealizedPnl: 100,
    cumulativeRealizedPnl: 0,
    cumulativeDividends: 0,
    isProvisional: false,
    currency: "TWD",
    valueNative: 1000,
    costBasisNative: 900,
    unrealizedPnlNative: 100,
    providerSource: "fixture",
    generatedAt: "2026-06-12T00:00:00.000Z",
    generationRunId: "test-run",
    ...overrides,
  };
}
