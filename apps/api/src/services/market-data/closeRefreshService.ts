import type { DailyBar, MarketCode } from "@vakwen/domain";
import type { Persistence } from "../../persistence/types.js";
import { RateLimitedError, type MarketDataProvider, type RawDailyBar } from "./types.js";
import {
  getRegularSessionCloseRefreshDate,
  isRegularSessionMarketCode,
  type RegularSessionClock,
  type RegularSessionMarketCode,
} from "./marketRegularSession.js";
import { quoteSnapshotKey } from "./quoteSnapshotService.js";

export type CloseRefreshStatus = "refreshed" | "current" | "not_eligible" | "missing" | "failed" | "queued";

export interface CloseRefreshPair {
  ticker: string;
  marketCode: MarketCode;
}

export interface CloseRefreshResultItem {
  ticker: string;
  marketCode: MarketCode;
  status: CloseRefreshStatus;
  barDate: string | null;
  source: string | null;
  quality: DailyBar["quality"] | null;
  error?: string;
}

export interface CloseRefreshResult {
  items: CloseRefreshResultItem[];
  summary: Record<CloseRefreshStatus, number>;
}

interface CloseFallbackProviders {
  twseStockDay?: {
    fetchCloseOnlyBar(ticker: string, barDate: string): Promise<DailyBar | null>;
  };
  yahooChartClose?: {
    fetchCloseOnlyBar(
      ticker: string,
      marketCode: Extract<RegularSessionMarketCode, "TW" | "US">,
      barDate: string,
      now?: Date,
    ): Promise<DailyBar | null>;
  };
}

export interface RunCloseRefreshInput {
  pairs: ReadonlyArray<CloseRefreshPair>;
  persistence: Pick<Persistence, "getLatestBarsByTickerMarket">;
  activityPersistence?: Pick<Persistence, "createMarketCalendarActivityEvent">;
  tradingCalendar: RegularSessionClock;
  marketDataProviders: ReadonlyMap<MarketCode, MarketDataProvider>;
  fallbackProviders?: CloseFallbackProviders;
  upsertBars: (bars: DailyBar[], marketCode: MarketCode) => Promise<void>;
  closeRefreshGraceMinutes: number;
  supportedMarkets: ReadonlyArray<MarketCode>;
  now?: Date;
  log?: {
    info: (payload: Record<string, unknown>, message: string) => void;
    warn: (payload: Record<string, unknown>, message: string) => void;
  };
}

export async function runCloseRefresh(input: RunCloseRefreshInput): Promise<CloseRefreshResult> {
  const now = input.now ?? new Date();
  const supportedMarkets = new Set(input.supportedMarkets);
  const pairs = dedupePairs(input.pairs).filter((pair) =>
    isRegularSessionMarketCode(pair.marketCode) && supportedMarkets.has(pair.marketCode));
  const latestBars = await input.persistence.getLatestBarsByTickerMarket(pairs, 1);
  const latestByKey = new Map(latestBars.map((bar) => [quoteSnapshotKey(bar.ticker, bar.marketCode), bar]));

  const items: CloseRefreshResultItem[] = [];
  for (const pair of pairs) {
    const closeDate = await getRegularSessionCloseRefreshDate(
      pair.marketCode,
      input.tradingCalendar,
      now,
      input.closeRefreshGraceMinutes,
    );
    if (!closeDate) {
      const item = buildItem(pair, "not_eligible", null, null, null);
      items.push(item);
      await emitCloseRefreshActivity(input, item);
      continue;
    }

    const latest = latestByKey.get(quoteSnapshotKey(pair.ticker, pair.marketCode));
    if (latest && isCurrentFullBar(latest, closeDate)) {
      const item = buildItem(pair, "current", latest.barDate, latest.source, latest.quality);
      items.push(item);
      await emitCloseRefreshActivity(input, item);
      continue;
    }

    try {
      const bar = await fetchCloseRefreshBar(input, pair, closeDate, now);
      if (!bar) {
        const item = buildItem(pair, "missing", closeDate, null, null);
        items.push(item);
        await emitCloseRefreshActivity(input, item);
        continue;
      }
      await input.upsertBars([bar], pair.marketCode);
      const item = buildItem(pair, "refreshed", bar.barDate, bar.source, bar.quality);
      items.push(item);
      await emitCloseRefreshActivity(input, item);
    } catch (error) {
      if (error instanceof RateLimitedError) throw error;
      input.log?.warn(
        {
          err: error instanceof Error ? error.message : String(error),
          ticker: pair.ticker,
          marketCode: pair.marketCode,
          barDate: closeDate,
        },
        "close_refresh_pair_failed",
      );
      const item = buildItem(
        pair,
        "failed",
        closeDate,
        null,
        null,
        error instanceof Error ? error.message : String(error),
      );
      items.push(item);
      await emitCloseRefreshActivity(input, item);
    }
  }

  const result = { items, summary: summarize(items) };
  input.log?.info(
    {
      pairCount: pairs.length,
      summary: result.summary,
    },
    "close_refresh_completed",
  );
  return result;
}

function isCurrentFullBar(latest: DailyBar, closeDate: string): boolean {
  return latest.barDate > closeDate || (latest.barDate === closeDate && latest.quality === "full_bar");
}

