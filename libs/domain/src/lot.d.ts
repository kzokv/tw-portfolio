import type { BuyApplicationResult, Lot, SellAllocationResult } from "./types.js";
export declare function applyBuyToLots(lots: Lot[], buyLot: Lot): BuyApplicationResult;
export declare function allocateSellLots(lots: Lot[], quantityToSell: number): SellAllocationResult;
