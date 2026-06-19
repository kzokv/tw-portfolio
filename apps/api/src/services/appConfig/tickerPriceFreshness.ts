import {
  MARKET_CODES,
  type AppConfigDto,
  type MarketCode,
  type TickerPriceFreshnessAppConfigDto,
  type TickerPriceFreshnessYahooChartInterval,
  type TickerPriceFreshnessYahooChartRange,
} from "@vakwen/shared-types";
import { getAppConfigCacheEntry } from "./cache.js";

export const TICKER_PRICE_FRESHNESS_YAHOO_CHART_RANGES = ["1d", "5d"] as const satisfies readonly TickerPriceFreshnessYahooChartRange[];
export const TICKER_PRICE_FRESHNESS_YAHOO_CHART_INTERVALS = ["1m", "2m", "5m", "15m"] as const satisfies readonly TickerPriceFreshnessYahooChartInterval[];

export interface TickerPriceFreshnessRowFields {
  tickerPriceCloseRefreshGraceMinutes?: number | null;
  tickerPriceIntradayEnabled?: boolean | null;
  tickerPriceIntradayRefreshIntervalMinutes?: number | null;
  tickerPriceIntradayFreshnessToleranceMinutes?: number | null;
  tickerPriceYahooChartRequestLimitPerMinute?: number | null;
  tickerPriceQueueConcurrency?: number | null;
  tickerPriceMaxTickersPerRefreshCycle?: number | null;
  tickerPriceSupportedMarkets?: MarketCode[] | null;
  tickerPriceRegularSessionOnly?: boolean | null;
  tickerPriceYahooChartRange?: TickerPriceFreshnessYahooChartRange | null;
  tickerPriceYahooChartInterval?: TickerPriceFreshnessYahooChartInterval | null;
  tickerPriceRefreshCloseRateLimitWindowMs?: number | null;
  tickerPriceRefreshCloseRateLimitMax?: number | null;
  tickerPriceSyncTickerCap?: number | null;
  tickerPriceActivityDetailedRetentionDays?: number | null;
  tickerPriceActivitySummaryRetentionDays?: number | null;
  tickerPriceCalendarHistoryRetentionDays?: number | null;
}

export interface TickerPriceFreshnessDefaults {
  closeRefreshGraceMinutes: number;
  intradayEnabled: boolean;
  intradayRefreshIntervalMinutes: number;
  yahooChartRequestLimitPerMinute: number;
  queueConcurrency: number;
  maxTickersPerRefreshCycle: number;
  supportedMarkets: MarketCode[];
  regularSessionOnly: boolean;
  yahooChartRange: TickerPriceFreshnessYahooChartRange;
  yahooChartInterval: TickerPriceFreshnessYahooChartInterval;
  refreshCloseRateLimitWindowMs: number;
  refreshCloseRateLimitMax: number;
  syncTickerCap: number;
  activityDetailedRetentionDays: number;
  activitySummaryRetentionDays: number;
  calendarHistoryRetentionDays: number;
}

export const DEFAULT_TICKER_PRICE_FRESHNESS_CONFIG: TickerPriceFreshnessDefaults = {
  closeRefreshGraceMinutes: 180,
  intradayEnabled: true,
  intradayRefreshIntervalMinutes: 5,
  yahooChartRequestLimitPerMinute: 120,
  queueConcurrency: 4,
  maxTickersPerRefreshCycle: 100,
  supportedMarkets: [...MARKET_CODES],
  regularSessionOnly: true,
  yahooChartRange: "5d",
  yahooChartInterval: "1m",
  refreshCloseRateLimitWindowMs: 60_000,
  refreshCloseRateLimitMax: 10,
  syncTickerCap: 25,
  activityDetailedRetentionDays: 7,
  activitySummaryRetentionDays: 90,
  calendarHistoryRetentionDays: 730,
};

