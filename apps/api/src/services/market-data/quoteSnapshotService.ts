import type { DailyBar, MarketCode, QuoteSnapshot } from "@vakwen/domain";
import type { Persistence } from "../../persistence/types.js";

export interface QuoteSnapshotPair {
  ticker: string;
  marketCode?: MarketCode;
}

/**
 * Resolve quote snapshots for a list of (ticker, marketCode) pairs.
 *
 * Fetches the latest 2 bars per ticker to compute derived fields
 * (previousClose, change, changePercent). Returns a map keyed by ticker
 * with explicit nulls for tickers with no bars.
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

  const tickers = [...new Set(pairs.map((pair) => pair.ticker))];
  const marketByTicker = new Map<string, MarketCode>();
  for (const pair of pairs) {
    if (pair.marketCode && !marketByTicker.has(pair.ticker)) {
      marketByTicker.set(pair.ticker, pair.marketCode);
    }
  }

  const bars = await persistence.getLatestBars(tickers, 2);

  const grouped = new Map<string, DailyBar[]>();
  for (const bar of bars) {
    const list = grouped.get(bar.ticker) ?? [];
    list.push(bar);
    grouped.set(bar.ticker, list);
  }

  const result: Record<string, QuoteSnapshot | null> = {};

  for (const ticker of tickers) {
    const tickerBars = grouped.get(ticker);
    if (!tickerBars || tickerBars.length === 0) {
      result[ticker] = null;
      continue;
    }

    // Bars are ordered by bar_date DESC from persistence
    const latest = tickerBars[0];
    const previous = tickerBars.length >= 2 ? tickerBars[1] : null;

    const previousClose = previous ? previous.close : null;
    let change: number | null = null;
    let changePercent: number | null = null;

    if (previousClose !== null && previousClose !== 0) {
      change = latest.close - previousClose;
      changePercent = (change / previousClose) * 100;
    }

    result[ticker] = {
      ticker,
      close: latest.close,
      previousClose,
      change,
      changePercent,
      asOf: latest.barDate,
      source: latest.source,
      isProvisional: computeIsProvisional(latest.barDate, marketByTicker.get(ticker), settledByMarket),
    };
  }

  return result;
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
