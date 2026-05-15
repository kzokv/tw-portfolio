import { randomUUID } from "node:crypto";
import { roundToDecimal } from "@vakwen/domain";
import type { DailyBar } from "@vakwen/domain";
import type {
  Persistence,
  HoldingSnapshot,
  SnapshotDividendInput,
  SnapshotTradeInput,
} from "../persistence/types.js";
import { routeError } from "../lib/routeError.js";

export interface SnapshotGenerationOptions {
  generationRunId?: string;
}

export interface SnapshotGenerationResult {
  totalRows: number;
  provisionalRows: number;
  dateRange: { from: string; to: string } | null;
  generationRunId: string;
  // KZO-185: walker emits (ticker, marketCode) pairs so producers can stamp
  // `marketCode` on enqueued backfill jobs without per-ticker resolution.
  // Same-ticker-different-market (e.g. BHP/AU + BHP/US in one user) surfaces
  // as two distinct entries because the Map key is composite.
  tickersNeedingBackfill: { ticker: string; marketCode: string }[];
}

/**
 * Generate holding snapshots for all (account, ticker) pairs.
 * Walks trade events chronologically per pair and joins with daily_bars
 * for close prices on each trading day.
 */
export async function generateHoldingSnapshots(
  userId: string,
  persistence: Persistence,
  options: SnapshotGenerationOptions = {},
): Promise<SnapshotGenerationResult> {
  const generationRunId = options.generationRunId ?? randomUUID();
  const now = new Date().toISOString();
  const today = now.slice(0, 10);

  // Delete all existing snapshots for full regeneration
  await persistence.deleteAllHoldingSnapshots(userId);

  // Fetch only the inputs the walker needs — avoids loadStore's full blast radius.
  const inputs = await persistence.getSnapshotGenerationInputs(userId);

  // Group trades by (accountId, ticker). Nested Map keeps the structure
  // tuple-safe so a ticker containing a delimiter like ":" cannot collide
  // with a different (accountId, ticker) pair.
  const tradesByAccountTicker = groupTrades(inputs.trades);
  const dividendsByAccountTicker = groupDividends(inputs.postedDividends);

  // Batch-fetch daily bars for every unique ticker up-front to avoid N+1.
  const uniqueTickers = Array.from(new Set(inputs.trades.map(t => t.ticker)));
  const earliestTradeDate = inputs.trades.length > 0
    ? inputs.trades.reduce((min, t) => t.tradeDate < min ? t.tradeDate : min, inputs.trades[0].tradeDate)
    : today;
  const barsByTicker = uniqueTickers.length > 0
    ? await persistence.getDailyBarsForTickers(uniqueTickers, earliestTradeDate, today)
    : new Map<string, DailyBar[]>();

  const allSnapshots: HoldingSnapshot[] = [];
  // KZO-185: composite key `${ticker}:${marketCode}` so cross-listed tickers
  // (BHP/AU + BHP/US in one user) surface as TWO distinct entries instead of
  // collapsing on `ticker`. Producers (snapshots/generate, recompute/confirm)
  // stamp `marketCode` on each enqueued backfill job from these entries.
  const tickersNeedingBackfill = new Map<string, { ticker: string; marketCode: string }>();

  for (const [accountId, byTicker] of tradesByAccountTicker) {
    for (const [ticker, groupTrades] of byTicker) {
      const bars = barsByTicker.get(ticker) ?? [];
      const dividends = dividendsByAccountTicker.get(accountId)?.get(ticker) ?? [];
      // KZO-185: the (account, ticker) pair has a single marketCode by the
      // currency-coupling rule (walkPositionHistory enforces single
      // priceCurrency at line 193 below; marketCode tracks priceCurrency 1:1).
      const marketCode = groupTrades[0].marketCode;
      const compositeKey = `${ticker}:${marketCode}`;

      const snapshots = walkPositionHistory({
        userId,
        accountId,
        ticker,
        trades: groupTrades,
        bars,
        dividends,
        generationRunId,
        generatedAt: now,
        fromDate: null,
      });

      for (const s of snapshots) {
        if (s.isProvisional) tickersNeedingBackfill.set(compositeKey, { ticker, marketCode });
        allSnapshots.push(s);
      }

      // If the ticker has no bars at all, flag for backfill even when the
      // walker didn't emit a provisional row (e.g., no dates to walk).
      if (bars.length === 0) tickersNeedingBackfill.set(compositeKey, { ticker, marketCode });
    }
  }

  if (allSnapshots.length > 0) {
    await persistence.bulkUpsertHoldingSnapshots(userId, allSnapshots);
  }

  const dates = allSnapshots.map(s => s.snapshotDate).sort();
  return {
    totalRows: allSnapshots.length,
    provisionalRows: allSnapshots.filter(s => s.isProvisional).length,
    dateRange: dates.length > 0 ? { from: dates[0], to: dates[dates.length - 1] } : null,
    generationRunId,
    tickersNeedingBackfill: [...tickersNeedingBackfill.values()],
  };
}

