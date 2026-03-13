export type CostBasisMethod = "WEIGHTED_AVERAGE";
export type LocaleCode = "en" | "zh-TW";
export type InstrumentType = "STOCK" | "ETF" | "BOND_ETF";
export type CurrencyCode = string;

export interface UserSettings {
  userId: string;
  locale: LocaleCode;
  costBasisMethod: CostBasisMethod;
  quotePollIntervalSeconds: number;
}

export interface FeeProfileDto {
  id: string;
  name: string;
  boardCommissionRate: number;
  commissionDiscountPercent: number;
  minimumCommissionAmount: number;
  commissionCurrency: CurrencyCode;
  commissionRoundingMode: "FLOOR" | "ROUND" | "CEIL";
  taxRoundingMode: "FLOOR" | "ROUND" | "CEIL";
  stockSellTaxRateBps: number;
  stockDayTradeTaxRateBps: number;
  etfSellTaxRateBps: number;
  bondEtfSellTaxRateBps: number;
  commissionChargeMode: "CHARGED_UPFRONT" | "CHARGED_UPFRONT_REBATED_LATER";
}

export interface AccountDto {
  id: string;
  name: string;
  userId: string;
  feeProfileId: string;
}

export interface FeeProfileBindingDto {
  accountId: string;
  symbol: string;
  feeProfileId: string;
}

export interface IntegrityIssueDto {
  code: string;
  message: string;
}

export interface DashboardOverviewSummaryDto {
  asOf: string;
  accountCount: number;
  holdingCount: number;
  totalCostAmount: number;
  totalCostCurrency: CurrencyCode;
  marketValueAmount: number | null;
  unrealizedPnlAmount: number | null;
  upcomingDividendCount: number;
  upcomingDividendAmount: number | null;
  openIssueCount: number;
}

export interface DashboardOverviewHoldingDto {
  accountId: string;
  symbol: string;
  quantity: number;
  costBasisAmount: number;
  currency: CurrencyCode;
  averageCostPerShare: number;
  currentUnitPrice: number | null;
  marketValueAmount: number | null;
  unrealizedPnlAmount: number | null;
  allocationPct: number | null;
  nextDividendDate: string | null;
  lastDividendPostedDate: string | null;
}

export interface DashboardOverviewUpcomingDividendDto {
  accountId: string;
  symbol: string;
  exDividendDate: string | null;
  paymentDate: string | null;
  expectedAmount: number | null;
  currency: CurrencyCode;
  status: "declared" | "expected" | "paying-soon";
}

export interface DashboardOverviewRecentDividendDto {
  accountId: string;
  symbol: string;
  postedAt: string;
  netAmount: number;
  grossAmount: number | null;
  deductionAmount: number | null;
  currency: CurrencyCode;
  sourceSummary: string | null;
  status: "posted" | "unreconciled";
}

export interface SymbolOptionDto {
  ticker: string;
  instrumentType: InstrumentType;
  marketCode: string | null;
  isProvisional: boolean;
}

export interface DashboardOverviewDto {
  settings: UserSettings;
  summary: DashboardOverviewSummaryDto;
  holdings: DashboardOverviewHoldingDto[];
  dividends: {
    upcoming: DashboardOverviewUpcomingDividendDto[];
    recent: DashboardOverviewRecentDividendDto[];
  };
  actions: {
    integrityIssue: IntegrityIssueDto | null;
    recomputeAvailable: boolean;
  };
  symbols: SymbolOptionDto[];
  accounts: AccountDto[];
  feeProfiles: FeeProfileDto[];
  feeProfileBindings: FeeProfileBindingDto[];
}

export interface TransactionHistoryItemDto {
  id: string;
  accountId: string;
  symbol: string;
  marketCode: string | null;
  instrumentType: InstrumentType;
  type: "BUY" | "SELL";
  quantity: number;
  unitPrice: number;
  priceCurrency: CurrencyCode;
  tradeDate: string;
  tradeTimestamp: string | null;
  bookingSequence: number | null;
  commissionAmount: number;
  taxAmount: number;
  isDayTrade: boolean;
  realizedPnlAmount: number | null;
  realizedPnlCurrency: CurrencyCode | null;
  feeProfileId: string;
  feeProfileName: string;
  bookedAt: string | null;
}
