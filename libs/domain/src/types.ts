export type CostBasisMethod = "WEIGHTED_AVERAGE";
export type RoundingMode = "FLOOR" | "ROUND" | "CEIL";
export type InstrumentType = "STOCK" | "ETF" | "BOND_ETF";
export type CommissionChargeMode = "CHARGED_UPFRONT" | "CHARGED_UPFRONT_REBATED_LATER";
export type CurrencyCode = string;

export interface FeeProfile {
  id: string;
  name: string;
  boardCommissionRate: number;
  commissionDiscountPercent: number;
  minimumCommissionAmount: number;
  commissionCurrency: CurrencyCode;
  commissionRoundingMode: RoundingMode;
  taxRoundingMode: RoundingMode;
  stockSellTaxRateBps: number;
  stockDayTradeTaxRateBps: number;
  etfSellTaxRateBps: number;
  bondEtfSellTaxRateBps: number;
  commissionChargeMode: CommissionChargeMode;
}

export interface Lot {
  id: string;
  accountId: string;
  symbol: string;
  openQuantity: number;
  totalCostAmount: number;
  costCurrency: CurrencyCode;
  openedAt: string;
  openedSequence?: number;
}

export interface MatchedLotAllocation {
  lotId: string;
  quantity: number;
  allocatedCostAmount: number;
  costCurrency: CurrencyCode;
  openedAt: string;
  openedSequence?: number;
}

export interface BuyApplicationResult {
  averageCostAmount: number;
  updatedLots: Lot[];
}

export interface SellAllocationResult {
  matchedLotIds: string[];
  matchedAllocations: MatchedLotAllocation[];
  allocatedCostAmount: number;
  averageCostAmount: number;
  updatedLots: Lot[];
}
