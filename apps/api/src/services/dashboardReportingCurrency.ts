/**
 * KZO-180: FX-aware dashboard aggregation service.
 *
 * Translates the per-currency native dashboard outputs into the user's chosen
 * `reportingCurrency` for `/dashboard/overview.summary` and
 * `/dashboard/performance.points[]`. Per-holding rows on `/overview` and per-event
 * dividend rows stay native (D3) — those surfaces translate at the UI layer when
 * KZO-176 lands the per-market-section cards.
 *
 * v1 deviation from KZO-166 D4: `cumulative_realized_pnl` is translated at
 * `snapshot_date` FX, NOT the sale-date FX. The denormalized cumulative column
 * doesn't preserve per-trade sale-date breakdown; strict D4 adherence requires a
 * JOIN-to-trades aggregation owned by KZO-176's per-position FX-attribution
 * decomposition. This is correct for TWD-only users (today's entire production
 * user base) and an approximation for mixed-currency users until KZO-176.
 *
 * D8 self-pair guard: the persistence-layer SQL `LEFT JOIN LATERAL ... ON
 * s.currency <> $reportingCurrency` gates the FX lookup so TWD→TWD positions
 * don't hit `market_data.fx_rates` (which has no self-pair rows). Without that
 * guard, `value_native * NULL` propagates into SUM and silently NULLs out the
 * entire production user base's totals. See
 * `docs/004-notes/kzo-180/scope-todo-202604291600-reporting-currency.md` §D8.
 *
 * Status convention (`fxStatus`):
 *   - `"complete"` — every contributing source-currency resolved (or self-pair).
 *   - `"partial"`  — some contributing rows resolved, others did not.
 *   - `"missing"`  — every contributing row's pair failed.
 */

import { resolveRangeBounds, roundToDecimal } from "@vakwen/domain";
import type { DailyBar, QuoteSnapshot } from "@vakwen/domain";
import type {
  AccountDefaultCurrency,
  DashboardOverviewHoldingChildDto,
  DashboardOverviewHoldingGroupDto,
  DashboardOverviewHoldingDto,
  DashboardOverviewRecentDividendDto,
  DashboardOverviewSummaryDto,
  DashboardOverviewUpcomingDividendDto,
  HoldingAllocationBasis,
  DashboardPerformanceDto,
  DashboardPerformancePointDto,
  DashboardPerformanceRange,
} from "@vakwen/shared-types";
import type { Persistence } from "../persistence/types.js";
import type { BookedTradeEvent, Store } from "../types/store.js";
import { quoteSnapshotKey } from "./market-data/quoteSnapshotService.js";

interface PreTranslationOverviewSummary {
  asOf: string;
  accountCount: number;
  holdingCount: number;
  totalCostAmount: number;
  marketValueAmount: number | null;
  unrealizedPnlAmount: number | null;
  dailyChangeAmount: number | null;
  dailyChangePercent: number | null;
  upcomingDividendCount: number;
  upcomingDividendAmount: number | null;
  openIssueCount: number;
}

interface OverviewDividends {
  upcoming: DashboardOverviewUpcomingDividendDto[];
  recent: DashboardOverviewRecentDividendDto[];
}

/**
 * Pre-fetches per-source-currency FX rates into a Map keyed by source-currency
 * code. Self-pair entries map to 1.0 without touching the persistence layer.
 *
 * The Map's null entries flow into the `fxStatus` rollup at the call site:
 *   - all-resolved → "complete"
 *   - some-null    → "partial"
 *   - all-null     → "missing" (rare; only fires when nothing in fx_rates
 *                                 covers any contributing source currency)
 */
async function buildFxRateMap(
  sourceCurrencies: ReadonlyArray<string>,
  reportingCurrency: AccountDefaultCurrency,
  asOfDate: string,
  persistence: Persistence,
): Promise<Map<string, number | null>> {
  const map = new Map<string, number | null>();
  for (const src of sourceCurrencies) {
    if (map.has(src)) continue;
    if (src === reportingCurrency) {
      map.set(src, 1.0);
      continue;
    }
    const rate = await persistence.getFxRate(src, reportingCurrency, asOfDate);
    map.set(src, rate);
  }
  return map;
}

function rollupFxStatus(
  fxMap: ReadonlyMap<string, number | null>,
): "complete" | "partial" | "missing" {
  // Empty contributors → "complete": no FX is needed when there are no
  // holdings/dividends to translate. The HTTP-1 spec pins this contract for
  // the empty-portfolio default-user case.
  if (fxMap.size === 0) return "complete";
  let resolvedCount = 0;
  let nullCount = 0;
  for (const rate of fxMap.values()) {
    if (rate === null) nullCount += 1;
    else resolvedCount += 1;
  }
  if (nullCount === 0) return "complete";
  if (resolvedCount === 0) return "missing";
  return "partial";
}

