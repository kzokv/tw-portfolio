import { describe, expect, it, vi } from "vitest";
import { replayPositionHistory } from "../../src/services/replayPositionHistory.js";
import type { Persistence } from "../../src/persistence/types.js";

describe("replayPositionHistory", () => {
  it("passes marketCode through replay persistence boundaries", async () => {
    const persistence = {
      getTradeEventsForAccountTicker: vi.fn().mockResolvedValue([]),
      deleteLotsForAccountTicker: vi.fn().mockResolvedValue(0),
      deleteLotAllocationsForAccountTicker: vi.fn().mockResolvedValue(0),
      deleteTradeCashEntriesForAccountTicker: vi.fn().mockResolvedValue(0),
      loadStore: vi.fn().mockResolvedValue({
        accounting: {
          facts: {
            dividendLedgerEntries: [],
          },
        },
        marketData: {
          dividendEvents: [],
        },
      }),
    } as unknown as Persistence;

    const summary = await replayPositionHistory(
      persistence,
      "user-1",
      "acc-1",
      "BHP",
      { marketCode: "AU", deletedTradeEventIds: ["trade-deleted"] },
    );

    expect(persistence.getTradeEventsForAccountTicker).toHaveBeenCalledWith("user-1", "acc-1", "BHP", "AU");
    expect(persistence.deleteLotsForAccountTicker).toHaveBeenCalledWith("user-1", "acc-1", "BHP", "AU", ["trade-deleted"]);
    expect(persistence.deleteLotAllocationsForAccountTicker).toHaveBeenCalledWith("user-1", "acc-1", "BHP", "AU", ["trade-deleted"]);
    expect(persistence.deleteTradeCashEntriesForAccountTicker).toHaveBeenCalledWith("user-1", "acc-1", "BHP", "AU", ["trade-deleted"]);
    expect(summary.affectedTradeCount).toBe(0);
  });
});