export function resolveTickerPriceFreshnessConfig(
  row: TickerPriceFreshnessRowFields,
  bounds: AppConfigDto["bounds"],
): TickerPriceFreshnessAppConfigDto {
  const effectiveIntradayRefreshIntervalMinutes =
    row.tickerPriceIntradayRefreshIntervalMinutes ?? DEFAULT_TICKER_PRICE_FRESHNESS_CONFIG.intradayRefreshIntervalMinutes;
  const effectiveIntradayFreshnessToleranceMinutes =
    row.tickerPriceIntradayFreshnessToleranceMinutes
    ?? Math.max(effectiveIntradayRefreshIntervalMinutes * 2, 20);

  return {
    closeRefreshGraceMinutes: row.tickerPriceCloseRefreshGraceMinutes ?? null,
    effectiveCloseRefreshGraceMinutes:
      row.tickerPriceCloseRefreshGraceMinutes ?? DEFAULT_TICKER_PRICE_FRESHNESS_CONFIG.closeRefreshGraceMinutes,
    intradayEnabled: row.tickerPriceIntradayEnabled ?? null,
    effectiveIntradayEnabled:
      row.tickerPriceIntradayEnabled ?? DEFAULT_TICKER_PRICE_FRESHNESS_CONFIG.intradayEnabled,
    intradayRefreshIntervalMinutes: row.tickerPriceIntradayRefreshIntervalMinutes ?? null,
    effectiveIntradayRefreshIntervalMinutes,
    intradayFreshnessToleranceMinutes: row.tickerPriceIntradayFreshnessToleranceMinutes ?? null,
    effectiveIntradayFreshnessToleranceMinutes,
    yahooChartRequestLimitPerMinute: row.tickerPriceYahooChartRequestLimitPerMinute ?? null,
    effectiveYahooChartRequestLimitPerMinute:
      row.tickerPriceYahooChartRequestLimitPerMinute
      ?? DEFAULT_TICKER_PRICE_FRESHNESS_CONFIG.yahooChartRequestLimitPerMinute,
    queueConcurrency: row.tickerPriceQueueConcurrency ?? null,
    effectiveQueueConcurrency:
      row.tickerPriceQueueConcurrency ?? DEFAULT_TICKER_PRICE_FRESHNESS_CONFIG.queueConcurrency,
    maxTickersPerRefreshCycle: row.tickerPriceMaxTickersPerRefreshCycle ?? null,
    effectiveMaxTickersPerRefreshCycle:
      row.tickerPriceMaxTickersPerRefreshCycle ?? DEFAULT_TICKER_PRICE_FRESHNESS_CONFIG.maxTickersPerRefreshCycle,
    supportedMarkets: row.tickerPriceSupportedMarkets ?? null,
    effectiveSupportedMarkets:
      row.tickerPriceSupportedMarkets ?? DEFAULT_TICKER_PRICE_FRESHNESS_CONFIG.supportedMarkets,
    regularSessionOnly: row.tickerPriceRegularSessionOnly ?? null,
    effectiveRegularSessionOnly:
      row.tickerPriceRegularSessionOnly ?? DEFAULT_TICKER_PRICE_FRESHNESS_CONFIG.regularSessionOnly,
    yahooChartRange: row.tickerPriceYahooChartRange ?? null,
    effectiveYahooChartRange:
      row.tickerPriceYahooChartRange ?? DEFAULT_TICKER_PRICE_FRESHNESS_CONFIG.yahooChartRange,
    yahooChartInterval: row.tickerPriceYahooChartInterval ?? null,
    effectiveYahooChartInterval:
      row.tickerPriceYahooChartInterval ?? DEFAULT_TICKER_PRICE_FRESHNESS_CONFIG.yahooChartInterval,
    refreshCloseRateLimitWindowMs: row.tickerPriceRefreshCloseRateLimitWindowMs ?? null,
    effectiveRefreshCloseRateLimitWindowMs:
      row.tickerPriceRefreshCloseRateLimitWindowMs
      ?? DEFAULT_TICKER_PRICE_FRESHNESS_CONFIG.refreshCloseRateLimitWindowMs,
    refreshCloseRateLimitMax: row.tickerPriceRefreshCloseRateLimitMax ?? null,
    effectiveRefreshCloseRateLimitMax:
      row.tickerPriceRefreshCloseRateLimitMax ?? DEFAULT_TICKER_PRICE_FRESHNESS_CONFIG.refreshCloseRateLimitMax,
    syncTickerCap: row.tickerPriceSyncTickerCap ?? null,
    effectiveSyncTickerCap:
      row.tickerPriceSyncTickerCap ?? DEFAULT_TICKER_PRICE_FRESHNESS_CONFIG.syncTickerCap,
    activityDetailedRetentionDays: row.tickerPriceActivityDetailedRetentionDays ?? null,
    effectiveActivityDetailedRetentionDays:
      row.tickerPriceActivityDetailedRetentionDays ?? DEFAULT_TICKER_PRICE_FRESHNESS_CONFIG.activityDetailedRetentionDays,
    activitySummaryRetentionDays: row.tickerPriceActivitySummaryRetentionDays ?? null,
    effectiveActivitySummaryRetentionDays:
      row.tickerPriceActivitySummaryRetentionDays ?? DEFAULT_TICKER_PRICE_FRESHNESS_CONFIG.activitySummaryRetentionDays,
    calendarHistoryRetentionDays: row.tickerPriceCalendarHistoryRetentionDays ?? null,
    effectiveCalendarHistoryRetentionDays:
      row.tickerPriceCalendarHistoryRetentionDays ?? DEFAULT_TICKER_PRICE_FRESHNESS_CONFIG.calendarHistoryRetentionDays,
    options: {
      supportedMarkets: [...MARKET_CODES],
      yahooChartRanges: [...TICKER_PRICE_FRESHNESS_YAHOO_CHART_RANGES],
      yahooChartIntervals: [...TICKER_PRICE_FRESHNESS_YAHOO_CHART_INTERVALS],
    },
    bounds: {
      closeRefreshGraceMinutes: bounds.tickerPriceCloseRefreshGraceMinutes,
      intradayRefreshIntervalMinutes: bounds.tickerPriceIntradayRefreshIntervalMinutes,
      intradayFreshnessToleranceMinutes: bounds.tickerPriceIntradayFreshnessToleranceMinutes,
      yahooChartRequestLimitPerMinute: bounds.tickerPriceYahooChartRequestLimitPerMinute,
      queueConcurrency: bounds.tickerPriceQueueConcurrency,
      maxTickersPerRefreshCycle: bounds.tickerPriceMaxTickersPerRefreshCycle,
      refreshCloseRateLimitWindowMs: bounds.tickerPriceRefreshCloseRateLimitWindowMs,
      refreshCloseRateLimitMax: bounds.tickerPriceRefreshCloseRateLimitMax,
      syncTickerCap: bounds.tickerPriceSyncTickerCap,
      activityDetailedRetentionDays: bounds.tickerPriceActivityDetailedRetentionDays,
      activitySummaryRetentionDays: bounds.tickerPriceActivitySummaryRetentionDays,
      calendarHistoryRetentionDays: bounds.tickerPriceCalendarHistoryRetentionDays,
    },
  };
}

