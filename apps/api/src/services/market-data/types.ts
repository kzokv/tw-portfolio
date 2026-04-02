/** Earliest date for TaiwanStockPrice dataset — used as default startDate for full backfill. */
export const HISTORY_START = "1994-10-01";

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

/** Raw instrument info from FinMind TaiwanStockInfo dataset. */
export interface RawInstrumentInfo {
  ticker: string;
  name: string;
  typeRaw: string;
  industryCategory: string;
  date: string;
}

/** Raw delisting record from FinMind TaiwanStockDelisting dataset. */
export interface RawDelistingRecord {
  ticker: string;
  name: string;
  date: string;
}

/** Swappable FinMind data provider interface. */
export interface FinMindProvider {
  fetchDailyBars(ticker: string, startDate?: string, endDate?: string): Promise<RawDailyBar[]>;
  fetchDividendEvents(ticker: string, startDate?: string, endDate?: string): Promise<DividendRecord[]>;
  fetchInstrumentCatalog(): Promise<RawInstrumentInfo[]>;
  fetchDelistingHistory(): Promise<RawDelistingRecord[]>;
}
