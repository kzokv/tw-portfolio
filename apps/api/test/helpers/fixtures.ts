/**
 * Shared payloads and request data for API integration tests.
 * Single source of truth to reduce duplication and keep tests maintainable.
 */

export type TransactionType = "BUY" | "SELL";

interface TransactionPayloadBase {
  accountId: string;
  ticker: string;
  quantity: number;
  unitPrice: number;
  priceCurrency: string;
  tradeDate: string;
  tradeTimestamp?: string;
  bookingSequence?: number;
  commissionAmount?: number;
  taxAmount?: number;
  type: TransactionType;
  isDayTrade: boolean;
}

const defaultTransaction: TransactionPayloadBase = {
  accountId: "acc-1",
  ticker: "2330",
  quantity: 10,
  unitPrice: 100,
  priceCurrency: "TWD",
  tradeDate: "2026-01-01",
  type: "BUY",
  isDayTrade: false,
};

export function transactionPayload(
  overrides: Partial<TransactionPayloadBase> = {},
): TransactionPayloadBase & Record<string, unknown> {
  return { ...defaultTransaction, ...overrides };
}

const defaultFeeProfile = {
  // KZO-183: fee profiles are account-scoped. The integration tests
  // default to the seeded "acc-1" account; specs that use a different
  // account override `accountId` per call.
  accountId: "acc-1",
  name: "Test Profile",
  boardCommissionRate: 0,
  commissionDiscountPercent: 0,
  minimumCommissionAmount: 0,
  commissionCurrency: "TWD",
  commissionRoundingMode: "FLOOR" as const,
  taxRoundingMode: "FLOOR" as const,
  stockSellTaxRateBps: 0,
  stockDayTradeTaxRateBps: 0,
  etfSellTaxRateBps: 0,
  bondEtfSellTaxRateBps: 0,
  commissionChargeMode: "CHARGED_UPFRONT" as const,
};

export function feeProfilePayload(
  overrides: Partial<typeof defaultFeeProfile> = {},
): typeof defaultFeeProfile & Record<string, unknown> {
  return { ...defaultFeeProfile, ...overrides };
}

export function corporateActionDividendPayload(overrides: Record<string, unknown> = {}) {
  return {
    accountId: "acc-1",
    ticker: "2330",
    actionType: "DIVIDEND",
    numerator: 1,
    denominator: 1,
    actionDate: "2026-02-01",
    ...overrides,
  };
}

export function corporateActionSplitPayload(overrides: Record<string, unknown> = {}) {
  return {
    accountId: "acc-1",
    ticker: "2330",
    actionType: "SPLIT",
    numerator: 2,
    denominator: 1,
    actionDate: "2026-03-01",
    ...overrides,
  };
}

export function dividendEventPayload(overrides: Record<string, unknown> = {}) {
  return {
    ticker: "2330",
    eventType: "CASH",
    exDividendDate: "2026-02-01",
    paymentDate: "2026-02-20",
    cashDividendPerShare: 12,
    cashDividendCurrency: "TWD",
    stockDividendPerShare: 0,
    source: "manual_dividend_event",
    ...overrides,
  };
}

export function seededDividendEventPayload(overrides: Record<string, unknown> = {}) {
  return {
    accountId: "acc-1",
    eligibleQuantity: 1_000,
    ...dividendEventPayload(),
    ...overrides,
  };
}

export function dividendPostingPayload(overrides: Record<string, unknown> = {}) {
  return {
    accountId: "acc-1",
    dividendEventId: "replace-me",
    receivedCashAmount: 108,
    receivedStockQuantity: 0,
    sourceCompositionStatus: "provided",
    sourceLines: [
      {
        sourceBucket: "DIVIDEND_INCOME",
        amount: 120,
        currencyCode: "TWD",
        source: "issuer_statement",
        sourceReference: "stmt-2026-02",
      },
    ],
    deductions: [
      {
        deductionType: "NHI_SUPPLEMENTAL_PREMIUM",
        amount: 12,
        currencyCode: "TWD",
        withheldAtSource: true,
        source: "dividend_posting",
      },
    ],
    ...overrides,
  };
}

export function dividendPostingUpdatePayload(overrides: Record<string, unknown> = {}) {
  return dividendPostingPayload({
    dividendLedgerEntryId: "replace-ledger-entry",
    expectedVersion: 1,
    receivedCashAmount: 96,
    deductions: [
      {
        deductionType: "WITHHOLDING_TAX",
        amount: 24,
        currencyCode: "TWD",
        withheldAtSource: true,
        source: "broker_statement",
      },
    ],
    sourceLines: [
      {
        sourceBucket: "DIVIDEND_INCOME",
        amount: 120,
        currencyCode: "TWD",
        source: "broker_statement",
      },
    ],
    ...overrides,
  });
}

export function dividendReconciliationPayload(overrides: Record<string, unknown> = {}) {
  return {
    status: "matched",
    ...overrides,
  };
}