export interface EffectiveTickerPriceFreshnessConfig {
  closeRefreshGraceMinutes: number;
  intradayEnabled: boolean;
  intradayRefreshIntervalMinutes: number;
  intradayFreshnessToleranceMinutes: number;
  yahooChartRequestLimitPerMinute: number;
  queueConcurrency: number;
  maxTickersPerRefreshCycle: number;
  supportedMarkets: MarketCode[];
  regularSessionOnly: boolean;
  yahooChartRange: TickerPriceFreshnessYahooChartRange;
  yahooChartInterval: TickerPriceFreshnessYahooChartInterval;
  refreshCloseRateLimitWindowMs: number;
  refreshCloseRateLimitMax: number;
  syncTickerCap: number;
  activityDetailedRetentionDays: number;
  activitySummaryRetentionDays: number;
  calendarHistoryRetentionDays: number;
}

export function getEffectiveTickerPriceFreshnessConfig(): EffectiveTickerPriceFreshnessConfig {
  const row = getAppConfigCacheEntry();
  const intradayRefreshIntervalMinutes =
    row?.tickerPriceIntradayRefreshIntervalMinutes ?? DEFAULT_TICKER_PRICE_FRESHNESS_CONFIG.intradayRefreshIntervalMinutes;
  return {
    closeRefreshGraceMinutes:
      row?.tickerPriceCloseRefreshGraceMinutes ?? DEFAULT_TICKER_PRICE_FRESHNESS_CONFIG.closeRefreshGraceMinutes,
    intradayEnabled:
      row?.tickerPriceIntradayEnabled ?? DEFAULT_TICKER_PRICE_FRESHNESS_CONFIG.intradayEnabled,
    intradayRefreshIntervalMinutes,
    intradayFreshnessToleranceMinutes:
      row?.tickerPriceIntradayFreshnessToleranceMinutes
      ?? Math.max(intradayRefreshIntervalMinutes * 2, 20),
    yahooChartRequestLimitPerMinute:
      row?.tickerPriceYahooChartRequestLimitPerMinute
      ?? DEFAULT_TICKER_PRICE_FRESHNESS_CONFIG.yahooChartRequestLimitPerMinute,
    queueConcurrency:
      row?.tickerPriceQueueConcurrency ?? DEFAULT_TICKER_PRICE_FRESHNESS_CONFIG.queueConcurrency,
    maxTickersPerRefreshCycle:
      row?.tickerPriceMaxTickersPerRefreshCycle ?? DEFAULT_TICKER_PRICE_FRESHNESS_CONFIG.maxTickersPerRefreshCycle,
    supportedMarkets:
      row?.tickerPriceSupportedMarkets ?? [...DEFAULT_TICKER_PRICE_FRESHNESS_CONFIG.supportedMarkets],
    regularSessionOnly:
      row?.tickerPriceRegularSessionOnly ?? DEFAULT_TICKER_PRICE_FRESHNESS_CONFIG.regularSessionOnly,
    yahooChartRange:
      row?.tickerPriceYahooChartRange ?? DEFAULT_TICKER_PRICE_FRESHNESS_CONFIG.yahooChartRange,
    yahooChartInterval:
      row?.tickerPriceYahooChartInterval ?? DEFAULT_TICKER_PRICE_FRESHNESS_CONFIG.yahooChartInterval,
    refreshCloseRateLimitWindowMs:
      row?.tickerPriceRefreshCloseRateLimitWindowMs
      ?? DEFAULT_TICKER_PRICE_FRESHNESS_CONFIG.refreshCloseRateLimitWindowMs,
    refreshCloseRateLimitMax:
      row?.tickerPriceRefreshCloseRateLimitMax ?? DEFAULT_TICKER_PRICE_FRESHNESS_CONFIG.refreshCloseRateLimitMax,
    syncTickerCap:
      row?.tickerPriceSyncTickerCap ?? DEFAULT_TICKER_PRICE_FRESHNESS_CONFIG.syncTickerCap,
    activityDetailedRetentionDays:
      row?.tickerPriceActivityDetailedRetentionDays ?? DEFAULT_TICKER_PRICE_FRESHNESS_CONFIG.activityDetailedRetentionDays,
    activitySummaryRetentionDays:
      row?.tickerPriceActivitySummaryRetentionDays ?? DEFAULT_TICKER_PRICE_FRESHNESS_CONFIG.activitySummaryRetentionDays,
    calendarHistoryRetentionDays:
      row?.tickerPriceCalendarHistoryRetentionDays ?? DEFAULT_TICKER_PRICE_FRESHNESS_CONFIG.calendarHistoryRetentionDays,
  };
}