/**
 * KZO-180: Translate the native overview summary (5 KPIs) into the user's
 * chosen reporting currency.
 *
 * Inputs:
 *  - `summary`    — pre-translation native summary (without `totalCostCurrency`).
 *                   The legacy field has been dropped from the wire DTO; we
 *                   accept the legacy-shaped projection so the route handler
 *                   stays simple.
 *  - `holdings`   — per-holding rows on `/overview` (each carries `currency`,
 *                   `costBasisAmount`, `marketValueAmount`, `unrealizedPnlAmount`,
 *                   `change`, `quantity`, `previousClose`).
 *  - `dividends`  — pass-through; only `upcoming` is summed for translation.
 *  - `reportingCurrency` — target currency.
 *  - `asOfDate`   — single FX-rate timestamp for all 5 KPIs (D4 — `/overview`
 *                   uses asOf-day FX uniformly across the section).
 *  - `persistence` — used for `getFxRate(src, target, asOf)`.
 *
 * Behavior on missing FX:
 *  - Per-holding contributions whose FX rate is null drop out of the summed
 *    KPI; nullable KPIs surface as null when at least one contributing rate
 *    failed. `totalCostAmount` remains non-null per the shared DTO contract,
 *    with `fxStatus` carrying the degradation signal.
 *  - `fxStatus` reflects the rollup across all unique source currencies.
 */
export async function translateOverviewSummary(
  summary: PreTranslationOverviewSummary,
  holdings: ReadonlyArray<DashboardOverviewHoldingDto>,
  dividends: OverviewDividends,
  reportingCurrency: AccountDefaultCurrency,
  asOfDate: string,
  persistence: Persistence,
): Promise<DashboardOverviewSummaryDto> {
  const sourceCurrencies = new Set<string>();
  for (const h of holdings) sourceCurrencies.add(h.currency);
  for (const d of dividends.upcoming) sourceCurrencies.add(d.currency);
  // recent dividends not summed — stays native per D3.

  const fxMap = await buildFxRateMap(
    [...sourceCurrencies],
    reportingCurrency,
    asOfDate,
    persistence,
  );
  const fxStatus = rollupFxStatus(fxMap);

  // Aggregate the 5 KPIs by translating each holding's contribution.
  let totalCostAmount = 0;
  let marketValueAmount = 0;
  let unrealizedPnlAmount = 0;
  let dailyChangeAmount = 0;
  let previousMarketValue = 0;
  let totalCostHasMissing = false;
  let marketValueHasMissing = false;
  let unrealizedHasMissing = false;
  let dailyChangeHasMissing = false;
  let dailyChangeAllAvailable = true;
  let dailyChangeHasContributors = false;

  for (const h of holdings) {
    const fx = fxMap.get(h.currency) ?? null;
    if (fx === null) {
      totalCostHasMissing = true;
      marketValueHasMissing = true;
      unrealizedHasMissing = true;
      dailyChangeAllAvailable = false;
      continue;
    }
    totalCostAmount += h.costBasisAmount * fx;

    const mvNative = h.marketValueAmount;
    if (mvNative === null) marketValueHasMissing = true;
    else marketValueAmount += mvNative * fx;

    const upNative = h.unrealizedPnlAmount;
    if (upNative === null) unrealizedHasMissing = true;
    else unrealizedPnlAmount += upNative * fx;

    if (h.change !== null && h.previousClose !== null) {
      dailyChangeHasContributors = true;
      dailyChangeAmount += h.quantity * h.change * fx;
      previousMarketValue += h.quantity * h.previousClose * fx;
    } else {
      dailyChangeHasMissing = true;
    }
  }

  // Upcoming-dividend amount: translated sum across upcoming events.
  let upcomingDividendAmount = 0;
  let upcomingHasMissing = false;
  let upcomingHasContributors = false;
  for (const d of dividends.upcoming) {
    if (d.expectedAmount === null) continue;
    const fx = fxMap.get(d.currency) ?? null;
    if (fx === null) {
      upcomingHasMissing = true;
      continue;
    }
    upcomingHasContributors = true;
    upcomingDividendAmount += d.expectedAmount * fx;
  }

  // Apply missing-FX semantics to each KPI:
  //  - totalCostAmount: `number` (not nullable in the DTO). When ANY contributing
  //    holding's FX failed we keep the partial-translated sum and let `fxStatus`
  //    signal partial. The DTO contract for this single field is intentionally
  //    not-null so the upstream UI never has to render a null total.
  //    `totalCostHasMissing` is informational here — totalCostAmount is the
  //    accumulator so far, which is 0 when nothing translated.
  //  - The rest of the KPIs are nullable; null when ANY contributor failed.
  const finalTotalCost = totalCostAmount;
  void totalCostHasMissing;
  const finalMarketValue =
    marketValueHasMissing || summary.marketValueAmount === null
      ? null
      : marketValueAmount;
  const finalUnrealized =
    unrealizedHasMissing || summary.unrealizedPnlAmount === null
      ? null
      : unrealizedPnlAmount;
  // dailyChange: null when no contributors, when any holding's per-share change
  // wasn't available (dailyChangeHasMissing), or when any holding's FX failed
  // (!dailyChangeAllAvailable). Rounding mirrors the legacy `dashboard.ts`
  // shape (2 dp absolute, 4 dp percent) so existing TWD-only assertions pass.
  let finalDailyChange: number | null;
  let finalDailyChangePercent: number | null;
  if (
    !dailyChangeHasContributors ||
    dailyChangeHasMissing ||
    !dailyChangeAllAvailable
  ) {
    finalDailyChange = null;
    finalDailyChangePercent = null;
  } else {
    finalDailyChange = roundToDecimal(dailyChangeAmount, 2);
    finalDailyChangePercent =
      previousMarketValue > 0
        ? roundToDecimal((finalDailyChange / previousMarketValue) * 100, 4)
        : null;
  }
  // upcomingDividendAmount: null when no contributors, when any upcoming
  // dividend's FX failed, or when the resulting sum is exactly 0 (mirrors the
  // legacy `|| null` semantics — empty upcoming widgets render the count, not
  // a "$0" amount).
  let finalUpcomingDividend: number | null;
  if (!upcomingHasContributors || upcomingHasMissing) {
    finalUpcomingDividend = null;
  } else {
    finalUpcomingDividend = upcomingDividendAmount || null;
  }

  return {
    asOf: summary.asOf,
    accountCount: summary.accountCount,
    holdingCount: summary.holdingCount,
    totalCostAmount: finalTotalCost,
    reportingCurrency,
    fxStatus,
    marketValueAmount: finalMarketValue,
    unrealizedPnlAmount: finalUnrealized,
    dailyChangeAmount: finalDailyChange,
    dailyChangePercent: finalDailyChangePercent,
    upcomingDividendCount: summary.upcomingDividendCount,
    upcomingDividendAmount: finalUpcomingDividend,
    openIssueCount: summary.openIssueCount,
  };
}

