import type { CurrencyCode, FeeProfile, InstrumentType, Lot, MarketCode } from "@tw-portfolio/domain";
import type { UserSettings } from "@tw-portfolio/shared-types";

export interface Account {
  id: string;
  name: string;
  userId: string;
  feeProfileId: string;
}

export interface FeeProfileBinding {
  accountId: string;
  symbol: string;
  marketCode?: MarketCode;
  feeProfileId: string;
}

export interface SymbolDef {
  ticker: string;
  type: InstrumentType;
  marketCode?: MarketCode;
}

export type TransactionType = "BUY" | "SELL";

export interface BookedTradeEvent {
  id: string;
  userId: string;
  accountId: string;
  symbol: string;
  marketCode?: MarketCode;
  instrumentType: InstrumentType;
  type: TransactionType;
  quantity: number;
  unitPrice: number;
  priceCurrency: CurrencyCode;
  tradeDate: string;
  commissionAmount: number;
  taxAmount: number;
  isDayTrade: boolean;
  feeSnapshot: FeeProfile;
  realizedPnlAmount?: number;
  realizedPnlCurrency?: CurrencyCode;
  tradeTimestamp?: string;
  bookingSequence?: number;
  sourceType?: string;
  sourceReference?: string;
  bookedAt?: string;
  reversalOfTradeEventId?: string;
}

export type Transaction = BookedTradeEvent;

export type CashLedgerEntryType =
  | "TRADE_SETTLEMENT_IN"
  | "TRADE_SETTLEMENT_OUT"
  | "DIVIDEND_RECEIPT"
  | "DIVIDEND_DEDUCTION"
  | "MANUAL_ADJUSTMENT"
  | "REVERSAL";

export interface CashLedgerEntry {
  id: string;
  userId: string;
  accountId: string;
  entryDate: string;
  entryType: CashLedgerEntryType;
  amount: number;
  currency: CurrencyCode;
  relatedTradeEventId?: string;
  relatedDividendLedgerEntryId?: string;
  sourceType: string;
  sourceReference?: string;
  note?: string;
  reversalOfCashLedgerEntryId?: string;
  bookedAt?: string;
}

export type DividendEventType = "CASH" | "STOCK" | "CASH_AND_STOCK";

export interface DividendEvent {
  id: string;
  symbol: string;
  eventType: DividendEventType;
  exDividendDate: string;
  paymentDate: string;
  cashDividendPerShare: number;
  cashDividendCurrency: CurrencyCode;
  stockDividendPerShare: number;
  sourceType: string;
  sourceReference?: string;
  createdAt?: string;
}

export type DividendPostingStatus = "expected" | "posted" | "adjusted";
export type DividendReconciliationStatus = "open" | "matched" | "explained" | "resolved";

export interface DividendLedgerEntry {
  id: string;
  accountId: string;
  dividendEventId: string;
  eligibleQuantity: number;
  expectedCashAmount: number;
  expectedStockQuantity: number;
  receivedCashAmount: number;
  receivedStockQuantity: number;
  postingStatus: DividendPostingStatus;
  reconciliationStatus: DividendReconciliationStatus;
  reversalOfDividendLedgerEntryId?: string;
  supersededAt?: string;
  bookedAt?: string;
}
export type DividendDeductionType =
  | "NHI_SUPPLEMENTAL_PREMIUM"
  | "WITHHOLDING_TAX"
  | "BROKER_FEE"
  | "BANK_FEE"
  | "TRANSFER_FEE"
  | "CASH_IN_LIEU_ADJUSTMENT"
  | "ROUNDING_ADJUSTMENT"
  | "OTHER";

export interface DividendDeductionEntry {
  id: string;
  dividendLedgerEntryId: string;
  deductionType: DividendDeductionType;
  amount: number;
  currencyCode: CurrencyCode;
  withheldAtSource: boolean;
  sourceType: string;
  sourceReference?: string;
  note?: string;
  bookedAt?: string;
}
export interface RecomputePreviewItem {
  tradeEventId: string;
  previousCommissionAmount: number;
  previousTaxAmount: number;
  nextCommissionAmount: number;
  nextTaxAmount: number;
}

export interface RecomputeJob {
  id: string;
  userId: string;
  accountId?: string;
  profileId: string;
  status: "PREVIEWED" | "CONFIRMED";
  createdAt: string;
  items: RecomputePreviewItem[];
}

export type CorporateActionType = "DIVIDEND" | "SPLIT" | "REVERSE_SPLIT";

export interface CorporateAction {
  id: string;
  accountId: string;
  symbol: string;
  actionType: CorporateActionType;
  numerator: number;
  denominator: number;
  actionDate: string;
}

export interface HoldingProjection {
  accountId: string;
  symbol: string;
  quantity: number;
  costBasisAmount: number;
  currency: CurrencyCode;
}

export interface LotAllocationProjection {
  id: string;
  userId: string;
  accountId: string;
  tradeEventId: string;
  symbol: string;
  lotId: string;
  lotOpenedAt: string;
  lotOpenedSequence: number;
  allocatedQuantity: number;
  allocatedCostAmount: number;
  costCurrency: CurrencyCode;
  createdAt?: string;
}

export interface DailyPortfolioSnapshot {
  id: string;
  snapshotDate: string;
  totalMarketValueAmount: number;
  totalCostAmount: number;
  totalUnrealizedPnlAmount: number;
  totalRealizedPnlAmount: number;
  totalDividendReceivedAmount: number;
  totalCashBalanceAmount: number;
  totalNavAmount: number;
  currency: CurrencyCode;
  generatedAt: string;
  generationRunId: string;
}

export interface AccountingFacts {
  tradeEvents: BookedTradeEvent[];
  cashLedgerEntries: CashLedgerEntry[];
  dividendEvents: DividendEvent[];
  dividendLedgerEntries: DividendLedgerEntry[];
  dividendDeductionEntries: DividendDeductionEntry[];
  corporateActions: CorporateAction[];
}

export interface AccountingProjections {
  lots: Lot[];
  lotAllocations: LotAllocationProjection[];
  holdings: HoldingProjection[];
  dailyPortfolioSnapshots: DailyPortfolioSnapshot[];
}

export interface AccountingPolicy {
  inventoryModel: "LOT_CAPABLE";
  disposalPolicy: "WEIGHTED_AVERAGE";
}

export interface AccountingStore {
  facts: AccountingFacts;
  projections: AccountingProjections;
  policy: AccountingPolicy;
}

export interface Store {
  userId: string;
  settings: UserSettings;
  accounts: Account[];
  feeProfileBindings: FeeProfileBinding[];
  feeProfiles: FeeProfile[];
  accounting: AccountingStore;
  symbols: SymbolDef[];
  recomputeJobs: RecomputeJob[];
  idempotencyKeys: Set<string>;
}
