import { HISTORY_START } from "../types.js";
import type {
  RawDailyBar,
  DividendRecord,
  RawInstrumentInfo,
  RawDelistingRecord,
  MarketDataProvider,
  InstrumentCatalogProvider,
} from "../types.js";
import { RateLimitedError } from "../types.js";
import type { RateLimiter } from "../rateLimiter.js";

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

export interface FinMindMarketDataProviderConfig {
  token: string;
  baseUrl: string;
  rateLimiter: RateLimiter;
}

/**
 * FinMind-backed implementation of `MarketDataProvider` and `InstrumentCatalogProvider`.
 * KZO-163: replaces the legacy `FinMindClient` — accepts an injected rate limiter and base URL,
 * stamps every returned `RawDailyBar`/`DividendRecord` with `sourceId: 'finmind'`, and throws
 * `RateLimitedError` when the limiter denies a request.
 */
export class FinMindMarketDataProvider implements MarketDataProvider, InstrumentCatalogProvider {
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly rateLimiter: RateLimiter;

  constructor(config: FinMindMarketDataProviderConfig) {
    this.token = config.token;
    this.baseUrl = config.baseUrl;
    this.rateLimiter = config.rateLimiter;
  }

  /**
   * KZO-163: conservative recovery delay when FinMind returns HTTP 402 ("rate limit exceeded").
   * FinMind does not include a `Retry-After` header, and our internal sliding-window limiter
   * may disagree with the server's view of consumption (e.g. after a process restart). 60s is a
   * pragmatic bound — long enough to outwait minor drift, short enough that the next worker
   * cycle resumes promptly when capacity returns.
   */
  private static readonly REMOTE_402_RETRY_MS = 60_000;

  private assertCanConsume(): void {
    if (!this.rateLimiter.canConsume(1)) {
      throw new RateLimitedError({ msUntilAvailable: this.rateLimiter.msUntilAvailable(1) });
    }
    this.rateLimiter.consume(1);
  }

  /**
   * KZO-163 HIGH-1 fix: pre-flight check for `n` rate-limit slots so multi-call worker
   * invocations don't starve under one-slot-at-a-time replenishment. The check is for N slots
   * (`canConsume(n)`), not 1 — so when only 1 slot has freed up but N=2 are needed, the worker
   * reschedules with `msUntilAvailable(n)` (waits until N slots are free), not for the next
   * single slot. This breaks the deterministic starvation cycle that motivated the fix.
   *
   * **Residual TOCTOU race (acknowledged):** this method is check-only — it does not consume
   * slots. Per-call `assertCanConsume` consumes 1 each later. Between the check and the per-
   * call consumes, a concurrent in-process caller (another worker invocation, the price route,
   * or any parallel fetch on this provider instance) can consume slots. The worst case is one
   * mid-flight `RateLimitedError` for the racing caller; the next reschedule's `reserveCapacity`
   * correctly waits for N slots, so this does NOT regress to the original starvation pattern.
   *
   * Closing the race fully would require an atomic `consumeOrThrow(n)` with per-invocation
   * lease tracking. That is non-trivial — sharing a `prepaidSlots` counter across callers
   * leaks slots on partial-failure paths and re-introduces the original starvation under
   * concurrent reservation+fetch. Deferred until KZO-170 introduces a second provider class
   * (FX or US) that exercises the multi-provider concurrency more aggressively.
   */
  reserveCapacity(n: number): void {
    if (!this.rateLimiter.canConsume(n)) {
      throw new RateLimitedError({ msUntilAvailable: this.rateLimiter.msUntilAvailable(n) });
    }
  }

  private async fetchDataset<T>(dataset: string, ticker: string, startDate: string = HISTORY_START, endDate?: string): Promise<T[]> {
    const params = new URLSearchParams({
      dataset,
      data_id: ticker,
      start_date: startDate,
      token: this.token,
    });
    if (endDate) {
      params.set("end_date", endDate);
    }

    const res = await fetch(`${this.baseUrl}?${params.toString()}`);
    if (res.status === 402) {
      // KZO-163 MEDIUM-1: surface remote rate-limit as RateLimitedError so workers reschedule
      // and the price route returns 503 + Retry-After (not 404 price_not_found).
      throw new RateLimitedError({ msUntilAvailable: FinMindMarketDataProvider.REMOTE_402_RETRY_MS });
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

  private async fetchCatalogDataset<T>(dataset: string): Promise<T[]> {
    const params = new URLSearchParams({ dataset, token: this.token });

    const res = await fetch(`${this.baseUrl}?${params.toString()}`);
    if (res.status === 402) {
      throw new RateLimitedError({ msUntilAvailable: FinMindMarketDataProvider.REMOTE_402_RETRY_MS });
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

  async fetchBars(ticker: string, startDate?: string, endDate?: string): Promise<RawDailyBar[]> {
    this.assertCanConsume();
    const rows = await this.fetchDataset<FinMindPriceRow>("TaiwanStockPrice", ticker, startDate, endDate);
    return rows.map((r) => ({
      ticker: r.stock_id,
      barDate: r.date,
      open: r.open,
      high: r.max,
      low: r.min,
      close: r.close,
      volume: r.Trading_Volume,
      sourceId: "finmind",
    }));
  }

  async fetchDividends(ticker: string, startDate?: string, endDate?: string): Promise<DividendRecord[]> {
    this.assertCanConsume();
    const rows = await this.fetchDataset<FinMindDividendRow>("TaiwanStockDividend", ticker, startDate, endDate);
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
          sourceId: "finmind",
        };
      });
  }

  async fetchInstrumentCatalog(): Promise<RawInstrumentInfo[]> {
    this.assertCanConsume();
    const rows = await this.fetchCatalogDataset<FinMindInstrumentRow>("TaiwanStockInfo");
    return rows.map((r) => ({
      ticker: r.stock_id,
      name: r.stock_name,
      typeRaw: r.type,
      industryCategory: r.industry_category,
      date: r.date,
    }));
  }

  async fetchDelistingHistory(): Promise<RawDelistingRecord[]> {
    this.assertCanConsume();
    const rows = await this.fetchCatalogDataset<FinMindDelistingRow>("TaiwanStockDelisting");
    return rows.map((r) => ({
      ticker: r.stock_id,
      name: r.stock_name,
      date: r.date,
    }));
  }
}
