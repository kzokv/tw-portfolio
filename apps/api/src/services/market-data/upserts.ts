import type { Pool } from "pg";
import type { DailyBarQuality, MarketCode } from "@vakwen/domain";
import { currencyFor } from "@vakwen/shared-types";

export async function upsertDailyBars(
  pool: Pool,
  bars: Array<{
    ticker: string;
    marketCode: MarketCode;
    barDate: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    quality?: DailyBarQuality;
    sourceId?: string;
  }>,
): Promise<number> {
  if (bars.length === 0) return 0;

  const tickers: string[] = [];
  const marketCodes: string[] = [];
  const dates: string[] = [];
  const opens: number[] = [];
  const highs: number[] = [];
  const lows: number[] = [];
  const closes: number[] = [];
  const volumes: number[] = [];
  const qualities: DailyBarQuality[] = [];
  const sources: string[] = [];
  for (const bar of bars) {
    tickers.push(bar.ticker);
    marketCodes.push(bar.marketCode);
    dates.push(bar.barDate);
    opens.push(bar.open);
    highs.push(bar.high);
    lows.push(bar.low);
    closes.push(bar.close);
    volumes.push(bar.volume);
    qualities.push(bar.quality ?? "full_bar");
    // KZO-163: per-row sourceId with 'finmind' fallback. Future-proofs for mixed-provider
    // batches (e.g. KZO-170 mixing US + TW) without behavioral change today.
    sources.push(bar.sourceId ?? "finmind");
  }

  // KZO-169: composite PK after migration 044 — INSERT now stamps market_code
  // and ON CONFLICT keys on (ticker, market_code, bar_date).
  const result = await pool.query(
    `INSERT INTO market_data.daily_bars (
       ticker, market_code, bar_date, open, high, low, close, volume, quality, source, ingested_at
     )
     SELECT * FROM unnest(
       $1::text[], $2::text[], $3::date[], $4::numeric[], $5::numeric[], $6::numeric[], $7::numeric[], $8::bigint[],
       $9::text[], $10::text[],
       array_fill(CURRENT_TIMESTAMP::timestamp, ARRAY[$11::int])
     )
     ON CONFLICT (ticker, market_code, bar_date) DO UPDATE SET
       open = EXCLUDED.open, high = EXCLUDED.high, low = EXCLUDED.low,
       close = EXCLUDED.close, volume = EXCLUDED.volume,
       quality = EXCLUDED.quality,
       source = EXCLUDED.source, ingested_at = EXCLUDED.ingested_at
     WHERE market_data.daily_bars.quality <> 'full_bar' OR EXCLUDED.quality = 'full_bar'`,
    [tickers, marketCodes, dates, opens, highs, lows, closes, volumes, qualities, sources, bars.length],
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
    marketCode: MarketCode;
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
  const marketCodes: string[] = [];
  const eventTypes: string[] = [];
  const exDates: string[] = [];
  const payDates: string[] = [];
  const cashAmounts: number[] = [];
  const stockAmounts: number[] = [];
  // KZO-170 D1: per-row cash dividend currency, derived from each event's marketCode.
  // Replaces the previous `array_fill('TWD'::text, ARRAY[$N::int])` hardcode that broke
  // multi-market correctness — a US/AU dividend would silently land with `TWD`.
  // `currencyFor("TW") === "TWD"`, so TW behavior is preserved exactly.
  const currencies: string[] = [];
  const sources: string[] = [];
  const fiscalYearPeriods: (string | null)[] = [];
  const announcementDates: (string | null)[] = [];
  const totalDistShares: (number | null)[] = [];
  const rawProviderDataArr: (string | null)[] = [];

  for (const ev of uniqueEvents) {
    const { eventType, id } = deriveDividendKey(ev);
    ids.push(id);
    tickers.push(ev.ticker);
    marketCodes.push(ev.marketCode);
    eventTypes.push(eventType);
    exDates.push(ev.exDividendDate);
    payDates.push(ev.paymentDate);
    cashAmounts.push(ev.cashDividendPerShare);
    stockAmounts.push(ev.stockDividendPerShare);
    currencies.push(currencyFor(ev.marketCode));
    sources.push(ev.sourceId ?? "finmind");
    fiscalYearPeriods.push(ev.fiscalYearPeriod ?? null);
    announcementDates.push(ev.announcementDate ?? null);
    totalDistShares.push(ev.totalDistributionShares ?? null);
    rawProviderDataArr.push(ev.rawProviderData ? JSON.stringify(ev.rawProviderData) : null);
  }

  // KZO-169: stamp market_code on every dividend row. ON CONFLICT keys on
  // `id` (still unique post-044) — column add was non-PK on dividend_events.
  // KZO-170 D1: `cash_dividend_currency` now comes from a per-row `$15::text[]`
  // (currencies, derived from marketCode via `currencyFor`), not a hardcoded TWD array_fill.
  const result = await pool.query(
    `INSERT INTO market_data.dividend_events
       (id, ticker, market_code, event_type, ex_dividend_date, payment_date, cash_dividend_per_share, stock_dividend_per_share,
        cash_dividend_currency, source, ingested_at,
        fiscal_year_period, announcement_date, total_distribution_shares, raw_provider_data)
     SELECT * FROM unnest(
       $1::text[], $2::text[], $3::text[], $4::text[], $5::date[], $6::date[], $7::numeric[], $8::numeric[],
       $15::text[],
       $10::text[],
       array_fill(CURRENT_TIMESTAMP::timestamp, ARRAY[$9::int]),
       $11::text[], $12::date[], $13::numeric[], $14::jsonb[]
     )
     ON CONFLICT (id) DO UPDATE SET
       cash_dividend_per_share = EXCLUDED.cash_dividend_per_share,
       stock_dividend_per_share = EXCLUDED.stock_dividend_per_share,
       cash_dividend_currency = EXCLUDED.cash_dividend_currency,
       payment_date = EXCLUDED.payment_date,
       ingested_at = EXCLUDED.ingested_at,
       fiscal_year_period = EXCLUDED.fiscal_year_period,
       announcement_date = EXCLUDED.announcement_date,
       total_distribution_shares = EXCLUDED.total_distribution_shares,
       raw_provider_data = EXCLUDED.raw_provider_data`,
    [ids, tickers, marketCodes, eventTypes, exDates, payDates, cashAmounts, stockAmounts, uniqueEvents.length,
     sources, fiscalYearPeriods, announcementDates, totalDistShares, rawProviderDataArr, currencies],
  );
  return result.rowCount ?? 0;
}
