import type { DailyBar } from "@vakwen/domain";

interface TwseStockDayRow {
  date: string;
  close: string;
}

interface TwseStockDayResponse {
  stat?: string;
  data?: string[][];
}

export interface TwseStockDayCloseProviderConfig {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

const DEFAULT_BASE_URL = "https://www.twse.com.tw/exchangeReport/STOCK_DAY";

export class TwseStockDayCloseProvider {
  readonly providerId = "twse-stock-day-close";
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: TwseStockDayCloseProviderConfig = {}) {
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async fetchCloseOnlyBar(ticker: string, barDate: string): Promise<DailyBar | null> {
    const monthDate = `${barDate.slice(0, 4)}${barDate.slice(5, 7)}01`;
    const url = new URL(this.baseUrl);
    url.searchParams.set("response", "json");
    url.searchParams.set("date", monthDate);
    url.searchParams.set("stockNo", ticker.trim().toUpperCase());
    const response = await this.fetchImpl(url, {
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`twse_stock_day_close_http_${response.status}`);
    }
    const payload = await response.json() as TwseStockDayResponse;
    if (payload.stat && !payload.stat.startsWith("OK")) return null;
    const row = parseTwseStockDayRow(payload.data ?? [], barDate);
    if (!row) return null;
    const close = Number(row.close.replaceAll(",", ""));
    if (!Number.isFinite(close)) return null;
    return {
      ticker: ticker.trim().toUpperCase(),
      barDate,
      open: close,
      high: close,
      low: close,
      close,
      volume: 0,
      quality: "close_only",
      source: this.providerId,
      ingestedAt: new Date().toISOString(),
    };
  }
}

export function parseTwseStockDayRow(rows: ReadonlyArray<ReadonlyArray<string>>, targetDate: string): TwseStockDayRow | null {
  const [targetYear, targetMonth, targetDay] = targetDate.split("-").map(Number);
  const rocYear = targetYear - 1911;
  for (const row of rows) {
    const rawDate = row[0]?.trim();
    const close = row[6]?.trim();
    if (!rawDate || !close || close === "--") continue;
    const match = rawDate.match(/^(\d{2,3})\/(\d{2})\/(\d{2})$/);
    if (!match) continue;
    const [, yy, mm, dd] = match;
    if (Number(yy) !== rocYear || Number(mm) !== targetMonth || Number(dd) !== targetDay) continue;
    return {
      date: `${String(Number(yy) + 1911).padStart(4, "0")}-${mm}-${dd}`,
      close,
    };
  }
  return null;
}
