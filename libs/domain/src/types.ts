export type CostBasisMethod = "WEIGHTED_AVERAGE";
export type RoundingMode = "FLOOR" | "ROUND" | "CEIL";
export type InstrumentType = "STOCK" | "ETF" | "BOND_ETF";

export interface FeeProfile {
  id: string;
  name: string;
  commissionRateBps: number;
  commissionDiscountBps: number;
  minCommissionNtd: number;
  commissionRoundingMode: RoundingMode;
  taxRoundingMode: RoundingMode;
  stockSellTaxRateBps: number;
  stockDayTradeTaxRateBps: number;
  etfSellTaxRateBps: number;
  bondEtfSellTaxRateBps: number;
}

export interface Lot {
  id: string;
  accountId: string;
  symbol: string;
  openQuantity: number;
  totalCostNtd: number;
  openedAt: string;
  openedSequence?: number;
}

export interface MatchedLotAllocation {
  lotId: string;
  quantity: number;
  allocatedCostNtd: number;
  openedAt: string;
  openedSequence?: number;
}

export interface BuyApplicationResult {
  averageCostNtd: number;
  updatedLots: Lot[];
}

export interface SellAllocationResult {
  matchedLotIds: string[];
  matchedAllocations: MatchedLotAllocation[];
  allocatedCostNtd: number;
  averageCostNtd: number;
  updatedLots: Lot[];
}
