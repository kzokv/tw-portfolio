import { describe, expect, it } from "vitest";
import { allocateSellLots, type Lot } from "../src/index.js";

const lots: Lot[] = [
  {
    id: "lot-1",
    accountId: "acc-1",
    symbol: "2330",
    openQuantity: 100,
    totalCostNtd: 100_000,
    openedAt: "2026-01-01",
  },
  {
    id: "lot-2",
    accountId: "acc-1",
    symbol: "2330",
    openQuantity: 100,
    totalCostNtd: 120_000,
    openedAt: "2026-01-02",
  },
];

describe("lot allocation", () => {
  it("uses weighted-average allocation", () => {
    const result = allocateSellLots(lots, 100);
    expect(result.allocatedCostNtd).toBe(110000);
  });
});
