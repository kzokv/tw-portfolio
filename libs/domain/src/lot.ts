import type { BuyApplicationResult, Lot, SellAllocationResult } from "./types.js";

export function applyBuyToLots(lots: Lot[], buyLot: Lot): BuyApplicationResult {
  assertWholePositiveQuantity(buyLot.openQuantity, "Buy quantity must be a positive integer");
  assertNonNegativeCost(buyLot.totalCostNtd);

  const updatedLots = normalizeLotsForWeightedAverage([...lots, buyLot]);
  const { averageCostNtd } = summarizeOpenLots(updatedLots);
  return { averageCostNtd, updatedLots };
}

export function allocateSellLots(lots: Lot[], quantityToSell: number): SellAllocationResult {
  assertWholePositiveQuantity(quantityToSell, "Sell quantity must be a positive integer");

  const normalizedLots = normalizeLotsForWeightedAverage(lots);
  const orderedLots = orderLots(normalizedLots);
  const { averageCostNtd, totalOpenCostNtd, totalOpenQuantity } = summarizeOpenLots(orderedLots);

  if (quantityToSell > totalOpenQuantity) {
    throw new Error("Insufficient quantity to sell");
  }

  const allocatedCostNtd = Math.round(averageCostNtd * quantityToSell);
  const remainingOpenQuantity = totalOpenQuantity - quantityToSell;
  const remainingOpenCostNtd = Math.max(0, totalOpenCostNtd - allocatedCostNtd);

  let remainingQty = quantityToSell;
  const matchedLotIds: string[] = [];
  const updates = new Map<string, Lot>();

  for (const lot of orderedLots) {
    if (remainingQty <= 0) break;
    if (lot.openQuantity <= 0) continue;

    const matchedQty = Math.min(remainingQty, lot.openQuantity);
    remainingQty -= matchedQty;

    updates.set(lot.id, {
      ...lot,
      openQuantity: lot.openQuantity - matchedQty,
      totalCostNtd: 0,
    });
    matchedLotIds.push(lot.id);
  }

  const openLots = orderedLots
    .map((lot) => updates.get(lot.id) ?? lot)
    .filter((lot) => lot.openQuantity > 0);

  const normalizedOpenLots = normalizeLotsForWeightedAverage(openLots, remainingOpenCostNtd);
  for (const lot of normalizedOpenLots) {
    updates.set(lot.id, lot);
  }

  const updatedLots = normalizedLots.map((lot) => updates.get(lot.id) ?? lot);
  return { matchedLotIds, allocatedCostNtd, averageCostNtd, updatedLots };
}

function normalizeLotsForWeightedAverage(lots: Lot[], forcedTotalCostNtd?: number): Lot[] {
  if (lots.length === 0) return [];

  const orderedOpenLots = orderLots(
    lots.filter((lot) => lot.openQuantity > 0).map((lot) => {
      assertWholePositiveQuantity(lot.openQuantity, "Lot quantity must be a positive integer");
      assertNonNegativeCost(lot.totalCostNtd);
      return lot;
    }),
  );

  const totalOpenQuantity = orderedOpenLots.reduce((sum, lot) => sum + lot.openQuantity, 0);
  if (totalOpenQuantity === 0) {
    return lots.map((lot) => ({ ...lot, totalCostNtd: 0 }));
  }

  let costLeftToAssign =
    forcedTotalCostNtd ?? orderedOpenLots.reduce((sum, lot) => sum + Math.max(0, lot.totalCostNtd), 0);
  let quantityLeftToAssign = totalOpenQuantity;

  const normalizedCosts = new Map<string, number>();
  for (let index = 0; index < orderedOpenLots.length; index += 1) {
    const lot = orderedOpenLots[index];
    const isLast = index === orderedOpenLots.length - 1;
    const nextCost = isLast
      ? costLeftToAssign
      : Math.round((costLeftToAssign * lot.openQuantity) / quantityLeftToAssign);
    normalizedCosts.set(lot.id, nextCost);
    costLeftToAssign -= nextCost;
    quantityLeftToAssign -= lot.openQuantity;
  }

  return lots.map((lot) =>
    lot.openQuantity > 0
      ? {
          ...lot,
          totalCostNtd: normalizedCosts.get(lot.id) ?? 0,
        }
      : {
          ...lot,
          totalCostNtd: 0,
        },
  );
}

function orderLots(lots: Lot[]): Lot[] {
  return [...lots].sort((a, b) => {
    const openedAtCompare = a.openedAt.localeCompare(b.openedAt);
    if (openedAtCompare !== 0) return openedAtCompare;
    return a.id.localeCompare(b.id);
  });
}

function summarizeOpenLots(lots: Lot[]): {
  averageCostNtd: number;
  totalOpenCostNtd: number;
  totalOpenQuantity: number;
} {
  const totalOpenQuantity = lots.reduce((sum, lot) => sum + Math.max(0, lot.openQuantity), 0);
  const totalOpenCostNtd = lots.reduce((sum, lot) => sum + Math.max(0, lot.totalCostNtd), 0);
  return {
    averageCostNtd: totalOpenQuantity === 0 ? 0 : totalOpenCostNtd / totalOpenQuantity,
    totalOpenCostNtd,
    totalOpenQuantity,
  };
}

function assertWholePositiveQuantity(quantity: number, message: string): void {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error(message);
  }
}

function assertNonNegativeCost(totalCostNtd: number): void {
  if (!Number.isInteger(totalCostNtd) || totalCostNtd < 0) {
    throw new Error("Lot cost must be a non-negative integer");
  }
}
