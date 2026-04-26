import type { Pool } from "pg";

export async function upsertDailyBars(
  pool: Pool,
  bars: Array<{ ticker: string; barDate: string; open: number; high: number; low: number; close: number; volume: number; sourceId?: string }>,
): Promise<number> {
  if (bars.length === 0) return 0;

  const tickers: string[] = [];
  const dates: string[] = [];
  const opens: number[] = [];
  const highs: number[] = [];
  const lows: number[] = [];
  const closes: number[] = [];
  const volumes: number[] = [];
  const sources: string[] = [];
  for (const bar of bars) {
    tickers.push(bar.ticker);
    dates.push(bar.barDate);
    opens.push(bar.open);
    highs.push(bar.high);
    lows.push(bar.low);
    closes.push(bar.close);
    volumes.push(bar.volume);
    // KZO-163: per-row sourceId with 'finmind' fallback. Future-proofs for mixed-provider
    // batches (e.g. KZO-170 mixing US + TW) without behavioral change today.
    sources.push(bar.sourceId ?? "finmind");
  }

  const result = await pool.query(
    `INSERT INTO market_data.daily_bars (ticker, bar_date, open, high, low, close, volume, source, ingested_at)
     SELECT * FROM unnest(
       $1::text[], $2::date[], $3::numeric[], $4::numeric[], $5::numeric[], $6::numeric[], $7::bigint[],
       $8::text[],
       array_fill(CURRENT_TIMESTAMP::timestamp, ARRAY[$9::int])
     )
     ON CONFLICT (ticker, bar_date) DO UPDATE SET
       open = EXCLUDED.open, high = EXCLUDED.high, low = EXCLUDED.low,
       close = EXCLUDED.close, volume = EXCLUDED.volume,
       source = EXCLUDED.source, ingested_at = EXCLUDED.ingested_at`,
    [tickers, dates, opens, highs, lows, closes, volumes, sources, bars.length],
  );
  return result.rowCount ?? 0;
}

export function deriveDividendKey(ev: {
  ticker: string;
  exDividendDate: string;
  cashDividendPerShare: number;
  stockDividendPerShare: number;
  sourceId?: string;
}) {
  const eventType =
    ev.cashDividendPerShare > 0 && ev.stockDividendPerShare > 0
      ? "CASH_AND_STOCK"
      : ev.stockDividendPerShare > 0
        ? "STOCK"
        : "CASH";
  // KZO-163: optional per-event sourceId with 'finmind' fallback. Existing TW dividend keys
  // (e.g. `finmind:00878:2025-01-20:CASH`) preserved because TW events still flow with
  // sourceId='finmind'.
  const source = ev.sourceId ?? "finmind";
  return { eventType, id: `${source}:${ev.ticker}:${ev.exDividendDate}:${eventType}` };
}

export async function upsertDividendEvents(
  pool: Pool,
  events: Array<{
    ticker: string;
    exDividendDate: string;
    paymentDate: string;
    cashDividendPerShare: number;
    stockDividendPerShare: number;
    fiscalYearPeriod?: string;
    announcementDate?: string;
    totalDistributionShares?: number;
    rawProviderData?: Record<string, unknown>;
    sourceId?: string;
  }>,
): Promise<number> {
  if (events.length === 0) return 0;

  // Deduplicate by derived ID — FinMind can return multiple rows for the same
  // ticker+exDate+eventType (e.g. ETF 00878). PostgreSQL ON CONFLICT rejects
  // duplicate keys within a single INSERT batch (error 21000). Last-write-wins.
  const deduped = new Map<string, (typeof events)[number]>();
  for (const ev of events) {
    const { id } = deriveDividendKey(ev);
    deduped.set(id, ev);
  }
  const uniqueEvents = [...deduped.values()];

  const ids: string[] = [];
  const tickers: string[] = [];
  const eventTypes: string[] = [];
  const exDates: string[] = [];
  const payDates: string[] = [];
  const cashAmounts: number[] = [];
  const stockAmounts: number[] = [];
  const sources: string[] = [];
  const fiscalYearPeriods: (string | null)[] = [];
  const announcementDates: (string | null)[] = [];
  const totalDistShares: (number | null)[] = [];
  const rawProviderDataArr: (string | null)[] = [];

  for (const ev of uniqueEvents) {
    const { eventType, id } = deriveDividendKey(ev);
    ids.push(id);
    tickers.push(ev.ticker);
    eventTypes.push(eventType);
    exDates.push(ev.exDividendDate);
    payDates.push(ev.paymentDate);
    cashAmounts.push(ev.cashDividendPerShare);
    stockAmounts.push(ev.stockDividendPerShare);
    sources.push(ev.sourceId ?? "finmind");
    fiscalYearPeriods.push(ev.fiscalYearPeriod ?? null);
    announcementDates.push(ev.announcementDate ?? null);
    totalDistShares.push(ev.totalDistributionShares ?? null);
    rawProviderDataArr.push(ev.rawProviderData ? JSON.stringify(ev.rawProviderData) : null);
  }

  const result = await pool.query(
    `INSERT INTO market_data.dividend_events
       (id, ticker, event_type, ex_dividend_date, payment_date, cash_dividend_per_share, stock_dividend_per_share,
        cash_dividend_currency, source, ingested_at,
        fiscal_year_period, announcement_date, total_distribution_shares, raw_provider_data)
     SELECT * FROM unnest(
       $1::text[], $2::text[], $3::text[], $4::date[], $5::date[], $6::numeric[], $7::numeric[],
       array_fill('TWD'::text, ARRAY[$8::int]),
       $9::text[],
       array_fill(CURRENT_TIMESTAMP::timestamp, ARRAY[$8::int]),
       $10::text[], $11::date[], $12::numeric[], $13::jsonb[]
     )
     ON CONFLICT (id) DO UPDATE SET
       cash_dividend_per_share = EXCLUDED.cash_dividend_per_share,
       stock_dividend_per_share = EXCLUDED.stock_dividend_per_share,
       payment_date = EXCLUDED.payment_date,
       ingested_at = EXCLUDED.ingested_at,
       fiscal_year_period = EXCLUDED.fiscal_year_period,
       announcement_date = EXCLUDED.announcement_date,
       total_distribution_shares = EXCLUDED.total_distribution_shares,
       raw_provider_data = EXCLUDED.raw_provider_data`,
    [ids, tickers, eventTypes, exDates, payDates, cashAmounts, stockAmounts, uniqueEvents.length,
     sources, fiscalYearPeriods, announcementDates, totalDistShares, rawProviderDataArr],
  );
  return result.rowCount ?? 0;
}
