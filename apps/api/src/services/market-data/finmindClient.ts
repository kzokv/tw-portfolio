import { Env } from "@tw-portfolio/config";
import { HISTORY_START } from "./types.js";
import type { RawDailyBar, DividendRecord, RawInstrumentInfo, RawDelistingRecord, FinMindProvider } from "./types.js";

const FINMIND_BASE = "https://api.finmindtrade.com/api/v4/data";

interface FinMindResponse<T> {
  msg: string;
  status: number;
  data: T[];
}

interface FinMindPriceRow {
  date: string;
  stock_id: string;
  Trading_Volume: number;
  open: number;
  max: number;
  min: number;
  close: number;
}

interface FinMindInstrumentRow {
  stock_id: string;
  stock_name: string;
  type: string;
  industry_category: string;
  date: string;
}

interface FinMindDelistingRow {
  stock_id: string;
  stock_name: string;
  date: string;
}

interface FinMindDividendRow {
  date: string;
  stock_id: string;
  CashEarningsDistribution: number;
  CashStatutorySurplus: number;
  StockEarningsDistribution: number;
  StockStatutorySurplus: number;
  CashExDividendTradingDate: string;
  CashDividendPaymentDate: string;
  StockExDividendTradingDate: string;
  year: string;
  AnnouncementDate: string;
  ParticipateDistributionOfTotalShares: number;
}

async function fetchDataset<T>(dataset: string, ticker: string, startDate: string = HISTORY_START, endDate?: string): Promise<T[]> {
  const token = Env.FINMIND_API_TOKEN;
  if (!token) throw new Error("FINMIND_API_TOKEN is not configured");

  const params = new URLSearchParams({
    dataset,
    data_id: ticker,
    start_date: startDate,
    token,
  });
  if (endDate) {
    params.set("end_date", endDate);
  }

  const res = await fetch(`${FINMIND_BASE}?${params.toString()}`);
  if (res.status === 402) {
    throw new Error("FinMind rate limit exceeded (402)");
  }
  if (!res.ok) {
    throw new Error(`FinMind API error: ${res.status} ${res.statusText}`);
  }

  const body = (await res.json()) as FinMindResponse<T>;
  if (body.status !== 200) {
    throw new Error(`FinMind API returned status ${body.status}: ${body.msg}`);
  }
  return body.data;
}

async function fetchCatalogDataset<T>(dataset: string): Promise<T[]> {
  const token = Env.FINMIND_API_TOKEN;
  if (!token) throw new Error("FINMIND_API_TOKEN is not configured");

  const params = new URLSearchParams({ dataset, token });

  const res = await fetch(`${FINMIND_BASE}?${params.toString()}`);
  if (res.status === 402) {
    throw new Error("FinMind rate limit exceeded (402)");
  }
  if (!res.ok) {
    throw new Error(`FinMind API error: ${res.status} ${res.statusText}`);
  }

  const body = (await res.json()) as FinMindResponse<T>;
  if (body.status !== 200) {
    throw new Error(`FinMind API returned status ${body.status}: ${body.msg}`);
  }
  return body.data;
}

export class FinMindClient implements FinMindProvider {
  async fetchDailyBars(ticker: string, startDate?: string, endDate?: string): Promise<RawDailyBar[]> {
    const rows = await fetchDataset<FinMindPriceRow>("TaiwanStockPrice", ticker, startDate, endDate);
    return rows.map((r) => ({
      ticker: r.stock_id,
      barDate: r.date,
      open: r.open,
      high: r.max,
      low: r.min,
      close: r.close,
      volume: r.Trading_Volume,
    }));
  }

  async fetchDividendEvents(ticker: string, startDate?: string, endDate?: string): Promise<DividendRecord[]> {
    const rows = await fetchDataset<FinMindDividendRow>("TaiwanStockDividend", ticker, startDate, endDate);
    return rows
      .filter((r) => {
        const cashTotal = r.CashEarningsDistribution + r.CashStatutorySurplus;
        const stockTotal = r.StockEarningsDistribution + r.StockStatutorySurplus;
        return cashTotal > 0 || stockTotal > 0;
      })
      .map((r) => {
        const cashTotal = r.CashEarningsDistribution + r.CashStatutorySurplus;
        const stockTotal = r.StockEarningsDistribution + r.StockStatutorySurplus;
        // Use cash ex-dividend date if available, otherwise stock ex-dividend date
        const exDate = r.CashExDividendTradingDate || r.StockExDividendTradingDate || r.date;
        const payDate = r.CashDividendPaymentDate || exDate;
        return {
          ticker: r.stock_id,
          exDividendDate: exDate,
          paymentDate: payDate,
          cashDividendPerShare: cashTotal,
          stockDividendPerShare: stockTotal,
          fiscalYearPeriod: r.year || undefined,
          announcementDate: r.AnnouncementDate || undefined,
          totalDistributionShares: r.ParticipateDistributionOfTotalShares || undefined,
          rawProviderData: { ...r } as Record<string, unknown>,
        };
      });
  }

  async fetchInstrumentCatalog(): Promise<RawInstrumentInfo[]> {
    const rows = await fetchCatalogDataset<FinMindInstrumentRow>("TaiwanStockInfo");
    return rows.map((r) => ({
      ticker: r.stock_id,
      name: r.stock_name,
      typeRaw: r.type,
      industryCategory: r.industry_category,
      date: r.date,
    }));
  }

  async fetchDelistingHistory(): Promise<RawDelistingRecord[]> {
    const rows = await fetchCatalogDataset<FinMindDelistingRow>("TaiwanStockDelisting");
    return rows.map((r) => ({
      ticker: r.stock_id,
      name: r.stock_name,
      date: r.date,
    }));
  }
}
