import type { DailyBar, IntradayPriceOverlay, MarketCode, QuoteSnapshot } from "@vakwen/domain";
import type {
  PriceStateBasisDto,
  PriceStateDto,
  PriceStateSourceKindDto,
} from "@vakwen/shared-types";
import { APP_CONFIG_BOUNDS } from "../appConfig/bounds.js";
import { getAppConfigCacheEntry } from "../appConfig/cache.js";
import { resolveTickerPriceFreshnessConfig } from "../appConfig/tickerPriceFreshness.js";
import type { Persistence } from "../../persistence/types.js";
import { createIntradayOverlayCache } from "./intradayOverlayCache.js";
import {
  getRegularSessionState,
  isRegularSessionMarketCode,
  type RegularSessionState,
} from "./marketRegularSession.js";
import type { TradingCalendarCache } from "./tradingCalendar.js";

export interface QuoteSnapshotPair {
  ticker: string;
  marketCode?: MarketCode;
}

export interface ResolvedQuoteSnapshot extends QuoteSnapshot {
  priceState: PriceStateDto;
  dailyCompatibleClose: number;
}

export interface ResolveQuoteSnapshotsOptions {
  mode?: "daily_only" | "displayed";
  now?: Date;
  tradingCalendar?: Pick<TradingCalendarCache, "isTradingDay">;
  heldPairs?: ReadonlySet<string>;
}

type SnapshotBar = DailyBar & { marketCode?: MarketCode };

const DEFAULT_NOW = () => new Date();

export function quoteSnapshotKey(ticker: string, marketCode?: MarketCode): string {
  return marketCode ? `${ticker}:${marketCode}` : ticker;
}

export function buildMissingPriceState(
  marketCode?: MarketCode,
  input: {
    marketState?: PriceStateDto["marketState"];
    marketTimeZone?: string | null;
  } = {},
): PriceStateDto {
  return {
    basis: "missing",
    chipState: "missing",
    marketState: input.marketState ?? "closed",
    source: null,
    sourceKind: "missing",
    asOfDate: null,
    asOfTimestamp: null,
    observedAt: null,
    delaySeconds: null,
    marketTimeZone: input.marketTimeZone ?? null,
    quality: null,
  };
}

export async function resolveQuoteSnapshots(
  pairs: ReadonlyArray<QuoteSnapshotPair>,
  persistence: Persistence,
  settledByMarket: ReadonlyMap<MarketCode, string>,
  options: ResolveQuoteSnapshotsOptions = {},
): Promise<Record<string, ResolvedQuoteSnapshot | null>> {
  if (pairs.length === 0) return {};

  const now = options.now ?? DEFAULT_NOW();
  const marketPairs = new Map<string, { ticker: string; marketCode: MarketCode }>();
  const legacyTickers = new Set<string>();
  const marketsByTicker = new Map<string, Set<MarketCode>>();
  for (const pair of pairs) {
    if (pair.marketCode) {
      marketPairs.set(quoteSnapshotKey(pair.ticker, pair.marketCode), {
        ticker: pair.ticker,
        marketCode: pair.marketCode,
      });
      const markets = marketsByTicker.get(pair.ticker) ?? new Set<MarketCode>();
      markets.add(pair.marketCode);
      marketsByTicker.set(pair.ticker, markets);
    } else {
      legacyTickers.add(pair.ticker);
    }
  }

  const displayContext = options.mode === "displayed"
    ? await buildDisplayContext([...marketPairs.values()], persistence, options, now)
    : null;

  const [marketBars, legacyBars] = await Promise.all([
    persistence.getLatestBarsByTickerMarket([...marketPairs.values()], 2),
    legacyTickers.size > 0 ? persistence.getLatestBars([...legacyTickers], 2) : Promise.resolve([]),
  ]);

  const grouped = new Map<string, SnapshotBar[]>();
  for (const bar of marketBars) {
    const key = quoteSnapshotKey(bar.ticker, bar.marketCode);
    const list = grouped.get(key) ?? [];
    list.push(bar);
    grouped.set(key, list);
  }
  for (const bar of legacyBars) {
    const key = quoteSnapshotKey(bar.ticker);
    const list = grouped.get(key) ?? [];
    list.push(bar);
    grouped.set(key, list);
  }

  const result: Record<string, ResolvedQuoteSnapshot | null> = {};

  for (const pair of pairs) {
    const key = quoteSnapshotKey(pair.ticker, pair.marketCode);
    const tickerBars = grouped.get(key);
    if (!tickerBars || tickerBars.length === 0) {
      result[key] = null;
      if (shouldEmitBareTickerAlias(pair, marketsByTicker)) {
        result[pair.ticker] = null;
      }
      continue;
    }

    const latest = tickerBars[0] as SnapshotBar;
    const previous = tickerBars.length >= 2 ? tickerBars[1] as SnapshotBar : null;
    const resolved = resolveSnapshotForPair({
      pair,
      latest,
      previous,
      settledByMarket,
      displayContext,
      now,
    });
    result[key] = resolved;
    if (shouldEmitBareTickerAlias(pair, marketsByTicker)) {
      result[pair.ticker] = resolved;
    }
  }

  return result;
}

