import type { Pool } from "pg";
import type { PgBoss, JobWithMetadata } from "pg-boss";
import type { BackfillStatus } from "@tw-portfolio/domain";
import type { BufferedEventBus } from "../../events/index.js";
import type { FinMindProvider } from "./types.js";
import type { RateLimiter } from "./rateLimiter.js";

export const BACKFILL_QUEUE = "finmind-backfill";

export interface BackfillJobData {
  ticker: string;
  userId: string;
  trigger: "user_selection" | "first_trade" | "retry";
}

export interface BackfillWorkerDeps {
  pool: Pool;
  finmind: FinMindProvider;
  rateLimiter: RateLimiter;
  eventBus: BufferedEventBus;
  boss: PgBoss;
  updateBackfillStatus: (ticker: string, status: BackfillStatus) => Promise<void>;
  log: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
}

/** Number of FinMind API calls per ticker (bars + dividends). */
const CALLS_PER_TICKER = 2;

async function upsertDailyBars(
  pool: Pool,
  bars: Array<{ ticker: string; barDate: string; open: number; high: number; low: number; close: number; volume: number }>,
): Promise<number> {
  if (bars.length === 0) return 0;
  // Batch upsert using unnest for performance
  const tickers: string[] = [];
  const dates: string[] = [];
  const opens: number[] = [];
  const highs: number[] = [];
  const lows: number[] = [];
  const closes: number[] = [];
  const volumes: number[] = [];
  for (const bar of bars) {
    tickers.push(bar.ticker);
    dates.push(bar.barDate);
    opens.push(bar.open);
    highs.push(bar.high);
    lows.push(bar.low);
    closes.push(bar.close);
    volumes.push(bar.volume);
  }
  const result = await pool.query(
    `INSERT INTO market_data.daily_bars (ticker, bar_date, open, high, low, close, volume, source, ingested_at)
     SELECT * FROM unnest(
       $1::text[], $2::date[], $3::numeric[], $4::numeric[], $5::numeric[], $6::numeric[], $7::bigint[],
       array_fill('finmind'::text, ARRAY[$8]),
       array_fill(CURRENT_TIMESTAMP::timestamp, ARRAY[$8])
     )
     ON CONFLICT (ticker, bar_date) DO UPDATE SET
       open = EXCLUDED.open, high = EXCLUDED.high, low = EXCLUDED.low,
       close = EXCLUDED.close, volume = EXCLUDED.volume,
       source = EXCLUDED.source, ingested_at = EXCLUDED.ingested_at`,
    [tickers, dates, opens, highs, lows, closes, volumes, bars.length],
  );
  return result.rowCount ?? 0;
}

/** Derive event type and deterministic ID for a dividend record. */
function deriveDividendKey(ev: { ticker: string; exDividendDate: string; cashDividendPerShare: number; stockDividendPerShare: number }) {
  const eventType =
    ev.cashDividendPerShare > 0 && ev.stockDividendPerShare > 0
      ? "CASH_AND_STOCK"
      : ev.stockDividendPerShare > 0
        ? "STOCK"
        : "CASH";
  return { eventType, id: `finmind:${ev.ticker}:${ev.exDividendDate}:${eventType}` };
}

