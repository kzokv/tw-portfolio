import type { DailyBar, IntradayPriceOverlay, MarketCode, QuoteSnapshot } from "@vakwen/domain";
import type {
  PriceStateBasisDto,
  PriceStateDto,
  PriceStateSourceKindDto,
} from "@vakwen/shared-types";
import { APP_CONFIG_BOUNDS } from "../appConfig/bounds.js";
import { getAppConfigCacheEntry } from "../appConfig/cache.js";
import { resolveTickerPriceFreshnessConfig } from "../appConfig/tickerPriceFreshness.js";
import type { Persistence, QuoteFallbackPolicyWithSnapshotRecord } from "../../persistence/types.js";
import { createIntradayOverlayCache } from "./intradayOverlayCache.js";
import {
  getPreviousRegularSessionTradingDate,
  getRegularSessionState,
  isRegularSessionMarketCode,
  type RegularSessionClock,
  type RegularSessionState,
} from "./marketRegularSession.js";

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
  tradingCalendar?: RegularSessionClock;
  heldPairs?: ReadonlySet<string>;
  refreshCadenceMinutes?: number | null;
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
    marketStateReason?: PriceStateDto["marketStateReason"];
    marketTimeZone?: string | null;
    marketLocalDate?: string | null;
    calendarStatus?: PriceStateDto["calendarStatus"] | null;
  } = {},
): PriceStateDto {
  return {
    basis: "missing",
    chipState: "missing",
    marketState: input.marketState ?? "closed",
    marketStateReason: input.marketStateReason ?? "market_closed",
    source: null,
    sourceKind: "missing",
    asOfDate: null,
    asOfTimestamp: null,
    observedAt: null,
    delaySeconds: null,
    marketTimeZone: input.marketTimeZone ?? null,
    quality: null,
    marketLocalDate: input.marketLocalDate ?? null,
    calendarStatus: input.calendarStatus ?? null,
    refreshCadenceMinutes: null,
    latestIntradayAttempt: null,
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
      const fallbackContext = getQuoteFallbackContext(pair, displayContext);
      const fallbackSnapshot = fallbackContext
        ? buildQuoteFallbackSnapshot({
          pair,
          policy: fallbackContext.policy,
          session: fallbackContext.session,
          settledByMarket,
          refreshCadenceMinutes: displayContext?.refreshCadenceMinutes ?? null,
        })
        : null;
      result[key] = fallbackSnapshot;
      if (shouldEmitBareTickerAlias(pair, marketsByTicker)) {
        result[pair.ticker] = fallbackSnapshot;
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
  quoteFallbackPoliciesByKey: Map<string, QuoteFallbackPolicyWithSnapshotRecord>;
  sessionByMarket: Map<MarketCode, RegularSessionState>;
  previousTradingDateByMarket: Map<MarketCode, string | null>;
  freshnessToleranceSeconds: number;
  regularSessionOnly: boolean;
  supportedMarkets: Set<MarketCode>;
  heldPairs: ReadonlySet<string> | null;
  refreshCadenceMinutes: number | null;
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

  const regularSessionPairs = pairs.filter((pair) => isRegularSessionMarketCode(pair.marketCode));
  if (regularSessionPairs.length === 0) return null;

  const distinctMarkets = [...new Set(regularSessionPairs.map((pair) => pair.marketCode))]
    .filter(isRegularSessionMarketCode);
  const overlaysPromise = freshnessConfig.effectiveIntradayEnabled
    ? createIntradayOverlayCache(persistence).getLatestMany(regularSessionPairs)
    : Promise.resolve(new Map<string, IntradayPriceOverlay>());
  const fallbackPoliciesPromise = persistence.listQuoteFallbackPoliciesForTickerMarkets(regularSessionPairs);
  const [overlaysByKey, fallbackPolicies, sessionEntries] = await Promise.all([
    overlaysPromise,
    fallbackPoliciesPromise,
    Promise.all(distinctMarkets.map(async (marketCode) => {
      const session = await getRegularSessionState(marketCode, options.tradingCalendar!, now);
      return [
        marketCode,
        session,
        await getPreviousRegularSessionTradingDate(
          marketCode,
          options.tradingCalendar!,
          session.localDate,
        ),
      ] as const;
    })),
  ]);

  return {
    overlaysByKey,
    quoteFallbackPoliciesByKey: new Map(
      fallbackPolicies
        .filter((policy) => policy.active)
        .map((policy) => [quoteSnapshotKey(policy.ticker, policy.marketCode), policy] as const),
    ),
    sessionByMarket: new Map(sessionEntries.map(([marketCode, session]) => [marketCode, session])),
    previousTradingDateByMarket: new Map(sessionEntries.map(([marketCode, _session, previousTradingDate]) => [
      marketCode,
      previousTradingDate,
    ])),
    freshnessToleranceSeconds: freshnessConfig.effectiveIntradayFreshnessToleranceMinutes * 60,
    regularSessionOnly: freshnessConfig.effectiveRegularSessionOnly,
    supportedMarkets: new Set(freshnessConfig.effectiveSupportedMarkets),
    heldPairs: options.heldPairs ?? null,
    refreshCadenceMinutes: options.refreshCadenceMinutes ?? freshnessConfig.effectiveIntradayRefreshIntervalMinutes ?? null,
  };
}

function resolveSnapshotForPair(input: {
  pair: QuoteSnapshotPair;
  latest: SnapshotBar;
  previous: SnapshotBar | null;
  settledByMarket: ReadonlyMap<MarketCode, string>;
  displayContext: DisplayContext | null;
  now: Date;
}): ResolvedQuoteSnapshot | null {
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

  if (displayContext.heldPairs && !displayContext.heldPairs.has(key)) return dailySnapshot;

  const session = displayContext.sessionByMarket.get(pair.marketCode);
  if (!session) return dailySnapshot;

  const fallbackContext = getQuoteFallbackContext(pair, displayContext);
  if (fallbackContext) {
    return buildQuoteFallbackSnapshot({
      pair,
      policy: fallbackContext.policy,
      session: fallbackContext.session,
      settledByMarket,
      refreshCadenceMinutes: displayContext.refreshCadenceMinutes,
    });
  }

  if (!displayContext.supportedMarkets.has(pair.marketCode)) return dailySnapshot;

  const overlay = displayContext.overlaysByKey.get(key);
  if (!overlay || overlay.asOfDate !== session.localDate) {
    if (!session.isOpen) return dailySnapshot;
    if (dailySnapshot.priceState.basis === "stale_close") return dailySnapshot;
    return {
      ...dailySnapshot,
      priceState: buildOpenPreviousCloseState(
        latest,
        pair.marketCode,
        session,
        displayContext.refreshCadenceMinutes,
      ),
    };
  }

  const overlayPreviousClose = overlay.previousClose ?? latest.close;
  const change = overlayPreviousClose === null || overlayPreviousClose === 0
    ? null
    : overlay.price - overlayPreviousClose;
  const changePercent = overlayPreviousClose === null || overlayPreviousClose === 0
    ? null
    : (change! / overlayPreviousClose) * 100;
  const delaySeconds = Math.max(0, Math.floor((now.getTime() - Date.parse(overlay.asOfTimestamp)) / 1000));

  if (!session.isOpen) {
    if (latest.barDate >= overlay.asOfDate) return dailySnapshot;

    return {
      ticker: pair.ticker,
      marketCode: pair.marketCode,
      close: overlay.price,
      previousClose: overlayPreviousClose,
      change,
      changePercent,
      asOf: overlay.asOfTimestamp,
      source: overlay.source,
      isProvisional: false,
      dailyCompatibleClose: latest.close,
      priceState: {
        basis: "pending_today_close",
        chipState: "closed_pending",
        marketState: "closed",
        marketStateReason: "market_closed",
        source: overlay.source,
        sourceKind: overlay.sourceKind,
        sourceId: overlay.source,
        providerSymbol: overlay.providerSymbol ?? null,
        yahooSymbol: overlay.providerSymbol ?? null,
        asOfDate: overlay.asOfDate,
        asOfTimestamp: overlay.asOfTimestamp,
        observedAt: overlay.observedAt,
        delaySeconds,
        marketTimeZone: session.marketTimeZone,
        quality: null,
        marketLocalDate: session.localDate,
        calendarStatus: session.calendarStatus,
        refreshCadenceMinutes: displayContext.refreshCadenceMinutes,
        latestIntradayAttempt: null,
        latestRefreshAttemptAt: overlay.observedAt,
        latestRefreshOutcome: "success",
      },
    };
  }

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
      marketStateReason: "market_open",
      source: overlay.source,
      sourceKind: overlay.sourceKind,
      sourceId: overlay.source,
      providerSymbol: overlay.providerSymbol ?? null,
      yahooSymbol: overlay.providerSymbol ?? null,
      asOfDate: overlay.asOfDate,
      asOfTimestamp: overlay.asOfTimestamp,
      observedAt: overlay.observedAt,
      delaySeconds,
      marketTimeZone: session.marketTimeZone,
      quality: null,
      marketLocalDate: session.localDate,
      calendarStatus: session.calendarStatus,
      refreshCadenceMinutes: displayContext.refreshCadenceMinutes,
      latestIntradayAttempt: null,
      latestRefreshAttemptAt: overlay.observedAt,
      latestRefreshOutcome: "success",
    },
  };
}

