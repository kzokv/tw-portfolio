import type { IntradayPriceOverlay, MarketCode } from "@vakwen/domain";
import type { PgBoss } from "pg-boss";
import { getEffectiveTickerPriceFreshnessConfig, type EffectiveTickerPriceFreshnessConfig } from "../appConfig/tickerPriceFreshness.js";
import type { Persistence } from "../../persistence/types.js";
import { createIntradayOverlayCache } from "./intradayOverlayCache.js";
import { enqueueIntradayRefresh } from "./intradayRefreshWorker.js";
import {
  getRegularSessionState,
  isRegularSessionMarketCode,
  type RegularSessionClock,
  type RegularSessionMarketCode,
} from "./marketRegularSession.js";
import { quoteSnapshotKey } from "./quoteSnapshotService.js";

export interface IntradayDemandRefreshLog {
  info: (payload: Record<string, unknown>, message: string) => void;
  warn: (payload: Record<string, unknown>, message: string) => void;
}

export interface IntradayDemandRefreshInput {
  pairs: ReadonlyArray<{ ticker: string; marketCode?: MarketCode }>;
  boss: Pick<PgBoss, "send"> | null;
  persistence: Pick<
    Persistence,
    "getLatestIntradayOverlay" | "getLatestIntradayOverlays" | "setLatestIntradayOverlay" | "deleteLatestIntradayOverlay"
  >;
  tradingCalendar: RegularSessionClock;
  log?: IntradayDemandRefreshLog;
  now?: Date;
  config?: EffectiveTickerPriceFreshnessConfig;
}

export interface IntradayDemandRefreshResult {
  considered: number;
  open: number;
  staleOrMissing: number;
  capped: number;
  enqueued: number;
  queueUnavailable: number;
  failed: number;
}

interface MarketPair {
  ticker: string;
  marketCode: RegularSessionMarketCode;
}

export async function enqueueDemandIntradayRefreshes(
  input: IntradayDemandRefreshInput,
): Promise<IntradayDemandRefreshResult> {
  const now = input.now ?? new Date();
  const config = input.config ?? getEffectiveTickerPriceFreshnessConfig();
  const initialResult: IntradayDemandRefreshResult = {
    considered: 0,
    open: 0,
    staleOrMissing: 0,
    capped: 0,
    enqueued: 0,
    queueUnavailable: 0,
    failed: 0,
  };

  if (!config.intradayEnabled || input.pairs.length === 0) return initialResult;

  const supportedMarkets = new Set<MarketCode>(config.supportedMarkets);
  const dedupedPairs = dedupeRegularSessionPairs(input.pairs)
    .filter((pair) => supportedMarkets.has(pair.marketCode));
  initialResult.considered = dedupedPairs.length;
  if (dedupedPairs.length === 0) return initialResult;

  const openPairs = await filterOpenMarketPairs(dedupedPairs, input.tradingCalendar, now);
  initialResult.open = openPairs.length;
  if (openPairs.length === 0) return initialResult;

  const overlaysByKey = await createIntradayOverlayCache(input.persistence, input.log).getLatestMany(openPairs);
  const refreshIntervalMs = config.intradayRefreshIntervalMinutes * 60_000;
  const stalePairs = openPairs.filter((pair) =>
    isOverlayMissingOrStale(overlaysByKey.get(quoteSnapshotKey(pair.ticker, pair.marketCode)), now, refreshIntervalMs));
  initialResult.staleOrMissing = stalePairs.length;

  const cappedPairs = stalePairs.slice(0, config.maxTickersPerRefreshCycle);
  initialResult.capped = Math.max(0, stalePairs.length - cappedPairs.length);
  if (cappedPairs.length === 0) return initialResult;

  if (!input.boss) {
    initialResult.queueUnavailable = cappedPairs.length;
    input.log?.warn(
      {
        pairCount: cappedPairs.length,
        openPairCount: openPairs.length,
      },
      "intraday_demand_refresh_queue_unavailable",
    );
    return initialResult;
  }

  await Promise.all(cappedPairs.map(async (pair) => {
    try {
      await enqueueIntradayRefresh(input.boss, {
        ticker: pair.ticker,
        marketCode: pair.marketCode,
        requestedAt: now.toISOString(),
      });
      initialResult.enqueued += 1;
    } catch (error) {
      initialResult.failed += 1;
      input.log?.warn(
        {
          err: error instanceof Error ? error.message : String(error),
          ticker: pair.ticker,
          marketCode: pair.marketCode,
        },
        "intraday_demand_refresh_enqueue_failed",
      );
    }
  }));

  input.log?.info(
    {
      considered: initialResult.considered,
      open: initialResult.open,
      staleOrMissing: initialResult.staleOrMissing,
      capped: initialResult.capped,
      enqueued: initialResult.enqueued,
      failed: initialResult.failed,
    },
    "intraday_demand_refresh_enqueue_completed",
  );

  return initialResult;
}

function dedupeRegularSessionPairs(
  pairs: ReadonlyArray<{ ticker: string; marketCode?: MarketCode }>,
): MarketPair[] {
  const deduped = new Map<string, MarketPair>();
  for (const pair of pairs) {
    if (!pair.marketCode || !isRegularSessionMarketCode(pair.marketCode)) continue;
    const key = quoteSnapshotKey(pair.ticker, pair.marketCode);
    deduped.set(key, { ticker: pair.ticker, marketCode: pair.marketCode });
  }
  return [...deduped.values()];
}

async function filterOpenMarketPairs(
  pairs: ReadonlyArray<MarketPair>,
  tradingCalendar: RegularSessionClock,
  now: Date,
): Promise<MarketPair[]> {
  const distinctMarkets = [...new Set(pairs.map((pair) => pair.marketCode))]
    .filter(isRegularSessionMarketCode);
  const sessionEntries = await Promise.all(distinctMarkets.map(async (marketCode) => [
    marketCode,
    await getRegularSessionState(marketCode, tradingCalendar, now),
  ] as const));
  const openMarkets = new Set(sessionEntries
    .filter(([, state]) => state.isOpen)
    .map(([marketCode]) => marketCode));
  return pairs.filter((pair) => openMarkets.has(pair.marketCode));
}

function isOverlayMissingOrStale(
  overlay: IntradayPriceOverlay | undefined,
  now: Date,
  refreshIntervalMs: number,
): boolean {
  if (!overlay) return true;
  const observedAtMs = Date.parse(overlay.observedAt);
  if (!Number.isFinite(observedAtMs)) return true;
  return now.getTime() - observedAtMs >= refreshIntervalMs;
}
