-- Create market_data schema, migrate public.symbols → market_data.instruments,
-- public.dividend_events → market_data.dividend_events, and add market_data.daily_bars.

BEGIN;

-- 1. Schema and grants
CREATE SCHEMA IF NOT EXISTS market_data;
GRANT USAGE ON SCHEMA market_data TO current_user;

-- 2. Create market_data.instruments
CREATE TABLE market_data.instruments (
  ticker TEXT PRIMARY KEY,
  instrument_type TEXT CHECK (instrument_type IS NULL OR instrument_type IN ('STOCK', 'ETF', 'BOND_ETF')),
  market_code TEXT NOT NULL DEFAULT 'TW' CHECK (market_code ~ '^[A-Z]{2,10}$'),
  name TEXT,
  is_provisional BOOLEAN NOT NULL DEFAULT FALSE,
  type_raw TEXT,
  industry_category_raw TEXT,
  finmind_date TEXT,
  delisted_at TIMESTAMP,
  status_reason TEXT,
  bars_backfill_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (bars_backfill_status IN ('pending', 'backfilling', 'ready', 'failed')),
  last_synced_at TIMESTAMP,
  verification_status TEXT NOT NULL DEFAULT 'unverified'
    CHECK (verification_status IN ('unverified', 'verified', 'mismatch')),
  verification_note TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_instruments_market_code_ticker
  ON market_data.instruments(market_code, ticker);
CREATE INDEX idx_instruments_backfill_pending
  ON market_data.instruments(bars_backfill_status)
  WHERE bars_backfill_status != 'ready';

-- 3. Migrate data from public.symbols → market_data.instruments, then drop
INSERT INTO market_data.instruments (
  ticker, instrument_type, market_code, is_provisional, last_synced_at,
  bars_backfill_status, verification_status, created_at, updated_at
)
SELECT ticker, instrument_type, market_code, is_provisional, last_synced_at,
  'pending', 'unverified', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM public.symbols
ON CONFLICT (ticker) DO NOTHING;

DROP INDEX IF EXISTS idx_symbols_market_code_ticker;
DROP TABLE IF EXISTS public.symbols;

-- 4. Create market_data.daily_bars
CREATE TABLE market_data.daily_bars (
  ticker TEXT NOT NULL,
  bar_date DATE NOT NULL,
  open NUMERIC(20, 4) NOT NULL,
  high NUMERIC(20, 4) NOT NULL,
  low NUMERIC(20, 4) NOT NULL,
  close NUMERIC(20, 4) NOT NULL,
  volume BIGINT NOT NULL,
  source TEXT NOT NULL DEFAULT 'finmind',
  ingested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (ticker, bar_date)
);

CREATE INDEX idx_daily_bars_ticker_date
  ON market_data.daily_bars(ticker, bar_date DESC);

-- 5. Create market_data.dividend_events
CREATE TABLE market_data.dividend_events (
  id TEXT PRIMARY KEY,
  ticker TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('CASH', 'STOCK', 'CASH_AND_STOCK')),
  ex_dividend_date DATE NOT NULL,
  payment_date DATE NOT NULL,
  cash_dividend_per_share NUMERIC(20, 6) NOT NULL DEFAULT 0
    CHECK (cash_dividend_per_share >= 0),
  stock_dividend_per_share NUMERIC(20, 6) NOT NULL DEFAULT 0
    CHECK (stock_dividend_per_share >= 0),
  cash_dividend_currency TEXT NOT NULL CHECK (cash_dividend_currency ~ '^[A-Z]{3}$'),
  source TEXT NOT NULL DEFAULT 'finmind',
  source_reference TEXT,
  ingested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (payment_date >= ex_dividend_date),
  CHECK (
    (event_type = 'CASH' AND cash_dividend_per_share > 0 AND stock_dividend_per_share = 0)
    OR (event_type = 'STOCK' AND cash_dividend_per_share = 0 AND stock_dividend_per_share > 0)
    OR (event_type = 'CASH_AND_STOCK' AND cash_dividend_per_share > 0 AND stock_dividend_per_share > 0)
  )
);

CREATE INDEX idx_md_dividend_events_ticker_ex_date
  ON market_data.dividend_events(ticker, ex_dividend_date);

-- 6. Migrate public.dividend_events → market_data.dividend_events (CRITICAL FK ordering)

-- Step A: Insert data (created_at → ingested_at)
INSERT INTO market_data.dividend_events (
  id, ticker, event_type, ex_dividend_date, payment_date,
  cash_dividend_per_share, stock_dividend_per_share,
  cash_dividend_currency, source, source_reference, ingested_at
)
SELECT id, ticker, event_type, ex_dividend_date, payment_date,
  cash_dividend_per_share, stock_dividend_per_share,
  cash_dividend_currency, source, source_reference, created_at
FROM public.dividend_events
ON CONFLICT (id) DO NOTHING;

-- Step B: Add NEW FK on dividend_ledger_entries → market_data.dividend_events
ALTER TABLE dividend_ledger_entries
  ADD CONSTRAINT fk_dle_md_dividend_event
  FOREIGN KEY (dividend_event_id) REFERENCES market_data.dividend_events(id);

-- Step C: Drop OLD FK
ALTER TABLE dividend_ledger_entries
  DROP CONSTRAINT IF EXISTS dividend_ledger_entries_dividend_event_id_fkey;

-- Step D: Drop old table and indexes
DROP INDEX IF EXISTS idx_dividend_events_ticker_ex_dividend_date;
DROP INDEX IF EXISTS idx_dividend_events_payment_date;
DROP INDEX IF EXISTS ux_dividend_events_ticker_source_reference;
DROP TABLE IF EXISTS public.dividend_events;

COMMIT;
