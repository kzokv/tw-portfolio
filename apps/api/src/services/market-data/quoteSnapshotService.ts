import type { DailyBar, MarketCode, QuoteSnapshot } from "@vakwen/domain";
import type { Persistence } from "../../persistence/types.js";

export interface QuoteSnapshotPair {
  ticker: string;
  marketCode?: MarketCode;
}

type SnapshotBar = DailyBar & { marketCode?: MarketCode };

export function quoteSnapshotKey(ticker: string, marketCode?: MarketCode): string {
  return marketCode ? `${ticker}:${marketCode}` : ticker;
}

/**
 * Resolve quote snapshots for a list of (ticker, marketCode) pairs.
 *
 * Fetches the latest 2 bars per ticker/market pair to compute derived fields
 * (previousClose, change, changePercent). Returns a map keyed by
 * `${ticker}:${marketCode}` when marketCode is known, or by bare ticker for
 * legacy callers without market context. For compatibility, a bare ticker alias
 * is also emitted when that ticker has exactly one requested market.
 *
 * KZO-191: provisional is now market-aware. A bar is provisional iff
 * `barDate < settledByMarket.get(marketCode)`. Callers pre-resolve the
 * per-market settled date via `tradingCalendarCache.latestSettledTradingDay`.
 * Pairs without a resolvable `marketCode` (manual instruments, or callers
 * like `/quotes` that don't carry market context) fall back to
 * `isProvisional = false`.
 */
export async function resolveQuoteSnapshots(
  pairs: ReadonlyArray<QuoteSnapshotPair>,
  persistence: Persistence,
  settledByMarket: ReadonlyMap<MarketCode, string>,
): Promise<Record<string, QuoteSnapshot | null>> {
  if (pairs.length === 0) return {};

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

  const result: Record<string, QuoteSnapshot | null> = {};

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

    // Bars are ordered by bar_date DESC from persistence
    const latest = tickerBars[0] as SnapshotBar;
    const previous = tickerBars.length >= 2 ? tickerBars[1] : null;

    const previousClose = previous ? previous.close : null;
    let change: number | null = null;
    let changePercent: number | null = null;

    if (previousClose !== null && previousClose !== 0) {
      change = latest.close - previousClose;
      changePercent = (change / previousClose) * 100;
    }

    const snapshot: QuoteSnapshot = {
      ticker: pair.ticker,
      ...(pair.marketCode ? { marketCode: pair.marketCode } : {}),
      close: latest.close,
      previousClose,
      change,
      changePercent,
      asOf: latest.barDate,
      source: latest.source,
      isProvisional: computeIsProvisional(latest.barDate, pair.marketCode, settledByMarket),
    };
    result[key] = snapshot;
    if (shouldEmitBareTickerAlias(pair, marketsByTicker)) {
      result[pair.ticker] = snapshot;
    }
  }

  return result;
}

function shouldEmitBareTickerAlias(
  pair: QuoteSnapshotPair,
  marketsByTicker: ReadonlyMap<string, ReadonlySet<MarketCode>>,
): boolean {
  if (!pair.marketCode) return false;
  return marketsByTicker.get(pair.ticker)?.size === 1;
}

/**
 * KZO-191: market-aware provisional check.
 *
 * A bar is provisional iff its date is before the latest settled trading day
 * for its market. When `marketCode` is missing (manual instrument, or caller
 * without market context like `/quotes`), or no settled date is supplied for
 * the market, the bar is treated as non-provisional — matches the
 * conservative default established by KZO-177's freshness DTO for
 * unresolvable instruments.
 */
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
