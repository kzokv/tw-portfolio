import type { CurrencyCode } from "@tw-portfolio/shared-types";

export interface Holding {
  accountId: string;
  ticker: string;
  quantity: number;
  costBasisAmount: number;
  currency: CurrencyCode;
}

export interface TransactionInput {
  accountId: string;
  ticker: string;
  quantity: number;
  unitPrice: number;
  priceCurrency: CurrencyCode;
  tradeDate: string;
  commissionAmount?: number;
  taxAmount?: number;
  type: "BUY" | "SELL";
  isDayTrade: boolean;
}
