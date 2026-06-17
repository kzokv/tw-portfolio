import type { DailyBar } from "@vakwen/domain";
import {
  YahooFinanceIntradayProvider,
  type YahooFinanceIntradayProviderConfig,
} from "./yahooFinanceIntraday.js";
import type { RegularSessionMarketCode } from "../marketRegularSession.js";
import { RateLimitedError } from "../types.js";
import type { IntradayRefreshRequestBudget } from "../intradayRefreshWorker.js";

export type YahooChartCloseProviderConfig = YahooFinanceIntradayProviderConfig & {
  requestBudget?: IntradayRefreshRequestBudget;
};

export class YahooChartCloseProvider {
  readonly providerId = "yahoo-chart-close";
  private readonly intradayProvider: YahooFinanceIntradayProvider;
  private readonly requestBudget: IntradayRefreshRequestBudget | null;

  constructor(config: YahooChartCloseProviderConfig) {
    this.intradayProvider = new YahooFinanceIntradayProvider(config);
    this.requestBudget = config.requestBudget ?? null;
  }

  async fetchCloseOnlyBar(
    ticker: string,
    marketCode: Extract<RegularSessionMarketCode, "TW" | "US">,
    barDate: string,
    _now: Date = new Date(`${barDate}T12:00:00.000Z`),
  ): Promise<DailyBar | null> {
    const budget = await this.requestBudget?.tryConsume(1);
    if (budget && !budget.allowed) {
      throw new RateLimitedError({ msUntilAvailable: budget.retryAfterMs });
    }
    const overlay = await this.intradayProvider.fetchLatestOverlay({
      ticker,
      marketCode,
      now: new Date(`${barDate}T12:00:00.000Z`),
    });
    if (!overlay || overlay.asOfDate !== barDate) return null;
    return {
      ticker: ticker.trim().toUpperCase(),
      barDate,
      open: overlay.price,
      high: overlay.price,
      low: overlay.price,
      close: overlay.price,
      volume: 0,
      quality: "close_only",
      source: this.providerId,
      ingestedAt: new Date().toISOString(),
    };
  }
}