/**
 * Scoped recompute: delete snapshots for a specific (account, ticker) from
 * `fromDate`, then regenerate from that date forward. Position state is
 * rebuilt by walking all trades from the beginning so cumulative values at
 * `fromDate` are correct, but only snapshots on or after `fromDate` are
 * written back.
 */
export async function recomputeSnapshotsForTicker(
  userId: string,
  accountId: string,
  ticker: string,
  fromDate: string,
  persistence: Persistence,
): Promise<SnapshotGenerationResult> {
  const generationRunId = randomUUID();
  const now = new Date().toISOString();
  const today = now.slice(0, 10);

  // Delete existing snapshots from the affected date forward
  await persistence.deleteHoldingSnapshotsForTicker(userId, accountId, ticker, fromDate);

  const inputs = await persistence.getSnapshotGenerationInputs(userId, { accountId, ticker });
  if (inputs.trades.length === 0) {
    return { totalRows: 0, provisionalRows: 0, dateRange: null, generationRunId, tickersNeedingBackfill: [] };
  }

  const firstTradeDate = inputs.trades[0].tradeDate;
  const bars = await persistence.getDailyBarsForTicker(ticker, firstTradeDate, today);

  const snapshots = walkPositionHistory({
    userId,
    accountId,
    ticker,
    trades: inputs.trades,
    bars,
    dividends: inputs.postedDividends,
    generationRunId,
    generatedAt: now,
    fromDate,
  });

  // KZO-185: composite-key Map mirrors the full-regen walker. We know
  // `inputs.trades.length > 0` from the early return above, so reading
  // `inputs.trades[0].marketCode` is safe.
  const marketCode = inputs.trades[0].marketCode;
  const compositeKey = `${ticker}:${marketCode}`;
  const tickersNeedingBackfill = new Map<string, { ticker: string; marketCode: string }>();
  if (bars.length === 0) tickersNeedingBackfill.set(compositeKey, { ticker, marketCode });
  for (const s of snapshots) {
    if (s.isProvisional) tickersNeedingBackfill.set(compositeKey, { ticker, marketCode });
  }

  if (snapshots.length > 0) {
    await persistence.bulkUpsertHoldingSnapshots(userId, snapshots);
  }

  const dates = snapshots.map(s => s.snapshotDate).sort();
  return {
    totalRows: snapshots.length,
    provisionalRows: snapshots.filter(s => s.isProvisional).length,
    dateRange: dates.length > 0 ? { from: dates[0], to: dates[dates.length - 1] } : null,
    generationRunId,
    tickersNeedingBackfill: [...tickersNeedingBackfill.values()],
  };
}

// ── Walker ──────────────────────────────────────────────────────────────────

interface WalkerParams {
  userId: string;
  accountId: string;
  ticker: string;
  trades: SnapshotTradeInput[];
  bars: DailyBar[];
  dividends: SnapshotDividendInput[];
  generationRunId: string;
  generatedAt: string;
  /** When non-null, only emit snapshots whose date ≥ fromDate. */
  fromDate: string | null;
}

