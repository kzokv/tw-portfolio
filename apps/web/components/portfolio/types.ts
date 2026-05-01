import type { CurrencyCode, MarketCode } from "@tw-portfolio/shared-types";

export interface Holding {
  accountId: string;
  ticker: string;
  quantity: number;
  costBasisAmount: number;
  currency: CurrencyCode;
}

// KZO-169: form payload now carries `marketCode` alongside `ticker`. The
// combobox commits both, the chip preselects which markets are visible, and
// `priceCurrency` becomes a derived display value (server validates via
// `account.defaultCurrency === currencyFor(marketCode)`).
export interface TransactionInput {
  accountId: string;
  ticker: string;
  marketCode: MarketCode | null;
  quantity: number;
  unitPrice: number;
  priceCurrency: CurrencyCode;
  tradeDate: string;
  commissionAmount?: number;
  taxAmount?: number;
  type: "BUY" | "SELL";
  isDayTrade: boolean;
}