async function fetchCloseRefreshBar(
  input: RunCloseRefreshInput,
  pair: CloseRefreshPair & { marketCode: RegularSessionMarketCode },
  barDate: string,
  now: Date,
): Promise<DailyBar | null> {
  const primary = input.marketDataProviders.get(pair.marketCode);
  if (primary) {
    const rawBars = await primary.fetchBars(pair.ticker, barDate, barDate);
    const primaryBar = selectRawBar(rawBars, barDate, primary.providerId);
    if (primaryBar) return primaryBar;
  }

  if (pair.marketCode === "TW") {
    const twseBar = await input.fallbackProviders?.twseStockDay?.fetchCloseOnlyBar(pair.ticker, barDate);
    if (twseBar) return twseBar;
    return input.fallbackProviders?.yahooChartClose?.fetchCloseOnlyBar(pair.ticker, "TW", barDate, now) ?? null;
  }

  if (pair.marketCode === "US") {
    return input.fallbackProviders?.yahooChartClose?.fetchCloseOnlyBar(pair.ticker, "US", barDate, now) ?? null;
  }

  return null;
}

function selectRawBar(
  rawBars: ReadonlyArray<RawDailyBar>,
  barDate: string,
  providerId: string,
): DailyBar | null {
  const raw = rawBars.find((bar) => bar.barDate === barDate);
  if (!raw) return null;
  return {
    ticker: raw.ticker,
    barDate: raw.barDate,
    open: raw.open,
    high: raw.high,
    low: raw.low,
    close: raw.close,
    volume: raw.volume,
    quality: "full_bar",
    source: raw.sourceId ?? providerId,
    ingestedAt: new Date().toISOString(),
  };
}

function dedupePairs(pairs: ReadonlyArray<CloseRefreshPair>): Array<CloseRefreshPair & { marketCode: RegularSessionMarketCode }> {
  const deduped = new Map<string, CloseRefreshPair & { marketCode: RegularSessionMarketCode }>();
  for (const pair of pairs) {
    if (!isRegularSessionMarketCode(pair.marketCode)) continue;
    deduped.set(quoteSnapshotKey(pair.ticker, pair.marketCode), {
      ticker: pair.ticker,
      marketCode: pair.marketCode,
    });
  }
  return [...deduped.values()];
}

function buildItem(
  pair: CloseRefreshPair,
  status: CloseRefreshStatus,
  barDate: string | null,
  source: string | null,
  quality: DailyBar["quality"] | null,
  error?: string,
): CloseRefreshResultItem {
  return {
    ticker: pair.ticker,
    marketCode: pair.marketCode,
    status,
    barDate,
    source,
    quality,
    ...(error ? { error } : {}),
  };
}

function summarize(items: ReadonlyArray<CloseRefreshResultItem>): Record<CloseRefreshStatus, number> {
  const summary: Record<CloseRefreshStatus, number> = {
    refreshed: 0,
    current: 0,
    not_eligible: 0,
    missing: 0,
    failed: 0,
    queued: 0,
  };
  for (const item of items) {
    summary[item.status] += 1;
  }
  return summary;
}

async function emitCloseRefreshActivity(
  input: RunCloseRefreshInput,
  item: CloseRefreshResultItem,
): Promise<void> {
  if (!input.activityPersistence?.createMarketCalendarActivityEvent) return;
  const resultByStatus: Record<CloseRefreshStatus, "success" | "warning" | "error" | "skipped"> = {
    refreshed: "success",
    current: "skipped",
    not_eligible: "skipped",
    missing: "warning",
    failed: "error",
    queued: "skipped",
  };
  const titleByStatus: Record<CloseRefreshStatus, string> = {
    refreshed: "Close refresh completed",
    current: "Close refresh skipped",
    not_eligible: "Close refresh not eligible",
    missing: "Close refresh missing bar",
    failed: "Close refresh failed",
    queued: "Close refresh queued",
  };
  const eventTypeByStatus: Record<CloseRefreshStatus, string> = {
    refreshed: "close_refresh_refreshed",
    current: "close_refresh_current",
    not_eligible: "close_refresh_not_eligible",
    missing: "close_refresh_missing",
    failed: "close_refresh_failed",
    queued: "close_refresh_queued",
  };
  try {
    await input.activityPersistence.createMarketCalendarActivityEvent({
      marketCode: item.marketCode,
      category: "daily_close",
      result: resultByStatus[item.status],
      sourceKind: activitySourceKindForCloseRefresh(item.source),
      sourceId: item.source,
      eventType: eventTypeByStatus[item.status],
      title: titleByStatus[item.status],
      message: buildCloseRefreshMessage(item),
      ticker: item.ticker,
      dedupeKey: `close-refresh:${item.marketCode}:${item.ticker}:${item.barDate ?? "none"}:${item.status}`,
      detail: {
        barDate: item.barDate,
        source: item.source,
        quality: item.quality,
        ...(item.error ? { error: item.error } : {}),
      },
    });
  } catch (error) {
    input.log?.warn(
      {
        err: error instanceof Error ? error.message : String(error),
        ticker: item.ticker,
        marketCode: item.marketCode,
        status: item.status,
      },
      "close_refresh_activity_emit_failed",
    );
  }
}

function activitySourceKindForCloseRefresh(source: string | null) {
  const normalized = source?.toLowerCase() ?? "";
  if (normalized.includes("twse")) return "twse_close" as const;
  if (normalized.includes("yahoo")) return "yahoo_chart" as const;
  if (normalized.includes("finmind")) return "finmind" as const;
  return "system" as const;
}

function buildCloseRefreshMessage(item: CloseRefreshResultItem): string {
  switch (item.status) {
    case "refreshed":
      return `${item.ticker} close refresh stored ${item.barDate}.`;
    case "current":
      return `${item.ticker} already has a current close for ${item.barDate}.`;
    case "not_eligible":
      return `${item.ticker} close refresh skipped because no eligible settled close date was found.`;
    case "missing":
      return `${item.ticker} close refresh found no bar for ${item.barDate}.`;
    case "failed":
      return `${item.ticker} close refresh failed${item.error ? `: ${item.error}` : "."}`;
    case "queued":
      return `${item.ticker} close refresh queued.`;
  }
}