function walkPositionHistory(params: WalkerParams): HoldingSnapshot[] {
  const { userId, accountId, ticker, trades, bars, dividends, generationRunId, generatedAt, fromDate } = params;

  // KZO-165: validate single priceCurrency across all trades for this (account, ticker).
  // Mixed values are an upstream data bug — an instrument has one quote currency, and the
  // walker must surface this clearly rather than silently picking the first/last value.
  // No-op when trades is empty (the loop in generateHoldingSnapshots only enters this
  // function for groups with at least one trade).
  if (trades.length === 0) {
    // Defensive — walker isn't called with empty trades today, but keep the guard so
    // future callers don't trip over `trades[0]` below.
    return [];
  }
  const nativeCurrency = trades[0].priceCurrency;
  for (const t of trades) {
    if (t.priceCurrency !== nativeCurrency) {
      throw routeError(
        500,
        "snapshot_mixed_currency",
        `Mixed priceCurrency for (account=${accountId}, ticker=${ticker}): saw "${nativeCurrency}" and "${t.priceCurrency}"`,
      );
    }
  }

  const barByDate = new Map(bars.map(b => [b.barDate, b]));
  const tradingDays = bars.map(b => b.barDate);
  const hasBars = tradingDays.length > 0;

  // Walk every date on which *something* could happen: a trading day or a
  // trade date. Snapshots are only emitted on trading days (unless the ticker
  // has no bars at all, in which case we emit a provisional row on each trade
  // date so the user still gets a visible data point).
  const allDates = new Set([...tradingDays, ...trades.map(t => t.tradeDate)]);
  const sortedDates = [...allDates].sort();

  let quantity = 0;
  let costBasis = 0;
  let cumulativeRealizedPnl = 0;
  let tradeIdx = 0;
  let dividendIdx = 0;
  let cumulativeDividends = 0;

  const snapshots: HoldingSnapshot[] = [];

  for (const date of sortedDates) {
    // Apply every trade on or before this date.
    while (tradeIdx < trades.length && trades[tradeIdx].tradeDate <= date) {
      const trade = trades[tradeIdx];
      if (trade.type === "BUY") {
        const tradeCost = roundToDecimal(trade.quantity * trade.unitPrice, 2) + trade.commissionAmount + trade.taxAmount;
        costBasis = roundToDecimal(costBasis + tradeCost, 2);
        quantity += trade.quantity;
      } else if (quantity > 0) {
        // SELL — proportional cost basis reduction. If quantity is already 0
        // we silently skip (long-only tracker; shorting is out of scope).
        const costPerShare = costBasis / quantity;
        const allocatedCost = roundToDecimal(costPerShare * trade.quantity, 2);
        const proceeds = roundToDecimal(trade.quantity * trade.unitPrice, 2) - trade.commissionAmount - trade.taxAmount;
        cumulativeRealizedPnl = roundToDecimal(cumulativeRealizedPnl + (proceeds - allocatedCost), 2);
        costBasis = Math.max(0, roundToDecimal(costBasis - allocatedCost, 2));
        quantity = Math.max(0, quantity - trade.quantity);
      } else {
        quantity = Math.max(0, quantity - trade.quantity);
      }
      tradeIdx++;
    }

    // Accumulate dividends paid on or before this date.
    while (dividendIdx < dividends.length && dividends[dividendIdx].paymentDate <= date) {
      cumulativeDividends = roundToDecimal(cumulativeDividends + dividends[dividendIdx].amount, 2);
      dividendIdx++;
    }

    // Emit snapshots: skip trade-only dates unless the ticker has no bars at
    // all (provisional fallback), and respect the fromDate gate.
    const bar = barByDate.get(date);
    if (!bar && hasBars) continue;
    if (fromDate !== null && date < fromDate) continue;

    const closePrice = bar?.close ?? null;
    // KZO-165: compute native columns at the precision specified in D9.
    // value_native: 4-decimal precision (matches close_price * quantity granularity).
    // cost_basis_native: walker already accumulates in native — assign directly.
    // unrealized_pnl_native: 2-decimal precision; null when valueNative is null.
    const valueNative = closePrice !== null && quantity > 0
      ? roundToDecimal(closePrice * quantity, 4)
      : null;
    const costBasisNative = costBasis;
    const unrealizedPnlNative = valueNative !== null
      ? roundToDecimal(valueNative - costBasisNative, 2)
      : null;
    const providerSource = bar?.source ?? null;
    const isProvisional = closePrice === null;

    // KZO-165 D6: dual-write legacy columns from native source values. For TWD-only
    // data this is a no-op behavioral change (legacy values were already native);
    // sets the precedent so KZO-176 can drop the legacy columns cleanly.
    snapshots.push({
      id: randomUUID(),
      userId,
      accountId,
      ticker,
      snapshotDate: date,
      quantity,
      closePrice,
      // Dual-write: legacy `marketValue` mirrors `valueNative` exactly until
      // KZO-176 removes the legacy column.
      marketValue: valueNative,
      costBasis: costBasisNative,
      unrealizedPnl: unrealizedPnlNative,
      cumulativeRealizedPnl,
      cumulativeDividends,
      isProvisional,
      currency: nativeCurrency,
      valueNative,
      costBasisNative,
      unrealizedPnlNative,
      providerSource,
      generatedAt,
      generationRunId,
    });
  }

  return snapshots;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function groupTrades(trades: SnapshotTradeInput[]): Map<string, Map<string, SnapshotTradeInput[]>> {
  const result = new Map<string, Map<string, SnapshotTradeInput[]>>();
  for (const trade of trades) {
    let byTicker = result.get(trade.accountId);
    if (!byTicker) {
      byTicker = new Map();
      result.set(trade.accountId, byTicker);
    }
    const list = byTicker.get(trade.ticker) ?? [];
    list.push(trade);
    byTicker.set(trade.ticker, list);
  }
  return result;
}

function groupDividends(dividends: SnapshotDividendInput[]): Map<string, Map<string, SnapshotDividendInput[]>> {
  const result = new Map<string, Map<string, SnapshotDividendInput[]>>();
  for (const div of dividends) {
    let byTicker = result.get(div.accountId);
    if (!byTicker) {
      byTicker = new Map();
      result.set(div.accountId, byTicker);
    }
    const list = byTicker.get(div.ticker) ?? [];
    list.push(div);
    byTicker.set(div.ticker, list);
  }
  return result;
}
