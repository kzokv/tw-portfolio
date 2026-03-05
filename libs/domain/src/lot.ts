import type { Lot, SellAllocationResult } from "./types.js";

export function allocateSellLots(lots: Lot[], quantityToSell: number): SellAllocationResult {
  const orderedLots = [...lots].sort((a, b) => a.openedAt.localeCompare(b.openedAt));
  const totalOpenQuantity = orderedLots.reduce((sum, lot) => sum + Math.max(0, lot.openQuantity), 0);
  const totalOpenCostNtd = orderedLots.reduce((sum, lot) => sum + Math.max(0, lot.totalCostNtd), 0);

  if (quantityToSell > totalOpenQuantity) {
    throw new Error("Insufficient quantity to sell");
  }

  const allocatedCostNtd = Math.round((totalOpenCostNtd / totalOpenQuantity) * quantityToSell);
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

  let costLeftToAssign = remainingOpenCostNtd;
  let quantityLeftToAssign = remainingOpenQuantity;
  for (let index = 0; index < openLots.length; index += 1) {
    const lot = openLots[index];
    const isLast = index === openLots.length - 1;
    const nextCost = isLast ? costLeftToAssign : Math.round((costLeftToAssign * lot.openQuantity) / quantityLeftToAssign);
    updates.set(lot.id, {
      ...lot,
      totalCostNtd: nextCost,
    });
    costLeftToAssign -= nextCost;
    quantityLeftToAssign -= lot.openQuantity;
  }

  const updatedLots = lots.map((lot) => updates.get(lot.id) ?? lot);
  return { matchedLotIds, allocatedCostNtd, updatedLots };
}
