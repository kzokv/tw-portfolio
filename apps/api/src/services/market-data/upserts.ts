import type { Pool } from "pg";

export async function upsertDailyBars(
  pool: Pool,
  bars: Array<{ ticker: string; barDate: string; open: number; high: number; low: number; close: number; volume: number }>,
): Promise<number> {
  if (bars.length === 0) return 0;

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

export function deriveDividendKey(ev: {
  ticker: string;
  exDividendDate: string;
  cashDividendPerShare: number;
  stockDividendPerShare: number;
}) {
  const eventType =
    ev.cashDividendPerShare > 0 && ev.stockDividendPerShare > 0
      ? "CASH_AND_STOCK"
      : ev.stockDividendPerShare > 0
        ? "STOCK"
        : "CASH";
  return { eventType, id: `finmind:${ev.ticker}:${ev.exDividendDate}:${eventType}` };
}

export async function upsertDividendEvents(
  pool: Pool,
  events: Array<{ ticker: string; exDividendDate: string; paymentDate: string; cashDividendPerShare: number; stockDividendPerShare: number }>,
): Promise<number> {
  if (events.length === 0) return 0;

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
