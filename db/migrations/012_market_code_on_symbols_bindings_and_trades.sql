ALTER TABLE account_fee_profile_overrides
  ADD COLUMN IF NOT EXISTS market_code TEXT NOT NULL DEFAULT 'TW';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class rel ON rel.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = 'public'
      AND rel.relname = 'account_fee_profile_overrides'
      AND c.conname = 'ck_account_fee_profile_overrides_market_code'
  ) THEN
    ALTER TABLE account_fee_profile_overrides
      ADD CONSTRAINT ck_account_fee_profile_overrides_market_code
      CHECK (market_code ~ '^[A-Z]{2,10}$');
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class rel ON rel.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = 'public'
      AND rel.relname = 'account_fee_profile_overrides'
      AND c.conname = 'account_fee_profile_overrides_pkey'
      AND pg_get_constraintdef(c.oid) = 'PRIMARY KEY (account_id, symbol)'
  ) THEN
    ALTER TABLE account_fee_profile_overrides
      DROP CONSTRAINT account_fee_profile_overrides_pkey;
    ALTER TABLE account_fee_profile_overrides
      ADD PRIMARY KEY (account_id, symbol, market_code);
  END IF;
END $$;

ALTER TABLE symbols
  ADD COLUMN IF NOT EXISTS market_code TEXT NOT NULL DEFAULT 'TW';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class rel ON rel.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = 'public'
      AND rel.relname = 'symbols'
      AND c.conname = 'ck_symbols_market_code'
  ) THEN
    ALTER TABLE symbols
      ADD CONSTRAINT ck_symbols_market_code
      CHECK (market_code ~ '^[A-Z]{2,10}$');
  END IF;
END $$;

ALTER TABLE trade_events
  ADD COLUMN IF NOT EXISTS market_code TEXT NOT NULL DEFAULT 'TW';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class rel ON rel.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = 'public'
      AND rel.relname = 'trade_events'
      AND c.conname = 'ck_trade_events_market_code'
  ) THEN
    ALTER TABLE trade_events
      ADD CONSTRAINT ck_trade_events_market_code
      CHECK (market_code ~ '^[A-Z]{2,10}$');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_account_fee_profile_overrides_account_market_symbol
  ON account_fee_profile_overrides(account_id, market_code, symbol);

CREATE INDEX IF NOT EXISTS idx_symbols_market_code_ticker
  ON symbols(market_code, ticker);

CREATE INDEX IF NOT EXISTS idx_trade_events_account_market_symbol_trade_date
  ON trade_events(account_id, market_code, symbol, trade_date, booked_at);
