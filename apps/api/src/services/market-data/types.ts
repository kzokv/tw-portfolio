/** Raw daily OHLCV bar from FinMind TaiwanStockPrice dataset (pre-ingestion shape). */
export interface RawDailyBar {
  ticker: string;
  barDate: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** Dividend event from FinMind TaiwanStockDividend dataset. */
export interface DividendRecord {
  ticker: string;
  exDividendDate: string; // YYYY-MM-DD
  paymentDate: string; // YYYY-MM-DD
  cashDividendPerShare: number;
  stockDividendPerShare: number;
}

/** Swappable FinMind data provider interface. */
export interface FinMindProvider {
  fetchDailyBars(ticker: string): Promise<RawDailyBar[]>;
  fetchDividendEvents(ticker: string): Promise<DividendRecord[]>;
}
