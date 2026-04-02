import type { DailyBar, QuoteSnapshot } from "@tw-portfolio/domain";
import type { Persistence } from "../../persistence/types.js";

/**
 * Resolve quote snapshots for a list of tickers from the latest persisted daily bars.
 *
 * Fetches the latest 2 bars per ticker to compute derived fields (previousClose, change, changePercent).
 * Returns a map keyed by ticker with explicit nulls for tickers with no bars.
 */
export async function resolveQuoteSnapshots(
  tickers: string[],
  persistence: Persistence,
): Promise<Record<string, QuoteSnapshot | null>> {
  if (tickers.length === 0) return {};

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
      isProvisional: computeIsProvisional(latest.barDate),
    };
  }

  return result;
}

/**
 * Weekend-aware provisional check in TST (UTC+8).
 * If bar_date < today (TST) and today is a weekday, the bar is provisional.
 * On weekends, the latest bar is considered non-provisional.
 */
function computeIsProvisional(barDate: string): boolean {
  const now = new Date();
  // Convert to TST (UTC+8)
  const tstOffset = 8 * 60 * 60 * 1000;
  const tstNow = new Date(now.getTime() + tstOffset);
  const tstToday = tstNow.toISOString().slice(0, 10);
  const dayOfWeek = tstNow.getUTCDay(); // 0=Sun, 6=Sat

  // Weekend: treat latest bar as non-provisional
  if (dayOfWeek === 0 || dayOfWeek === 6) return false;

  // Weekday: provisional if bar_date is before today
  return barDate < tstToday;
}
