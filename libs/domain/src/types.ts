export type CostBasisMethod = "WEIGHTED_AVERAGE";
export type RoundingMode = "FLOOR" | "ROUND" | "CEIL";
export type InstrumentType = "STOCK" | "ETF" | "BOND_ETF";
export type DividendSourceBucket =
  | "DIVIDEND_INCOME"
  | "INTEREST_INCOME"
  | "SECURITIES_GAIN_INCOME"
  | "REVENUE_EQUALIZATION"
  | "CAPITAL_EQUALIZATION"
  | "CAPITAL_RETURN"
  | "OTHER";
export type SourceCompositionStatus = "provided" | "unknown_pending_disclosure";
export type CommissionChargeMode = "CHARGED_UPFRONT" | "CHARGED_UPFRONT_REBATED_LATER";
export type CurrencyCode = string;
export type MarketCode = string;
export type TradeSide = "SELL";
export type DayTradeScope = "ANY" | "DAY_TRADE_ONLY" | "NON_DAY_TRADE_ONLY";
export type TaxCalculationMethod = "RATE_BPS";
export type BackfillStatus = "pending" | "backfilling" | "ready" | "failed";
export type VerificationStatus = "unverified" | "verified" | "mismatch";
export type DailyBarQuality = "full_bar" | "close_only";
export type IntradaySourceKind = "intraday_yahoo_chart";

export interface InstrumentRef {
  ticker: string;
  instrumentType: InstrumentType | null;
  marketCode: MarketCode;
  name?: string;
  isProvisional: boolean;
  lastSyncedAt?: string | null;
}

export interface QuoteSnapshot {
  ticker: string;
  marketCode?: MarketCode;
  close: number;
  previousClose: number | null;
  change: number | null;
  changePercent: number | null;
  asOf: string;
  source: string;
  isProvisional: boolean;
}

export interface DailyBar {
  ticker: string;
  barDate: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  source: string;
  ingestedAt: string;
  quality: DailyBarQuality;
}

export interface DailyBarWithMarket extends DailyBar {
  marketCode: MarketCode;
}

export interface IntradayPriceOverlay {
  ticker: string;
  marketCode: MarketCode;
  price: number;
  previousClose: number | null;
  asOfDate: string;
  asOfTimestamp: string;
  observedAt: string;
  sourceKind: IntradaySourceKind;
  source: string;
  currency: CurrencyCode;
}

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
  // KZO-183: every profile is owned by exactly one account.
  accountId: string;
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
  ticker: string;
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
