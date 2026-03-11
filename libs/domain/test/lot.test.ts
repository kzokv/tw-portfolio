import { describe, expect, it } from "vitest";
import { allocateSellLots, applyBuyToLots, type Lot } from "../src/index.js";

const existingLot: Lot = {
  id: "lot-1",
  accountId: "acc-1",
  symbol: "2330",
  openQuantity: 100,
  totalCostAmount: 100_000,
  costCurrency: "TWD",
  openedAt: "2026-01-01",
  openedSequence: 1,
};

const nextBuyLot: Lot = {
  id: "lot-2",
  accountId: "acc-1",
  symbol: "2330",
  openQuantity: 100,
  totalCostAmount: 120_000,
  costCurrency: "TWD",
  openedAt: "2026-01-02",
  openedSequence: 1,
};

describe("weighted-average lot accounting", () => {
  it("updates open lots to the latest weighted-average cost on buy", () => {
    const result = applyBuyToLots([existingLot], nextBuyLot);

    expect(result.averageCostAmount).toBe(1_100);
    expect(result.updatedLots).toEqual([
      { ...existingLot, totalCostAmount: 110_000 },
      { ...nextBuyLot, totalCostAmount: 110_000 },
    ]);
  });

  it("allocates the full remaining cost when selling the full position", () => {
    const bought = applyBuyToLots([existingLot], nextBuyLot);

    const result = allocateSellLots([...bought.updatedLots].reverse(), 200);

    expect(result.averageCostAmount).toBe(1_100);
    expect(result.allocatedCostAmount).toBe(220_000);
    expect(result.matchedLotIds).toEqual(["lot-1", "lot-2"]);
    expect(result.matchedAllocations).toEqual([
      {
        lotId: "lot-1",
        quantity: 100,
        allocatedCostAmount: 110_000,
        costCurrency: "TWD",
        openedAt: "2026-01-01",
        openedSequence: 1,
      },
      {
        lotId: "lot-2",
        quantity: 100,
        allocatedCostAmount: 110_000,
        costCurrency: "TWD",
        openedAt: "2026-01-02",
        openedSequence: 1,
      },
    ]);
    expect(result.updatedLots).toEqual([
      { ...nextBuyLot, totalCostAmount: 0, openQuantity: 0 },
      { ...existingLot, totalCostAmount: 0, openQuantity: 0 },
    ]);
  });

  it("preserves the weighted-average cost after a partial sell", () => {
    const bought = applyBuyToLots([existingLot], nextBuyLot);

    const result = allocateSellLots(bought.updatedLots, 80);
    const remainingCost = result.updatedLots.reduce((sum, lot) => sum + lot.totalCostAmount, 0);
    const remainingQuantity = result.updatedLots.reduce((sum, lot) => sum + lot.openQuantity, 0);

    expect(result.allocatedCostAmount).toBe(88_000);
    expect(remainingQuantity).toBe(120);
    expect(remainingCost).toBe(132_000);
    expect(remainingCost / remainingQuantity).toBe(1_100);
    expect(result.updatedLots).toEqual([
      { ...existingLot, totalCostAmount: 22_000, openQuantity: 20 },
      { ...nextBuyLot, totalCostAmount: 110_000, openQuantity: 100 },
    ]);
  });

  it("stays cost-conservative across sequential partial sells", () => {
    const bought = applyBuyToLots([existingLot], nextBuyLot);
    const firstSell = allocateSellLots(bought.updatedLots, 33);
    const secondSell = allocateSellLots(firstSell.updatedLots, 67);
    const finalRemainingCost = secondSell.updatedLots.reduce((sum, lot) => sum + lot.totalCostAmount, 0);

    expect(firstSell.allocatedCostAmount).toBe(36_300);
    expect(secondSell.allocatedCostAmount).toBe(73_700);
    expect(finalRemainingCost).toBe(110_000);
    expect(firstSell.allocatedCostAmount + secondSell.allocatedCostAmount + finalRemainingCost).toBe(
      220_000,
    );
  });

  it("supports odd-lot quantities without board-lot assumptions", () => {
    const oddLotA: Lot = {
      ...existingLot,
      id: "odd-1",
      openQuantity: 250,
      totalCostAmount: 125_000,
    };
    const oddLotB: Lot = {
      ...nextBuyLot,
      id: "odd-2",
      openQuantity: 375,
      totalCostAmount: 202_500,
    };

    const bought = applyBuyToLots([oddLotA], oddLotB);
    const result = allocateSellLots(bought.updatedLots, 125);
    const remainingCost = result.updatedLots.reduce((sum, lot) => sum + lot.totalCostAmount, 0);
    const remainingQuantity = result.updatedLots.reduce((sum, lot) => sum + lot.openQuantity, 0);

    expect(bought.averageCostAmount).toBe(524);
    expect(result.allocatedCostAmount).toBe(65_500);
    expect(remainingQuantity).toBe(500);
    expect(remainingCost).toBe(262_000);
    expect(remainingCost / remainingQuantity).toBe(524);
  });

  it("rejects oversells and invalid sell quantities", () => {
    const bought = applyBuyToLots([existingLot], nextBuyLot);

    expect(() => allocateSellLots(bought.updatedLots, 201)).toThrowError("Insufficient quantity to sell");
    expect(() => allocateSellLots(bought.updatedLots, 0)).toThrowError(
      "Sell quantity must be a positive integer",
    );
  });

  it("orders same-day matched lots deterministically by lot id", () => {
    const sameDayLots: Lot[] = [
      {
        ...existingLot,
        id: "lot-b",
        openQuantity: 50,
        totalCostAmount: 50_000,
        openedAt: "2026-01-01",
        openedSequence: 1,
      },
      {
        ...existingLot,
        id: "lot-a",
        openQuantity: 50,
        totalCostAmount: 50_000,
        openedAt: "2026-01-01",
        openedSequence: 1,
      },
    ];

    const result = allocateSellLots(sameDayLots, 50);

    expect(result.matchedLotIds).toEqual(["lot-a"]);
    expect(result.updatedLots).toEqual([
      { ...sameDayLots[0], totalCostAmount: 50_000, openQuantity: 50 },
      { ...sameDayLots[1], totalCostAmount: 0, openQuantity: 0 },
    ]);
  });

  it("orders same-day matched lots by opened sequence before lot id", () => {
    const sameDayLots: Lot[] = [
      {
        ...existingLot,
        id: "lot-b",
        openQuantity: 50,
        totalCostAmount: 50_000,
        openedAt: "2026-01-01",
        openedSequence: 2,
      },
      {
        ...existingLot,
        id: "lot-a",
        openQuantity: 50,
        totalCostAmount: 50_000,
        openedAt: "2026-01-01",
        openedSequence: 1,
      },
    ];

    const result = allocateSellLots(sameDayLots, 50);

    expect(result.matchedLotIds).toEqual(["lot-a"]);
    expect(result.matchedAllocations).toEqual([
      {
        lotId: "lot-a",
        quantity: 50,
        allocatedCostAmount: 50_000,
        costCurrency: "TWD",
        openedAt: "2026-01-01",
        openedSequence: 1,
      },
    ]);
  });
});