export async function translateOverviewHoldingGroups(
  holdingGroups: ReadonlyArray<DashboardOverviewHoldingGroupDto>,
  reportingCurrency: AccountDefaultCurrency,
  allocationBasis: HoldingAllocationBasis,
  asOfDate: string,
  persistence: Persistence,
): Promise<DashboardOverviewHoldingGroupDto[]> {
  const sourceCurrencies = [...new Set(holdingGroups.map((group) => group.currency))];
  const fxMap = await buildFxRateMap(
    sourceCurrencies,
    reportingCurrency,
    asOfDate,
    persistence,
  );

  const translatedGroups = holdingGroups.map((group) =>
    translateHoldingGroup(group, reportingCurrency, fxMap.get(group.currency) ?? null),
  );
  const groupAllocations = deriveAllocationDetails(translatedGroups, allocationBasis);
  const childAllocations = deriveAllocationDetails(
    translatedGroups.flatMap((group) => group.children),
    allocationBasis,
  );

  return translatedGroups.map((group) => ({
    ...applyAllocationDetails(group, groupAllocations),
    children: group.children.map((child) => applyAllocationDetails(child, childAllocations)),
  }));
}

/**
 * KZO-180: Build the `/dashboard/performance` time series in reporting currency.
 *
 * Always reads from `daily_holding_snapshots` via the FX-aware persistence
 * method. When the snapshot table has zero rows for the user/range (typical for
 * fresh accounts with no posted snapshots yet), falls back to the synthetic
 * trade-replay path with a per-(symbol → currency) FX-aware translation.
 *
 * `fxStatus` is rolled up from per-point `fxAvailable` flags using the same
 * convention as `translateOverviewSummary`. Per-point numerics become null
 * when `fxAvailable === false`.
 */
