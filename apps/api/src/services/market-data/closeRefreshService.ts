import type { DailyBar, MarketCode } from "@vakwen/domain";
import type { Persistence } from "../../persistence/types.js";
import type { MarketDataProvider, RawDailyBar } from "./types.js";
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
      items.push(buildItem(pair, "not_eligible", null, null, null));
      continue;
    }

    const latest = latestByKey.get(quoteSnapshotKey(pair.ticker, pair.marketCode));
    if (latest && latest.barDate >= closeDate) {
      items.push(buildItem(pair, "current", latest.barDate, latest.source, latest.quality));
      continue;
    }

    try {
      const bar = await fetchCloseRefreshBar(input, pair, closeDate, now);
      if (!bar) {
        items.push(buildItem(pair, "missing", closeDate, null, null));
        continue;
      }
      await input.upsertBars([bar], pair.marketCode);
      items.push(buildItem(pair, "refreshed", bar.barDate, bar.source, bar.quality));
    } catch (error) {
      input.log?.warn(
        {
          err: error instanceof Error ? error.message : String(error),
          ticker: pair.ticker,
          marketCode: pair.marketCode,
          barDate: closeDate,
        },
        "close_refresh_pair_failed",
      );
      items.push(buildItem(
        pair,
        "failed",
        closeDate,
        null,
        null,
        error instanceof Error ? error.message : String(error),
      ));
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