interface DisplayContext {
  overlaysByKey: Map<string, IntradayPriceOverlay>;
  sessionByMarket: Map<MarketCode, RegularSessionState>;
  freshnessToleranceSeconds: number;
  regularSessionOnly: boolean;
  supportedMarkets: Set<MarketCode>;
  heldPairs: ReadonlySet<string> | null;
}

async function buildDisplayContext(
  pairs: ReadonlyArray<{ ticker: string; marketCode: MarketCode }>,
  persistence: Persistence,
  options: ResolveQuoteSnapshotsOptions,
  now: Date,
): Promise<DisplayContext | null> {
  if (!options.tradingCalendar || pairs.length === 0) return null;

  const appConfig = getAppConfigCacheEntry();
  const freshnessConfig = resolveTickerPriceFreshnessConfig(
    appConfig ?? {},
    APP_CONFIG_BOUNDS,
  );
  if (!freshnessConfig.effectiveIntradayEnabled) return null;

  const regularSessionPairs = pairs.filter((pair) => isRegularSessionMarketCode(pair.marketCode));
  if (regularSessionPairs.length === 0) return null;

  const distinctMarkets = [...new Set(regularSessionPairs.map((pair) => pair.marketCode))]
    .filter(isRegularSessionMarketCode);
  const [overlaysByKey, sessionEntries] = await Promise.all([
    createIntradayOverlayCache(persistence).getLatestMany(regularSessionPairs),
    Promise.all(distinctMarkets.map(async (marketCode) => [
      marketCode,
      await getRegularSessionState(marketCode, options.tradingCalendar!, now),
    ] as const)),
  ]);

  return {
    overlaysByKey,
    sessionByMarket: new Map(sessionEntries),
    freshnessToleranceSeconds: freshnessConfig.effectiveIntradayFreshnessToleranceMinutes * 60,
    regularSessionOnly: freshnessConfig.effectiveRegularSessionOnly,
    supportedMarkets: new Set(freshnessConfig.effectiveSupportedMarkets),
    heldPairs: options.heldPairs ?? null,
  };
}

function resolveSnapshotForPair(input: {
  pair: QuoteSnapshotPair;
  latest: SnapshotBar;
  previous: SnapshotBar | null;
  settledByMarket: ReadonlyMap<MarketCode, string>;
  displayContext: DisplayContext | null;
  now: Date;
}): ResolvedQuoteSnapshot {
  const { pair, latest, previous, settledByMarket, displayContext, now } = input;
  const key = quoteSnapshotKey(pair.ticker, pair.marketCode);
  const previousClose = previous?.close ?? null;
  const dailySnapshot = buildDailySnapshot({
    pair,
    latest,
    previousClose,
    settledByMarket,
    displayContext,
  });

  if (!pair.marketCode || !displayContext) return dailySnapshot;

  if (!displayContext.supportedMarkets.has(pair.marketCode)) return dailySnapshot;
  if (displayContext.heldPairs && !displayContext.heldPairs.has(key)) return dailySnapshot;

  const session = displayContext.sessionByMarket.get(pair.marketCode);
  if (!session) return dailySnapshot;
  // Cached overlays are only display-current while the regular session is open.
  if (!session.isOpen) return dailySnapshot;
  if (displayContext.regularSessionOnly && !session.isOpen) return dailySnapshot;

  const overlay = displayContext.overlaysByKey.get(key);
  if (!overlay || overlay.asOfDate !== session.localDate) {
    return {
      ...dailySnapshot,
      priceState: buildOpenPreviousCloseState(latest, pair.marketCode, session),
    };
  }

  const overlayPreviousClose = overlay.previousClose ?? previousClose;
  const change = overlayPreviousClose === null || overlayPreviousClose === 0
    ? null
    : overlay.price - overlayPreviousClose;
  const changePercent = overlayPreviousClose === null || overlayPreviousClose === 0
    ? null
    : (change! / overlayPreviousClose) * 100;
  const delaySeconds = Math.max(0, Math.floor((now.getTime() - Date.parse(overlay.asOfTimestamp)) / 1000));
  const basis: PriceStateBasisDto = delaySeconds <= displayContext.freshnessToleranceSeconds
    ? "intraday"
    : "delayed_intraday";

  return {
    ticker: pair.ticker,
    ...(pair.marketCode ? { marketCode: pair.marketCode } : {}),
    close: overlay.price,
    previousClose: overlayPreviousClose,
    change,
    changePercent,
    asOf: overlay.asOfTimestamp,
    source: overlay.source,
    isProvisional: false,
    dailyCompatibleClose: latest.close,
    priceState: {
      basis,
      chipState: basis === "intraday" ? "open_fresh" : "open_delayed",
      marketState: "open",
      source: overlay.source,
      sourceKind: overlay.sourceKind,
      asOfDate: overlay.asOfDate,
      asOfTimestamp: overlay.asOfTimestamp,
      observedAt: overlay.observedAt,
      delaySeconds,
      marketTimeZone: session.marketTimeZone,
      quality: null,
    },
  };
}