export async function translatePerformancePoints(
  userId: string,
  range: DashboardPerformanceRange,
  asOf: string,
  reportingCurrency: AccountDefaultCurrency,
  persistence: Persistence,
  store?: Store,
  quotes?: SyntheticQuoteInput,
): Promise<DashboardPerformanceDto> {
  const earliestTradeDate = store?.accounting.facts.tradeEvents
    .map((trade) => trade.tradeDate)
    .sort()[0];
  const { startDate, endDate } = resolveRangeBounds(range, asOf, earliestTradeDate);
  const datedFinance = store
    ? await buildDatedPerformanceFinance(store, startDate, endDate, reportingCurrency, persistence)
    : null;
  const aggregated =
    await persistence.getAggregatedSnapshotsInReportingCurrency(
      userId,
      startDate,
      endDate,
      reportingCurrency,
    );

  if (aggregated.length > 0) {
    const points: DashboardPerformancePointDto[] = aggregated.map((p) => {
      const finance = datedFinance?.get(p.date) ?? null;
      if (!finance) {
        return {
          date: p.date,
          totalCostAmount: p.fxAvailable ? p.totalCostBasis : null,
          marketValueAmount: p.fxAvailable ? p.totalMarketValue : null,
          unrealizedPnlAmount: p.fxAvailable ? p.totalUnrealizedPnl : null,
          cumulativeRealizedPnlAmount: p.fxAvailable
            ? p.cumulativeRealizedPnl
            : null,
          cumulativeDividendsAmount: p.fxAvailable ? p.cumulativeDividends : null,
          totalReturnAmount: p.fxAvailable ? p.totalReturnAmount : null,
          totalReturnPercent: p.fxAvailable ? p.totalReturnPercent : null,
          fxAvailable: p.fxAvailable,
        };
      }

      const marketValueAmount = p.fxAvailable ? p.totalMarketValue : null;
      return buildPerformancePoint({
        date: p.date,
        marketValueAmount,
        bookCostAmount: finance.bookCostAmount,
        cumulativeRealizedPnlAmount: finance.cumulativeRealizedPnlAmount,
        cumulativeDividendsAmount: finance.cumulativeDividendsAmount,
        fxAvailable: p.fxAvailable && finance.fxAvailable,
      });
    });
    const fxStatus: "complete" | "partial" | "missing" = (() => {
      let allAvail = true;
      let allMissing = true;
      for (const pt of points) {
        if (pt.fxAvailable) allMissing = false;
        else allAvail = false;
      }
      if (allAvail) return "complete";
      if (allMissing) return "missing";
      return "partial";
    })();
    return { range, points, reportingCurrency, fxStatus };
  }

  // Fallback synthetic path — only used when the snapshot table has zero rows
  // for the user/range. Mirrors `buildSyntheticPerformance` from
  // `apps/api/src/services/dashboard.ts` but FX-aware: each (account, ticker)
  // position contributes via its native price-currency, translated at the
  // current point's date FX rate. For TWD-only stores this collapses to the
  // legacy synthetic shape with `fxAvailable: true`.
  if (!store) {
    return { range, points: [], reportingCurrency, fxStatus: "complete" };
  }

  const syntheticQuotes = typeof quotes === "function" ? await quotes() : quotes ?? [];
  const synthetic = await buildFxAwareSyntheticPerformance(
    store,
    range,
    asOf,
    reportingCurrency,
    persistence,
    syntheticQuotes,
    datedFinance,
  );
  let allAvailSyn = true;
  let allMissingSyn = true;
  for (const pt of synthetic) {
    if (pt.fxAvailable) allMissingSyn = false;
    else allAvailSyn = false;
  }
  let fxStatusSyn: "complete" | "partial" | "missing";
  if (synthetic.length === 0) fxStatusSyn = "complete";
  else if (allAvailSyn) fxStatusSyn = "complete";
  else if (allMissingSyn) fxStatusSyn = "missing";
  else fxStatusSyn = "partial";

  return { range, points: synthetic, reportingCurrency, fxStatus: fxStatusSyn };
}

// ── Internal helpers ────────────────────────────────────────────────────────

interface SyntheticPosition {
  quantity: number;
  costBasisAmount: number;
  /** Native currency from the first BUY trade for this (account, ticker). */
  currency: string;
  marketCode: string;
}

type SyntheticQuoteInput = ReadonlyArray<QuoteSnapshot> | (() => Promise<ReadonlyArray<QuoteSnapshot>>);

interface DatedPerformanceFinancePoint {
  bookCostAmount: number | null;
  cumulativeRealizedPnlAmount: number | null;
  cumulativeDividendsAmount: number | null;
  fxAvailable: boolean;
}

interface PerformancePositionFinance {
  quantity: number;
  bookCostAmount: number;
  hasMissingBookCost: boolean;
}

