// KZO-177 — server-side freshness classification for holdings.
//
// Maps each holding's `latest bar date` to a `freshness` enum tier and a
// pre-formatted tooltip string the UI renders verbatim. Manual / unsupported
// instruments (no `marketCode` resolvable from the catalog, or no `providerId`
// in scope) return `current` + `null` tooltip — the badge is hidden.
//
// Per-request caching: `latestSettledTradingDay(market, now)` and the
// per-(account, ticker) `latestBarDate` are looked up once per request, then
// reused across holdings.

import type { DashboardOverviewHoldingDto } from "@vakwen/shared-types";
import type { MarketCode } from "@vakwen/domain";
import type { Persistence } from "../persistence/types.js";
import type { TradingCalendarCache } from "./market-data/tradingCalendar.js";
import type { Store } from "../types/store.js";

interface EnrichDeps {
  persistence: Pick<Persistence, "getLatestBarDatesByTickerMarket">;
  tradingCalendar: Pick<TradingCalendarCache, "latestSettledTradingDay" | "tradingDaysBetween">;
  now?: Date;
}

/**
 * Mutates the input holdings array in place with `freshness` + `freshnessTooltip`
 * fields computed from the latest bar date per ticker.
 *
 * For tickers without a resolvable `marketCode` in `store.instruments` (manual
 * / unsupported instruments) the badge is hidden (`freshness=current`,
 * `tooltip=null`).
 */
export async function enrichHoldingsWithFreshness(
  holdings: DashboardOverviewHoldingDto[],
  store: Store,
  deps: EnrichDeps,
): Promise<void> {
  if (holdings.length === 0) return;

  const now = deps.now ?? new Date();
  const tickerToMarket = new Map<string, MarketCode>();
  for (const inst of store.instruments) {
    if (inst.marketCode && (inst.marketCode === "TW" || inst.marketCode === "US" || inst.marketCode === "AU")) {
      tickerToMarket.set(inst.ticker, inst.marketCode as MarketCode);
    }
  }

  // Per-request cache for `latestSettledTradingDay(market, now)`.
  const settledByMarket = new Map<MarketCode, string>();
  async function getSettled(market: MarketCode): Promise<string> {
    const cached = settledByMarket.get(market);
    if (cached) return cached;
    const value = await deps.tradingCalendar.latestSettledTradingDay(market, now);
    settledByMarket.set(market, value);
    return value;
  }

  // KZO-177 (P2 Fix 3): batched latest-bar-date lookup keyed by composite
  // `(ticker, marketCode)`. Required so cross-listed instruments (e.g. BHP/AU
  // vs BHP/US) get classified against their own market's data rather than
  // colliding under the bare ticker.
  const distinctPairs = new Map<string, { ticker: string; marketCode: MarketCode }>();
  for (const h of holdings) {
    const market = tickerToMarket.get(h.ticker);
    if (!market) continue;
    distinctPairs.set(`${h.ticker}:${market}`, { ticker: h.ticker, marketCode: market });
  }
  const latestBarByKey = await deps.persistence.getLatestBarDatesByTickerMarket(
    [...distinctPairs.values()],
  );

  for (const holding of holdings) {
    const market = tickerToMarket.get(holding.ticker);
    if (!market) {
      holding.freshness = "current";
      holding.freshnessTooltip = null;
      continue;
    }
    const latestBarDate = latestBarByKey.get(`${holding.ticker}:${market}`);
    if (!latestBarDate) {
      // No bar data at all — show stale_red (significantly behind).
      holding.freshness = "stale_red";
      holding.freshnessTooltip = "Price data is unavailable.";
      continue;
    }
    const settled = await getSettled(market);
    const daysBehind = await deps.tradingCalendar.tradingDaysBetween(latestBarDate, settled, market);
    if (daysBehind <= 0) {
      holding.freshness = "current";
      holding.freshnessTooltip = null;
    } else if (daysBehind === 1) {
      holding.freshness = "stale_amber";
      holding.freshnessTooltip = "Price data is 1 trading day old.";
    } else {
      holding.freshness = "stale_red";
      holding.freshnessTooltip = `Price data is ${daysBehind} trading days old.`;
    }
  }
}
