export type CostBasisMethod = "WEIGHTED_AVERAGE";
export type RoundingMode = "FLOOR" | "ROUND" | "CEIL";
export type InstrumentType = "STOCK" | "ETF" | "BOND_ETF";
export type CommissionChargeMode = "CHARGED_UPFRONT" | "CHARGED_UPFRONT_REBATED_LATER";
export type CurrencyCode = string;
export type MarketCode = string;
export type TradeSide = "SELL";
export type DayTradeScope = "ANY" | "DAY_TRADE_ONLY" | "NON_DAY_TRADE_ONLY";
export type TaxCalculationMethod = "RATE_BPS";

export interface FeeProfileTaxRule {
  id: string;
  marketCode: MarketCode;
  tradeSide: TradeSide;
  instrumentType: InstrumentType;
  dayTradeScope: DayTradeScope;
  taxComponentCode: string;
  calculationMethod: TaxCalculationMethod;
  rateBps: number;
  sortOrder: number;
  effectiveFrom?: string;
  effectiveTo?: string;
}

export interface AppliedTaxComponent extends FeeProfileTaxRule {
  taxAmount: number;
}

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
  taxRules?: FeeProfileTaxRule[];
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