async function upsertDividendEvents(
  pool: Pool,
  events: Array<{ ticker: string; exDividendDate: string; paymentDate: string; cashDividendPerShare: number; stockDividendPerShare: number }>,
): Promise<number> {
  if (events.length === 0) return 0;

  // Batch upsert using unnest (mirrors upsertDailyBars pattern)
  const ids: string[] = [];
  const tickers: string[] = [];
  const eventTypes: string[] = [];
  const exDates: string[] = [];
  const payDates: string[] = [];
  const cashAmounts: number[] = [];
  const stockAmounts: number[] = [];

  for (const ev of events) {
    const { eventType, id } = deriveDividendKey(ev);
    ids.push(id);
    tickers.push(ev.ticker);
    eventTypes.push(eventType);
    exDates.push(ev.exDividendDate);
    payDates.push(ev.paymentDate);
    cashAmounts.push(ev.cashDividendPerShare);
    stockAmounts.push(ev.stockDividendPerShare);
  }

  const result = await pool.query(
    `INSERT INTO market_data.dividend_events
       (id, ticker, event_type, ex_dividend_date, payment_date, cash_dividend_per_share, stock_dividend_per_share, cash_dividend_currency, source, ingested_at)
     SELECT * FROM unnest(
       $1::text[], $2::text[], $3::text[], $4::date[], $5::date[], $6::numeric[], $7::numeric[],
       array_fill('TWD'::text, ARRAY[$8]),
       array_fill('finmind'::text, ARRAY[$8]),
       array_fill(CURRENT_TIMESTAMP::timestamp, ARRAY[$8])
     )
     ON CONFLICT (id) DO UPDATE SET
       cash_dividend_per_share = EXCLUDED.cash_dividend_per_share,
       stock_dividend_per_share = EXCLUDED.stock_dividend_per_share,
       payment_date = EXCLUDED.payment_date,
       ingested_at = EXCLUDED.ingested_at`,
    [ids, tickers, eventTypes, exDates, payDates, cashAmounts, stockAmounts, events.length],
  );
  return result.rowCount ?? 0;
}

export function createBackfillHandler(deps: BackfillWorkerDeps) {
  const { pool, finmind, rateLimiter, eventBus, boss, updateBackfillStatus, log } = deps;

  return async ([job]: JobWithMetadata<BackfillJobData>[]): Promise<void> => {
    const { ticker, userId, trigger } = job.data;

    // 1. Check rate limiter — if budget exhausted, reschedule (not a retry)
    if (!rateLimiter.canConsume(CALLS_PER_TICKER)) {
      const delayMs = rateLimiter.msUntilAvailable(CALLS_PER_TICKER);
      const delaySec = Math.ceil(delayMs / 1000);
      log.info({ ticker, trigger, delaySec }, "backfill_rate_limited: rescheduling");
      await boss.send(BACKFILL_QUEUE, job.data, {
        startAfter: delaySec,
        singletonKey: ticker,
        priority: 0,
      });
      return; // Complete current job successfully — this is NOT a retry
    }

    rateLimiter.consume(CALLS_PER_TICKER);

    try {
      // 2. Update status → backfilling
      await updateBackfillStatus(ticker, "backfilling");

      // 3. Emit SSE: backfill_started
      await eventBus.publishEvent(userId, "backfill_started", { ticker });

      // 4. Fetch daily bars from FinMind
      log.info({ ticker, trigger }, "backfill_fetching_bars");
      const bars = await finmind.fetchDailyBars(ticker);

      // 5. Write bars to market_data.daily_bars (upsert)
      const barsCount = await upsertDailyBars(pool, bars);
      log.info({ ticker, barsCount }, "backfill_bars_upserted");

      // 6. Fetch dividend events from FinMind
      let dividendsCount = 0;
      try {
        const dividends = await finmind.fetchDividendEvents(ticker);
        // 7. Write dividend events (dividend failure → log warning, don't fail job)
        dividendsCount = await upsertDividendEvents(pool, dividends);
        log.info({ ticker, dividendsCount }, "backfill_dividends_upserted");
      } catch (divErr) {
        log.warn({ ticker, error: divErr }, "backfill_dividend_fetch_failed: continuing without dividends");
      }

      // 8. Update status → ready, update last_synced_at
      await updateBackfillStatus(ticker, "ready");

      // 9. Emit SSE: backfill_complete
      await eventBus.publishEvent(userId, "backfill_complete", {
        ticker,
        barsCount,
        dividendsCount,
      });
    } catch (err) {
      const isLastRetry = job.retryCount >= job.retryLimit;
      const reason = err instanceof Error ? err.message : String(err);

      if (isLastRetry) {
        await updateBackfillStatus(ticker, "failed");
      }

      await eventBus.publishEvent(userId, "backfill_failed", {
        ticker,
        reason,
        retriesExhausted: isLastRetry,
      });

      throw err; // Re-throw so pg-boss handles retry
    }
  };
}