function getQuoteFallbackContext(
  pair: QuoteSnapshotPair,
  displayContext: DisplayContext | null,
): { policy: QuoteFallbackPolicyWithSnapshotRecord; session: RegularSessionState } | null {
  if (!pair.marketCode || !displayContext) return null;
  const key = quoteSnapshotKey(pair.ticker, pair.marketCode);
  if (displayContext.heldPairs && !displayContext.heldPairs.has(key)) return null;
  const session = displayContext.sessionByMarket.get(pair.marketCode);
  if (!session) return null;
  const policy = displayContext.quoteFallbackPoliciesByKey.get(key);
  return policy ? { policy, session } : null;
}

function buildQuoteFallbackSnapshot(input: {
  pair: QuoteSnapshotPair & { marketCode?: MarketCode };
  policy: QuoteFallbackPolicyWithSnapshotRecord;
  session: RegularSessionState;
  settledByMarket: ReadonlyMap<MarketCode, string>;
  refreshCadenceMinutes: number | null;
}): ResolvedQuoteSnapshot | null {
  const { pair, policy, session, settledByMarket, refreshCadenceMinutes } = input;
  if (!pair.marketCode) return null;
  const snapshot = policy.latestSnapshot;
  if (!snapshot) return null;

  const settled = settledByMarket.get(pair.marketCode) ?? null;
  const dailyChangeFresh = !session.isOpen
    && settled !== null
    && snapshot.marketDate === settled
    && snapshot.previousClose !== null;
  const previousClose = dailyChangeFresh ? snapshot.previousClose : null;
  const change = previousClose !== null && previousClose !== 0
    ? snapshot.close - previousClose
    : null;
  const changePercent = previousClose !== null && previousClose !== 0
    ? (change! / previousClose) * 100
    : null;
  const marketStateReason: PriceStateDto["marketStateReason"] = session.marketStateReason === "market_open"
    ? "market_open"
    : session.marketStateReason === "calendar_unknown"
      ? "calendar_unknown"
      : session.marketStateReason === "outside_regular_session"
        ? "outside_regular_session"
        : "not_trading_day";

  return {
    ticker: pair.ticker,
    marketCode: pair.marketCode,
    close: snapshot.close,
    previousClose,
    change,
    changePercent,
    asOf: snapshot.marketDate,
    source: snapshot.source,
    isProvisional: false,
    dailyCompatibleClose: snapshot.close,
    priceState: {
      basis: "fallback_eod_close",
      chipState: dailyChangeFresh ? "fallback_eod" : "fallback_stale",
      marketState: session.isOpen ? "open" : "closed",
      marketStateReason,
      source: snapshot.source,
      sourceKind: "eodhd_eod",
      sourceId: "eodhd",
      providerSymbol: policy.providerSymbol,
      yahooSymbol: null,
      asOfDate: snapshot.marketDate,
      asOfTimestamp: null,
      observedAt: snapshot.fetchedAt,
      delaySeconds: null,
      marketTimeZone: session.marketTimeZone,
      quality: null,
      marketLocalDate: session.localDate,
      calendarStatus: session.calendarStatus,
      refreshCadenceMinutes,
      latestIntradayAttempt: null,
      latestRefreshAttemptAt: policy.lastRefreshAt ?? snapshot.fetchedAt,
      latestRefreshOutcome: policy.lastRefreshStatus,
      fallbackPolicyId: policy.id,
      fallbackProvider: policy.provider,
      fallbackStale: !dailyChangeFresh,
      fallbackLastError: policy.lastRefreshError,
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
  const previousTradingDate = pair.marketCode
    ? displayContext?.previousTradingDateByMarket.get(pair.marketCode)
    : undefined;

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
    priceState: buildDailyPriceState(
      latest,
      pair.marketCode,
      settledByMarket,
      session,
      previousTradingDate,
      displayContext?.refreshCadenceMinutes ?? null,
    ),
  };
}

function buildDailyPriceState(
  latest: SnapshotBar,
  marketCode: MarketCode | undefined,
  settledByMarket: ReadonlyMap<MarketCode, string>,
  session: RegularSessionState | undefined,
  previousTradingDate: string | null | undefined,
  refreshCadenceMinutes: number | null,
): PriceStateDto {
  const settled = marketCode ? settledByMarket.get(marketCode) ?? null : null;
  const marketState: PriceStateDto["marketState"] = session?.isOpen ? "open" : "closed";
  const marketStateReason: PriceStateDto["marketStateReason"] = session
    ? session.marketStateReason === "market_open"
      ? "market_open"
      : session.marketStateReason === "calendar_unknown"
        ? "calendar_unknown"
        : session.marketStateReason === "outside_regular_session"
          ? "outside_regular_session"
          : "not_trading_day"
    : "market_closed";
  const marketTimeZone = session?.marketTimeZone ?? null;
  const sourceKind = mapDailySourceKind(latest.source);

  let basis: PriceStateBasisDto = "today_close";
  let chipState: PriceStateDto["chipState"] = "closed";

  if (isAwaitingTodayClose(latest, session, previousTradingDate)) {
    basis = "pending_today_close";
    chipState = "closed_pending";
  } else if (settled && latest.barDate < settled) {
    basis = "stale_close";
    chipState = "stale";
  } else if (marketState === "open") {
    basis = "previous_close";
    chipState = "open_previous_close";
  }

  return {
    basis,
    chipState,
    marketState,
    marketStateReason,
    source: latest.source,
    sourceKind,
    sourceId: latest.source,
    providerSymbol: null,
    yahooSymbol: null,
    asOfDate: latest.barDate,
    asOfTimestamp: null,
    observedAt: latest.ingestedAt,
    delaySeconds: null,
    marketTimeZone,
    quality: latest.quality,
    marketLocalDate: session?.localDate ?? null,
    calendarStatus: session?.calendarStatus ?? null,
    refreshCadenceMinutes,
    latestIntradayAttempt: null,
  };
}

function isAwaitingTodayClose(
  latest: SnapshotBar,
  session: RegularSessionState | undefined,
  previousTradingDate: string | null | undefined,
): boolean {
  return session?.marketStateReason === "outside_regular_session"
    && session.isAfterRegularSessionClose
    && latest.barDate < session.localDate
    && previousTradingDate !== null
    && previousTradingDate !== undefined
    && latest.barDate >= previousTradingDate;
}

function buildOpenPreviousCloseState(
  latest: SnapshotBar,
  marketCode: MarketCode,
  session: RegularSessionState,
  refreshCadenceMinutes: number | null,
): PriceStateDto {
  return {
    basis: "previous_close",
    chipState: "open_previous_close",
    marketState: "open",
    marketStateReason: "market_open",
    source: latest.source,
    sourceKind: mapDailySourceKind(latest.source),
    sourceId: latest.source,
    providerSymbol: null,
    yahooSymbol: null,
    asOfDate: latest.barDate,
    asOfTimestamp: null,
    observedAt: latest.ingestedAt,
    delaySeconds: null,
    marketTimeZone: session.marketTimeZone,
    quality: latest.quality,
    marketLocalDate: session.localDate,
    calendarStatus: session.calendarStatus,
    refreshCadenceMinutes,
    latestIntradayAttempt: null,
  };
}

export function mapDailySourceKind(source: string | null | undefined): PriceStateSourceKindDto {
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
  return priceState.basis === "intraday"
    || priceState.basis === "today_close"
    || (priceState.basis === "fallback_eod_close" && priceState.fallbackStale !== true);
}

export function isIntradayPriceState(priceState: PriceStateDto): boolean {
  return priceState.basis === "intraday" || priceState.basis === "delayed_intraday";
}
