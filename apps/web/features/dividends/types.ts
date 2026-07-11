import type {
  CurrencyCode,
  DividendSourceBucket,
  DividendSourceLine,
  ExpectedStockCalcState,
  InstrumentType,
  SourceCompositionStatus,
} from "@vakwen/shared-types";

export type DividendEventType = "CASH" | "STOCK" | "CASH_AND_STOCK";
export type DividendPostingStatus = "expected" | "posted" | "adjusted";
export type DividendReconciliationStatus = "open" | "matched" | "explained" | "resolved";

export type DividendDeductionType =
  | "WITHHOLDING_TAX"
  | "NHI_SUPPLEMENTAL_PREMIUM"
  | "BROKER_FEE"
  | "BANK_FEE"
  | "TRANSFER_FEE"
  | "CASH_IN_LIEU_ADJUSTMENT"
  | "ROUNDING_ADJUSTMENT"
  | "OTHER";

export interface DividendDeductionInput {
  id?: string;
  deductionType: DividendDeductionType;
  amount: number;
  source?: string;
  sourceReference?: string;
  note?: string;
  withheldAtSource: boolean;
  currencyCode?: CurrencyCode;
}

export interface DividendSourceLineInput {
  id?: string;
  sourceBucket: DividendSourceBucket;
  amount: number;
  source?: string;
  sourceReference?: string;
  note?: string;
  currencyCode?: CurrencyCode;
}

export interface DividendLedgerEntryDetails {
  rowKind?: "ledger" | "expected";
  id: string;
  dividendEventId: string;
  accountId: string;
  accountName?: string | null;
  ticker: string;
  tickerName?: string | null;
  marketCode: string;
  bookedAt?: string;
  instrumentType: InstrumentType;
  eventType: DividendEventType;
  paymentDate: string | null;
  exDividendDate: string;
  cashCurrency: CurrencyCode;
  postingStatus: DividendPostingStatus;
  reconciliationStatus: DividendReconciliationStatus;
  sourceCompositionStatus: SourceCompositionStatus;
  version: number;
  reconciliationNote?: string | null;
  correctionMode?: "in_place" | "amend" | "reversal_replacement" | null;
  amendmentBlockedReason?: string | null;
  linkedPositionActionId?: string | null;
  linkedPositionActionStatus?: string | null;
  cashInLieuAmount?: number | null;
  parValueBaseAmount?: number | null;
  premiumBaseAmount?: number | null;
  nhiPremiumBaseAmount?: number | null;
  portfolioCostBasisAddedAmount?: number | null;
  expectedGrossAmount?: number | null;
  expectedNetAmount?: number | null;
  actualNetAmount?: number | null;
  varianceAmount?: number | null;
  nhiAmount?: number | null;
  bankFeeAmount?: number | null;
  otherDeductionAmount?: number | null;
  stockDistributionRatio?: number | null;
  stockDistributionRatioState?: "authoritative" | "derived_non_authoritative" | "unresolved" | null;
  expectedStockCalcState?: ExpectedStockCalcState | null;
  expectedStockParValueAmount?: number | null;
  parValueAmount?: number | null;
  needsActionReasons?: string[] | null;
  snapshotRefreshStatus?: "idle" | "queued" | "running" | "complete" | "failed" | null;
  expectedCashAmount: number;
  receivedCashAmount: number;
  expectedStockQuantity: number;
  receivedStockQuantity: number;
  eligibleQuantity: number;
  sourceLines: DividendSourceLine[];
  deductions: Array<{
    id: string;
    dividendLedgerEntryId: string;
    deductionType: DividendDeductionType;
    amount: number;
    currencyCode: CurrencyCode;
    withheldAtSource: boolean;
    source: string;
    sourceReference?: string;
    note?: string;
    bookedAt?: string;
  }>;
}

export interface DividendEventListItem {
  id: string;
  accountId: string;
  accountName?: string | null;
  ticker: string;
  tickerName?: string | null;
  marketCode: string;
  instrumentType: InstrumentType;
  eventType: DividendEventType;
  exDividendDate: string;
  paymentDate: string | null;
  cashDividendCurrency: CurrencyCode;
  expectedCashAmount: number;
  expectedStockQuantity: number;
  eligibleQuantity: number;
  parValuePerShare?: number | null;
  hasPostedLedgerEntry: boolean;
  dividendLedgerEntryId: string | null;
}

export interface DividendCalendarSnapshot {
  events: DividendEventListItem[];
  ledgerEntries: DividendLedgerEntryDetails[];
}

export interface DividendPostingPayload {
  dividendEventId: string;
  accountId: string;
  receivedCashAmount?: number;
  receivedStockQuantity?: number;
  deductions: DividendDeductionInput[];
  sourceLines: DividendSourceLineInput[];
  sourceCompositionStatus: SourceCompositionStatus;
  dividendLedgerEntryId?: string;
  expectedVersion?: number;
}

export interface DividendPostingResult {
  dividendLedgerEntry: {
    id: string;
    accountId: string;
    dividendEventId: string;
    version: number;
    reconciliationStatus: DividendReconciliationStatus;
    sourceCompositionStatus: SourceCompositionStatus;
  };
  comparison?: {
    expectedCashAmount: number;
    actualCashEconomicAmount: number;
    cashVarianceAmount: number;
    expectedStockQuantity: number;
    actualStockQuantity: number;
    stockVarianceQuantity: number;
  };
}

export interface DividendCalendarRow {
  key: string;
  event: DividendEventListItem;
  ledgerEntry: DividendLedgerEntryDetails | null;
}