async function buildFxAwareSyntheticPerformance(
  store: Store,
  range: DashboardPerformanceRange,
  asOf: string,
  reportingCurrency: AccountDefaultCurrency,
  persistence: Persistence,
  quotes: ReadonlyArray<QuoteSnapshot>,
  datedFinance: ReadonlyMap<string, DatedPerformanceFinancePoint> | null,
): Promise<DashboardPerformancePointDto[]> {
  const trades = sortTradeEvents(store.accounting.facts.tradeEvents);
  const earliest = trades.length > 0 ? trades[0].tradeDate : undefined;
  const { startDate, endDate } = resolveRangeBounds(range, asOf, earliest);
  const positions = new Map<string, SyntheticPosition>();
  const quoteByKey = new Map(quotes.flatMap((q): Array<[string, QuoteSnapshot]> => {
    const entries: Array<[string, QuoteSnapshot]> = [[quoteSnapshotKey(q.ticker, q.marketCode), q]];
    if (!q.marketCode) entries.push([q.ticker, q]);
    return entries;
  }));
  let tradeIndex = 0;

  function applyTrade(trade: (typeof trades)[number]): void {
    const key = performancePositionKey(trade);
    const prev = positions.get(key) ?? {
      quantity: 0,
      costBasisAmount: 0,
      currency: trade.priceCurrency,
      marketCode: trade.marketCode,
    };
    if (trade.type === "BUY") {
      positions.set(key, {
        quantity: prev.quantity + trade.quantity,
        costBasisAmount:
          prev.costBasisAmount +
          Math.round(trade.quantity * trade.unitPrice * 100) / 100 +
          trade.commissionAmount +
          trade.taxAmount,
        currency: prev.currency, // first-BUY wins; matches snapshot walker's invariant
        marketCode: prev.marketCode,
      });
      return;
    }
    const realized = trade.realizedPnlAmount ?? 0;
    const proceeds =
      Math.round(trade.quantity * trade.unitPrice * 100) / 100 -
      trade.commissionAmount -
      trade.taxAmount;
    const allocated = Math.max(0, proceeds - realized);
    const nextQty = Math.max(0, prev.quantity - trade.quantity);
    const nextCost = Math.max(0, prev.costBasisAmount - allocated);
    if (nextQty === 0) {
      positions.delete(key);
      return;
    }
    positions.set(key, {
      quantity: nextQty,
      costBasisAmount: nextCost,
      currency: prev.currency,
      marketCode: prev.marketCode,
    });
  }

  while (
    tradeIndex < trades.length &&
    trades[tradeIndex].tradeDate < startDate
  ) {
    applyTrade(trades[tradeIndex]);
    tradeIndex += 1;
  }

  const points: DashboardPerformancePointDto[] = [];
  const activeTickers = Array.from(new Set(trades.map((trade) => trade.ticker)));
  const barsByTicker = activeTickers.length > 0
    ? await persistence.getDailyBarsForTickers(activeTickers, startDate, endDate)
    : new Map<string, DailyBar[]>();
  const closeByTickerDate = new Map<string, Map<string, number>>();
  for (const [ticker, bars] of barsByTicker) {
    closeByTickerDate.set(ticker, new Map(bars.map((bar) => [bar.barDate, bar.close])));
  }
  const hasAnyHistoricalBars = [...barsByTicker.values()].some((bars) => bars.length > 0);

  // Per-currency FX cache shared across the synthetic loop; we forward-fill
  // per-date because `getFxRate` already encodes that semantics.
  const fxCache = new Map<string, number | null>();
  async function fxFor(src: string, date: string): Promise<number | null> {
    if (src === reportingCurrency) return 1.0;
    // Cache key encodes both src and date — different dates may resolve different rates.
    const cacheKey = `${src}|${date}`;
    if (fxCache.has(cacheKey)) return fxCache.get(cacheKey) ?? null;
    const rate = await persistence.getFxRate(src, reportingCurrency, date);
    fxCache.set(cacheKey, rate);
    return rate;
  }

  const oneDayMs = 86_400_000;
  for (
    let cursor = new Date(`${startDate}T00:00:00.000Z`).getTime();
    cursor <= new Date(`${endDate}T00:00:00.000Z`).getTime();
    cursor += oneDayMs
  ) {
    const currentDate = new Date(cursor).toISOString().slice(0, 10);
    while (
      tradeIndex < trades.length &&
      trades[tradeIndex].tradeDate <= currentDate
    ) {
      applyTrade(trades[tradeIndex]);
      tradeIndex += 1;
    }

    let marketValue = 0;
    let hasPositions = false;
    let hasAnyMarketPrice = false;
    let allQuotesAvailable = true;
    let allFxAvailable = true;

    for (const [key, pos] of positions) {
      if (pos.quantity <= 0) continue;
      hasPositions = true;
      const fx = await fxFor(pos.currency, currentDate);
      if (fx === null) {
        allFxAvailable = false;
        continue;
      }
      const symbol = key.includes(":")
        ? key.slice(key.lastIndexOf(":") + 1)
        : key;
      const historicalClose = closeByTickerDate.get(symbol)?.get(currentDate);
      const quote = historicalClose === undefined
        ? quoteByKey.get(quoteSnapshotKey(symbol, pos.marketCode)) ?? quoteByKey.get(symbol)
        : undefined;
      const close = historicalClose ?? (
        quote && quote.asOf.slice(0, 10) === currentDate ? quote.close : null
      );
      if (close === null) {
        allQuotesAvailable = false;
        continue;
      }
      hasAnyMarketPrice = true;
      marketValue += (Math.round(close * pos.quantity * 100) / 100) * fx;
    }

    // Once repaired daily bars exist, mirror snapshot generation's sparse
    // trading-day series. Calendar days with no observed market price otherwise
    // become null-valued points and keep the trend in a permanent warning state.
    if (hasPositions && hasAnyHistoricalBars && !hasAnyMarketPrice) {
      continue;
    }

    const mv =
      hasPositions && allQuotesAvailable && allFxAvailable ? marketValue : null;
    const finance = datedFinance?.get(currentDate) ?? null;
    const point = finance
      ? buildPerformancePoint({
          date: currentDate,
          marketValueAmount: mv,
          bookCostAmount: finance.bookCostAmount,
          cumulativeRealizedPnlAmount: finance.cumulativeRealizedPnlAmount,
          cumulativeDividendsAmount: finance.cumulativeDividendsAmount,
          fxAvailable: allFxAvailable && finance.fxAvailable,
        })
      : {
          date: currentDate,
          totalCostAmount: null,
          marketValueAmount: mv,
          unrealizedPnlAmount: null,
          cumulativeRealizedPnlAmount: null,
          cumulativeDividendsAmount: null,
          totalReturnAmount: null,
          totalReturnPercent: null,
          fxAvailable: allFxAvailable,
        };
    if (
      (point.totalCostAmount ?? 0) > 0 ||
      point.marketValueAmount !== null ||
      !allFxAvailable
    ) {
      points.push(point);
    }
  }

  return points;
}

