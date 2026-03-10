/**
 * Shared payloads and request data for API integration tests.
 * Single source of truth to reduce duplication and keep tests maintainable.
 */

export type TransactionType = "BUY" | "SELL";

interface TransactionPayloadBase {
  accountId: string;
  symbol: string;
  quantity: number;
  priceNtd: number;
  tradeDate: string;
  tradeTimestamp?: string;
  bookingSequence?: number;
  commissionNtd?: number;
  taxNtd?: number;
  type: TransactionType;
  isDayTrade: boolean;
}

const defaultTransaction: TransactionPayloadBase = {
  accountId: "acc-1",
  symbol: "2330",
  quantity: 10,
  priceNtd: 100,
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
  name: "Test Profile",
  commissionRateBps: 0,
  commissionDiscountBps: 10000,
  minCommissionNtd: 0,
  commissionRoundingMode: "FLOOR" as const,
  taxRoundingMode: "FLOOR" as const,
  stockSellTaxRateBps: 0,
  stockDayTradeTaxRateBps: 0,
  etfSellTaxRateBps: 0,
  bondEtfSellTaxRateBps: 0,
};

export function feeProfilePayload(
  overrides: Partial<typeof defaultFeeProfile> = {},
): typeof defaultFeeProfile & Record<string, unknown> {
  return { ...defaultFeeProfile, ...overrides };
}

export function corporateActionDividendPayload(overrides: Record<string, unknown> = {}) {
  return {
    accountId: "acc-1",
    symbol: "2330",
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
    symbol: "2330",
    actionType: "SPLIT",
    numerator: 2,
    denominator: 1,
    actionDate: "2026-03-01",
    ...overrides,
  };
}

export function dividendEventPayload(overrides: Record<string, unknown> = {}) {
  return {
    symbol: "2330",
    eventType: "CASH",
    exDividendDate: "2026-02-01",
    paymentDate: "2026-02-20",
    cashDividendPerShare: 12,
    stockDividendPerShare: 0,
    sourceType: "manual_dividend_event",
    ...overrides,
  };
}

export function dividendPostingPayload(overrides: Record<string, unknown> = {}) {
  return {
    accountId: "acc-1",
    dividendEventId: "replace-me",
    receivedCashAmountNtd: 108,
    receivedStockQuantity: 0,
    deductions: [
      {
        deductionType: "NHI_SUPPLEMENTAL_PREMIUM",
        amount: 12,
        withheldAtSource: true,
        sourceType: "dividend_posting",
      },
    ],
    ...overrides,
  };
}
