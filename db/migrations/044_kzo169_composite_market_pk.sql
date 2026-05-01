-- KZO-169: composite (ticker, market_code) PK on market_data.instruments and
-- market_data.daily_bars; add market_code to market_data.dividend_events and
-- user_monitored_tickers (PK rewrite). Forward-only — no down migration.
--
-- Idempotent. DO $$ guard pattern mirrors migration 039 and 018's market_data
-- shape. Existing rows backfilled implicitly by NOT NULL DEFAULT 'TW' on each
-- ADD COLUMN step; market_data.instruments already carries market_code from
-- migration 018, so its column add is omitted.
--
-- Applied tables:
--   market_data.instruments         — PK (ticker) → (ticker, market_code)
--   market_data.daily_bars          — add market_code; PK (ticker, bar_date)
--                                       → (ticker, market_code, bar_date)
--   market_data.dividend_events     — add market_code + CHECK + composite index
--   user_monitored_tickers          — add market_code; PK (user_id, ticker)
--                                       → (user_id, ticker, market_code);
--                                       FK to instruments rewritten to composite.

BEGIN;

-- ── 1. user_monitored_tickers — drop FK that depends on instruments(ticker)
--      uniqueness so we can rewrite the parent PK in step 2. Recreated below
--      in step 5 with the composite key.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_umt_instrument'
      AND table_name = 'user_monitored_tickers'
  ) THEN
    ALTER TABLE user_monitored_tickers DROP CONSTRAINT fk_umt_instrument;
  END IF;
END $$;

-- ── 2. market_data.instruments — PK rewrite (ticker → (ticker, market_code)).
--      market_code column already exists from migration 018 with NOT NULL
--      DEFAULT 'TW', so no column add required.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'instruments_pkey'
      AND table_schema = 'market_data'
      AND table_name = 'instruments'
  ) THEN
    ALTER TABLE market_data.instruments DROP CONSTRAINT instruments_pkey;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'instruments_pkey'
      AND table_schema = 'market_data'
      AND table_name = 'instruments'
  ) THEN
    ALTER TABLE market_data.instruments
      ADD CONSTRAINT instruments_pkey PRIMARY KEY (ticker, market_code);
  END IF;
END $$;

-- ── 3. market_data.daily_bars — add market_code; PK rewrite to
--      (ticker, market_code, bar_date).

ALTER TABLE market_data.daily_bars
  ADD COLUMN IF NOT EXISTS market_code TEXT NOT NULL DEFAULT 'TW';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ck_daily_bars_market_code'
      AND conrelid = 'market_data.daily_bars'::regclass
  ) THEN
    ALTER TABLE market_data.daily_bars
      ADD CONSTRAINT ck_daily_bars_market_code
      CHECK (market_code ~ '^[A-Z]{2,10}$');
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'daily_bars_pkey'
      AND table_schema = 'market_data'
      AND table_name = 'daily_bars'
  ) THEN
    ALTER TABLE market_data.daily_bars DROP CONSTRAINT daily_bars_pkey;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'daily_bars_pkey'
      AND table_schema = 'market_data'
      AND table_name = 'daily_bars'
  ) THEN
    ALTER TABLE market_data.daily_bars
      ADD CONSTRAINT daily_bars_pkey PRIMARY KEY (ticker, market_code, bar_date);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_daily_bars_ticker_market_date
  ON market_data.daily_bars(ticker, market_code, bar_date DESC);

-- ── 4. market_data.dividend_events — add market_code column + CHECK + index.

ALTER TABLE market_data.dividend_events
  ADD COLUMN IF NOT EXISTS market_code TEXT NOT NULL DEFAULT 'TW';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ck_dividend_events_market_code'
      AND conrelid = 'market_data.dividend_events'::regclass
  ) THEN
    ALTER TABLE market_data.dividend_events
      ADD CONSTRAINT ck_dividend_events_market_code
      CHECK (market_code ~ '^[A-Z]{2,10}$');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_md_dividend_events_ticker_market_ex_date
  ON market_data.dividend_events(ticker, market_code, ex_dividend_date);

-- ── 5. user_monitored_tickers — add market_code; PK rewrite to
--      (user_id, ticker, market_code). Recreate FK to instruments composite PK.

ALTER TABLE user_monitored_tickers
  ADD COLUMN IF NOT EXISTS market_code TEXT NOT NULL DEFAULT 'TW';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ck_user_monitored_tickers_market_code'
      AND conrelid = 'user_monitored_tickers'::regclass
  ) THEN
    ALTER TABLE user_monitored_tickers
      ADD CONSTRAINT ck_user_monitored_tickers_market_code
      CHECK (market_code ~ '^[A-Z]{2,10}$');
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'user_monitored_tickers_pkey'
      AND table_name = 'user_monitored_tickers'
  ) THEN
    ALTER TABLE user_monitored_tickers DROP CONSTRAINT user_monitored_tickers_pkey;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'user_monitored_tickers_pkey'
      AND table_name = 'user_monitored_tickers'
  ) THEN
    ALTER TABLE user_monitored_tickers
      ADD CONSTRAINT user_monitored_tickers_pkey
      PRIMARY KEY (user_id, ticker, market_code);
  END IF;
END $$;

-- Recreate FK with composite key. Schema check mirrors migration 019 — only
-- attach the FK when the market_data schema is present (partial migration runs
-- in integration tests may skip 018).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'market_data') THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints
      WHERE constraint_name = 'fk_umt_instrument'
        AND table_name = 'user_monitored_tickers'
    ) THEN
      ALTER TABLE user_monitored_tickers
        ADD CONSTRAINT fk_umt_instrument
        FOREIGN KEY (ticker, market_code)
        REFERENCES market_data.instruments(ticker, market_code);
    END IF;
  END IF;
END $$;

COMMIT;