function buildPerformancePoint(input: {
  date: string;
  marketValueAmount: number | null;
  bookCostAmount: number | null;
  cumulativeRealizedPnlAmount: number | null;
  cumulativeDividendsAmount: number | null;
  fxAvailable: boolean;
}): DashboardPerformancePointDto {
  const totalReturnAmount =
    input.fxAvailable &&
    input.marketValueAmount !== null &&
    input.bookCostAmount !== null &&
    input.cumulativeRealizedPnlAmount !== null &&
    input.cumulativeDividendsAmount !== null
      ? roundToDecimal(
          input.marketValueAmount +
          input.cumulativeRealizedPnlAmount +
          input.cumulativeDividendsAmount -
          input.bookCostAmount,
          2,
        )
      : null;
  return {
    date: input.date,
    totalCostAmount: input.fxAvailable ? input.bookCostAmount : null,
    marketValueAmount: input.fxAvailable ? input.marketValueAmount : null,
    unrealizedPnlAmount:
      input.fxAvailable && input.marketValueAmount !== null && input.bookCostAmount !== null
        ? roundToDecimal(input.marketValueAmount - input.bookCostAmount, 2)
        : null,
    cumulativeRealizedPnlAmount: input.fxAvailable ? input.cumulativeRealizedPnlAmount : null,
    cumulativeDividendsAmount: input.fxAvailable ? input.cumulativeDividendsAmount : null,
    totalReturnAmount,
    totalReturnPercent:
      totalReturnAmount !== null && input.bookCostAmount !== null && input.bookCostAmount > 0
        ? (totalReturnAmount / input.bookCostAmount) * 100
        : null,
    fxAvailable: input.fxAvailable,
  };
}

