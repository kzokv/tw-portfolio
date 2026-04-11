export type CashLedgerEntryType =
  | "TRADE_SETTLEMENT_IN"
  | "TRADE_SETTLEMENT_OUT"
  | "DIVIDEND_RECEIPT"
  | "DIVIDEND_DEDUCTION"
  | "MANUAL_ADJUSTMENT"
  | "REVERSAL";

export interface TradeDetail {
  quantity: number;
  unitPrice: number;
  commissionAmount: number;
  taxAmount: number;
}

export interface DividendDetail {
  expectedCashAmount: number;
  receivedCashAmount: number;
  deductionTotal: number;
}

export interface EnrichedCashLedgerEntry {
  id: string;
  userId: string;
  accountId: string;
  entryDate: string;
  entryType: CashLedgerEntryType;
  amount: number;
  currency: string;
  relatedTradeEventId?: string;
  relatedDividendLedgerEntryId?: string;
  source: string;
  sourceReference?: string;
  note?: string;
  reversalOfCashLedgerEntryId?: string;
  bookedAt?: string;
  ticker: string | null;
  side: "BUY" | "SELL" | null;
  tradeDetail?: TradeDetail;
  dividendDetail?: DividendDetail;
}

export interface CashLedgerSummary {
  accountId: string;
  currency: string;
  amount: number;
}

export interface CashLedgerListResponse {
  entries: EnrichedCashLedgerEntry[];
  summary: CashLedgerSummary[];
}

export interface CashLedgerQuery {
  fromEntryDate?: string;
  toEntryDate?: string;
  accountId?: string;
  entryType?: CashLedgerEntryType[];
  limit?: number;
}