function buildDailySnapshot(input: {
  pair: QuoteSnapshotPair;
  latest: SnapshotBar;
  previousClose: number | null;
  settledByMarket: ReadonlyMap<MarketCode, string>;
  displayContext: DisplayContext | null;
}): ResolvedQuoteSnapshot {
  const { pair, latest, previousClose, settledByMarket, displayContext } = input;
  const change = previousClose !== null && previousClose !== 0 ? latest.close - previousClose : null;
  const changePercent = previousClose !== null && previousClose !== 0
    ? (change! / previousClose) * 100
    : null;
  const session = pair.marketCode ? displayContext?.sessionByMarket.get(pair.marketCode) : undefined;

  return {
    ticker: pair.ticker,
    ...(pair.marketCode ? { marketCode: pair.marketCode } : {}),
    close: latest.close,
    previousClose,
    change,
    changePercent,
    asOf: latest.barDate,
    source: latest.source,
    isProvisional: computeIsProvisional(latest.barDate, pair.marketCode, settledByMarket),
    dailyCompatibleClose: latest.close,
    priceState: buildDailyPriceState(latest, pair.marketCode, settledByMarket, session),
  };
}

function buildDailyPriceState(
  latest: SnapshotBar,
  marketCode: MarketCode | undefined,
  settledByMarket: ReadonlyMap<MarketCode, string>,
  session: RegularSessionState | undefined,
): PriceStateDto {
  const settled = marketCode ? settledByMarket.get(marketCode) ?? null : null;
  const marketState: PriceStateDto["marketState"] = session?.isOpen ? "open" : "closed";
  const marketTimeZone = session?.marketTimeZone ?? null;
  const sourceKind = mapDailySourceKind(latest.source);

  let basis: PriceStateBasisDto = "today_close";
  let chipState: PriceStateDto["chipState"] = "closed";

  if (marketState === "open") {
    basis = "previous_close";
    chipState = "open_previous_close";
  } else if (settled && latest.barDate < settled) {
    basis = session?.isTradingDay && session.localDate === settled ? "pending_today_close" : "stale_close";
    chipState = basis === "stale_close" ? "stale" : "closed";
  }

  return {
    basis,
    chipState,
    marketState,
    source: latest.source,
    sourceKind,
    asOfDate: latest.barDate,
    asOfTimestamp: null,
    observedAt: latest.ingestedAt,
    delaySeconds: null,
    marketTimeZone,
    quality: latest.quality,
  };
}

function buildOpenPreviousCloseState(
  latest: SnapshotBar,
  marketCode: MarketCode,
  session: RegularSessionState,
): PriceStateDto {
  return {
    basis: "previous_close",
    chipState: "open_previous_close",
    marketState: "open",
    source: latest.source,
    sourceKind: mapDailySourceKind(latest.source),
    asOfDate: latest.barDate,
    asOfTimestamp: null,
    observedAt: latest.ingestedAt,
    delaySeconds: null,
    marketTimeZone: session.marketTimeZone,
    quality: latest.quality,
  };
}

function mapDailySourceKind(source: string | null | undefined): PriceStateSourceKindDto {
  if (source === "twse-stock-day-close") return "twse_stock_day_close";
  if (source === "yahoo-chart-close") return "yahoo_chart_close";
  return source ? "primary_daily" : "missing";
}

function shouldEmitBareTickerAlias(
  pair: QuoteSnapshotPair,
  marketsByTicker: ReadonlyMap<string, ReadonlySet<MarketCode>>,
): boolean {
  if (!pair.marketCode) return false;
  return marketsByTicker.get(pair.ticker)?.size === 1;
}

function computeIsProvisional(
  barDate: string,
  marketCode: MarketCode | undefined,
  settledByMarket: ReadonlyMap<MarketCode, string>,
): boolean {
  if (!marketCode) return false;
  const settled = settledByMarket.get(marketCode);
  if (!settled) return false;
  return barDate < settled;
}

export function isCurrentPriceState(priceState: PriceStateDto): boolean {
  return priceState.basis === "intraday" || priceState.basis === "today_close";
}

export function isIntradayPriceState(priceState: PriceStateDto): boolean {
  return priceState.basis === "intraday" || priceState.basis === "delayed_intraday";
}
