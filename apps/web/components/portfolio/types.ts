export interface Holding {
  accountId: string;
  symbol: string;
  quantity: number;
  costNtd: number;
}

export interface TransactionInput {
  accountId: string;
  symbol: string;
  quantity: number;
  priceNtd: number;
  tradeDate: string;
  commissionNtd?: number;
  taxNtd?: number;
  type: "BUY" | "SELL";
  isDayTrade: boolean;
}
