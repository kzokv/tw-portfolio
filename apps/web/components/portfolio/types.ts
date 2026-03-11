import type { CurrencyCode } from "@tw-portfolio/shared-types";

export interface Holding {
  accountId: string;
  symbol: string;
  quantity: number;
  costBasisAmount: number;
  currency: CurrencyCode;
}

export interface TransactionInput {
  accountId: string;
  symbol: string;
  quantity: number;
  unitPrice: number;
  priceCurrency: CurrencyCode;
  tradeDate: string;
  commissionAmount?: number;
  taxAmount?: number;
  type: "BUY" | "SELL";
  isDayTrade: boolean;
}