async function buildDatedPerformanceFinance(
  store: Store,
  startDate: string,
  endDate: string,
  reportingCurrency: AccountDefaultCurrency,
  persistence: Persistence,
): Promise<Map<string, DatedPerformanceFinancePoint>> {
  const trades = sortTradeEvents(store.accounting.facts.tradeEvents);
  const dividendEntries = sortDividendEntries(store);
  const fxCache = new Map<string, number | null>();
  const positions = new Map<string, PerformancePositionFinance>();
  const points = new Map<string, DatedPerformanceFinancePoint>();
  let tradeIndex = 0;
  let dividendIndex = 0;
  let cumulativeRealizedPnlAmount = 0;
  let cumulativeDividendsAmount = 0;
  let realizedPnlComplete = true;
  let dividendsComplete = true;

  async function fxFor(src: string, date: string): Promise<number | null> {
    if (src === reportingCurrency) return 1.0;
    const cacheKey = `${src}|${date}`;
    if (fxCache.has(cacheKey)) return fxCache.get(cacheKey) ?? null;
    const rate = await persistence.getFxRate(src, reportingCurrency, date);
    fxCache.set(cacheKey, rate);
    return rate;
  }

  async function applyTrade(trade: BookedTradeEvent): Promise<void> {
    const key = performancePositionKey(trade);
    const previous = positions.get(key) ?? {
      quantity: 0,
      bookCostAmount: 0,
      hasMissingBookCost: false,
    };
    const tradeFx = await fxFor(trade.priceCurrency, trade.tradeDate);

    if (trade.type === "BUY") {
      const nativeCost = roundToDecimal(trade.quantity * trade.unitPrice, 2) + trade.commissionAmount + trade.taxAmount;
      positions.set(key, {
        quantity: previous.quantity + trade.quantity,
        bookCostAmount: tradeFx === null
          ? previous.bookCostAmount
          : roundToDecimal(previous.bookCostAmount + nativeCost * tradeFx, 2),
        hasMissingBookCost: previous.hasMissingBookCost || tradeFx === null,
      });
      return;
    }

    const allocatedQuantity = Math.min(trade.quantity, previous.quantity);
    const allocatedBookCost = previous.quantity > 0
      ? roundToDecimal((previous.bookCostAmount / previous.quantity) * allocatedQuantity, 2)
      : 0;
    const proceedsNative = roundToDecimal(trade.quantity * trade.unitPrice, 2) - trade.commissionAmount - trade.taxAmount;
    if (tradeFx === null || previous.hasMissingBookCost) {
      realizedPnlComplete = false;
    } else {
      cumulativeRealizedPnlAmount = roundToDecimal(
        cumulativeRealizedPnlAmount + proceedsNative * tradeFx - allocatedBookCost,
        2,
      );
    }

    const nextQuantity = Math.max(0, previous.quantity - trade.quantity);
    if (nextQuantity === 0) {
      positions.delete(key);
      return;
    }
    positions.set(key, {
      quantity: nextQuantity,
      bookCostAmount: roundToDecimal(Math.max(0, previous.bookCostAmount - allocatedBookCost), 2),
      hasMissingBookCost: previous.hasMissingBookCost,
    });
  }

  async function applyDividend(entry: DatedDividendEntry): Promise<void> {
    const fx = await fxFor(entry.currency, entry.date);
    if (fx === null) {
      dividendsComplete = false;
      return;
    }
    cumulativeDividendsAmount = roundToDecimal(cumulativeDividendsAmount + entry.amount * fx, 2);
  }

  const oneDayMs = 86_400_000;
  for (
    let cursor = new Date(`${startDate}T00:00:00.000Z`).getTime();
    cursor <= new Date(`${endDate}T00:00:00.000Z`).getTime();
    cursor += oneDayMs
  ) {
    const currentDate = new Date(cursor).toISOString().slice(0, 10);
    while (tradeIndex < trades.length && trades[tradeIndex].tradeDate <= currentDate) {
      await applyTrade(trades[tradeIndex]);
      tradeIndex += 1;
    }
    while (dividendIndex < dividendEntries.length && dividendEntries[dividendIndex].date <= currentDate) {
      await applyDividend(dividendEntries[dividendIndex]);
      dividendIndex += 1;
    }

    const hasMissingBookCost = [...positions.values()].some((position) => position.hasMissingBookCost);
    points.set(currentDate, {
      bookCostAmount: hasMissingBookCost
        ? null
        : roundToDecimal([...positions.values()].reduce((sum, position) => sum + position.bookCostAmount, 0), 2),
      cumulativeRealizedPnlAmount: realizedPnlComplete ? cumulativeRealizedPnlAmount : null,
      cumulativeDividendsAmount: dividendsComplete ? cumulativeDividendsAmount : null,
      fxAvailable: !hasMissingBookCost && realizedPnlComplete && dividendsComplete,
    });
  }

  return points;
}

function sortTradeEvents(trades: ReadonlyArray<BookedTradeEvent>): BookedTradeEvent[] {
  return [...trades].sort(
    (a, b) =>
      a.tradeDate.localeCompare(b.tradeDate) ||
      (a.bookingSequence ?? 0) - (b.bookingSequence ?? 0) ||
      (a.tradeTimestamp ?? "").localeCompare(b.tradeTimestamp ?? "") ||
      a.id.localeCompare(b.id),
  );
}

interface DatedDividendEntry {
  date: string;
  amount: number;
  currency: string;
}

