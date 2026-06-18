import type { DailyBar } from "@vakwen/domain";
import {
  YahooFinanceIntradayProvider,
  type YahooFinanceIntradayProviderConfig,
} from "./yahooFinanceIntraday.js";
import {
  marketLocalDateFromTimestamp,
  type RegularSessionMarketCode,
} from "../marketRegularSession.js";
import { MARKET_CLOSE_LOCAL_TIME, MARKET_TIMEZONE } from "../tradingCalendar.js";
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
    now: Date = closeFallbackQueryTime(marketCode, barDate),
  ): Promise<DailyBar | null> {
    const budget = await this.requestBudget?.tryConsume(1);
    if (budget && !budget.allowed) {
      throw new RateLimitedError({ msUntilAvailable: budget.retryAfterMs });
    }
    const overlay = await this.intradayProvider.fetchLatestOverlay({
      ticker,
      marketCode,
      now: closeFallbackQueryTime(marketCode, barDate, now),
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

function closeFallbackQueryTime(
  marketCode: Extract<RegularSessionMarketCode, "TW" | "US">,
  barDate: string,
  now?: Date,
): Date {
  if (now && marketLocalDateFromTimestamp(marketCode, now) === barDate) {
    return now;
  }

  const close = MARKET_CLOSE_LOCAL_TIME[marketCode];
  return marketLocalDateTimeToUtc(
    MARKET_TIMEZONE[marketCode],
    barDate,
    close.hour,
    close.minute + 30,
  );
}

function marketLocalDateTimeToUtc(
  timeZone: string,
  date: string,
  hour: number,
  minute: number,
): Date {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const desiredLocalMs = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let candidate = new Date(desiredLocalMs);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).formatToParts(candidate);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const candidateLocalMs = Date.UTC(
      Number(values.year),
      Number(values.month) - 1,
      Number(values.day),
      Number(values.hour),
      Number(values.minute),
      Number(values.second),
      0,
    );
    const offsetMs = candidateLocalMs - candidate.getTime();
    const next = new Date(desiredLocalMs - offsetMs);
    if (next.getTime() === candidate.getTime()) return next;
    candidate = next;
  }

  return candidate;
}