function sortDividendEntries(store: Store): DatedDividendEntry[] {
  const eventById = new Map((store.marketData?.dividendEvents ?? []).map((event) => [event.id, event]));
  const ledgerEntries = store.accounting.facts.dividendLedgerEntries ?? [];
  const reversedIds = new Set(
    ledgerEntries
      .map((entry) => entry.reversalOfDividendLedgerEntryId)
      .filter((id): id is string => Boolean(id)),
  );
  return ledgerEntries
    .filter((entry) =>
      entry.postingStatus === "posted" &&
      !entry.reversalOfDividendLedgerEntryId &&
      !entry.supersededAt &&
      !reversedIds.has(entry.id) &&
      entry.receivedCashAmount !== 0)
    .map((entry): DatedDividendEntry | null => {
      const event = eventById.get(entry.dividendEventId);
      if (!event) return null;
      const date = event.paymentDate ?? entry.bookedAt?.slice(0, 10);
      if (!date) return null;
      return {
        date,
        amount: entry.receivedCashAmount,
        currency: event.cashDividendCurrency,
      };
    })
    .filter((entry): entry is DatedDividendEntry => entry !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function performancePositionKey(trade: BookedTradeEvent): string {
  return `${trade.accountId}:${trade.marketCode}:${trade.ticker}`;
}

function translateHoldingGroup(
  group: DashboardOverviewHoldingGroupDto,
  reportingCurrency: AccountDefaultCurrency,
  fx: number | null,
): DashboardOverviewHoldingGroupDto {
  return {
    ...translateHoldingRow(group, reportingCurrency, fx),
    children: group.children.map((child) => translateHoldingRow(child, reportingCurrency, fx)),
  };
}

function translateHoldingRow<T extends DashboardOverviewHoldingGroupDto | DashboardOverviewHoldingChildDto>(
  row: T,
  reportingCurrency: AccountDefaultCurrency,
  fx: number | null,
): T {
  return {
    ...row,
    reportingCurrency,
    reportingCurrentUnitPrice:
      fx === null || row.currentUnitPrice === null ? null : roundToDecimal(row.currentUnitPrice * fx, 4),
    reportingCostBasisAmount: fx === null ? null : roundToDecimal(row.costBasisAmount * fx, 2),
    reportingMarketValueAmount:
      fx === null || row.marketValueAmount === null ? null : roundToDecimal(row.marketValueAmount * fx, 2),
    reportingUnrealizedPnlAmount:
      fx === null || row.unrealizedPnlAmount === null ? null : roundToDecimal(row.unrealizedPnlAmount * fx, 2),
    reportingAllocationPercent: null,
    fxStatus: fx === null ? "missing" : "complete",
    allocationBasisUsed: "market_value",
    allocationBasisFallbackReason: null,
  };
}

function deriveAllocationDetails<T extends DashboardOverviewHoldingGroupDto | DashboardOverviewHoldingChildDto>(
  rows: ReadonlyArray<T>,
  allocationBasis: HoldingAllocationBasis,
): Map<string, {
  reportingAllocationPercent: number | null;
  allocationBasisUsed: HoldingAllocationBasis;
  allocationBasisFallbackReason: "missing_quote" | null;
}> {
  const resolved = rows.map((row) => {
    const detail = resolveAllocationValue(row, allocationBasis);
    return { row, ...detail };
  });
  const total = resolved.reduce((sum, row) => sum + (row.value ?? 0), 0);

  return new Map(
    resolved.map((entry) => [
      allocationRowKey(entry.row),
      {
        reportingAllocationPercent: total > 0 && entry.value !== null
          ? roundToDecimal((entry.value / total) * 100, 4)
          : null,
        allocationBasisUsed: entry.allocationBasisUsed,
        allocationBasisFallbackReason: entry.allocationBasisFallbackReason,
      },
    ]),
  );
}

function resolveAllocationValue(
  row: DashboardOverviewHoldingGroupDto | DashboardOverviewHoldingChildDto,
  allocationBasis: HoldingAllocationBasis,
): {
  value: number | null;
  allocationBasisUsed: HoldingAllocationBasis;
  allocationBasisFallbackReason: "missing_quote" | null;
} {
  if (allocationBasis === "cost_basis") {
    return {
      value: row.reportingCostBasisAmount,
      allocationBasisUsed: "cost_basis",
      allocationBasisFallbackReason: null,
    };
  }

  if (row.reportingMarketValueAmount !== null) {
    return {
      value: row.reportingMarketValueAmount,
      allocationBasisUsed: "market_value",
      allocationBasisFallbackReason: null,
    };
  }

  if (row.quoteStatus === "missing" && row.reportingCostBasisAmount !== null) {
    return {
      value: row.reportingCostBasisAmount,
      allocationBasisUsed: "cost_basis",
      allocationBasisFallbackReason: "missing_quote",
    };
  }

  return {
    value: null,
    allocationBasisUsed: "market_value",
    allocationBasisFallbackReason: null,
  };
}

function applyAllocationDetails<T extends DashboardOverviewHoldingGroupDto | DashboardOverviewHoldingChildDto>(
  row: T,
  detailsByKey: ReadonlyMap<string, {
    reportingAllocationPercent: number | null;
    allocationBasisUsed: HoldingAllocationBasis;
    allocationBasisFallbackReason: "missing_quote" | null;
  }>,
): T {
  const details = detailsByKey.get(allocationRowKey(row));
  if (!details) return row;
  return {
    ...row,
    reportingAllocationPercent: details.reportingAllocationPercent,
    allocationBasisUsed: details.allocationBasisUsed,
    allocationBasisFallbackReason: details.allocationBasisFallbackReason,
  };
}

function allocationRowKey(
  row: DashboardOverviewHoldingGroupDto | DashboardOverviewHoldingChildDto,
): string {
  return "children" in row
    ? `${row.ticker}:${row.marketCode}:group`
    : `${row.accountId}:${row.ticker}:${row.marketCode}:child`;
}
