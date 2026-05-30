-- KR market support: account currency, currency->market guard, fundamentals,
-- and provider-health bootstrap rows.

ALTER TABLE accounts
  DROP CONSTRAINT IF EXISTS ck_accounts_default_currency;

ALTER TABLE accounts
  ADD CONSTRAINT ck_accounts_default_currency
  CHECK (default_currency IN ('TWD', 'USD', 'AUD', 'KRW'));

CREATE OR REPLACE FUNCTION currency_to_market(currency TEXT)
RETURNS TEXT
IMMUTABLE
LANGUAGE plpgsql
AS $$
BEGIN
  IF currency = 'TWD' THEN RETURN 'TW'; END IF;
  IF currency = 'USD' THEN RETURN 'US'; END IF;
  IF currency = 'AUD' THEN RETURN 'AU'; END IF;
  IF currency = 'KRW' THEN RETURN 'KR'; END IF;
  RAISE EXCEPTION 'invalid_currency_for_market: %', currency
    USING ERRCODE = '23514';
END $$;

DO $$
DECLARE
  existing_constraint TEXT;
BEGIN
  SELECT conname
    INTO existing_constraint
    FROM pg_constraint
   WHERE conrelid = 'market_data.ticker_fundamentals'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) LIKE '%market_code%'
   LIMIT 1;

  IF existing_constraint IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE market_data.ticker_fundamentals DROP CONSTRAINT %I',
      existing_constraint
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'market_data.ticker_fundamentals'::regclass
       AND conname = 'ck_ticker_fundamentals_market_code'
  ) THEN
    ALTER TABLE market_data.ticker_fundamentals
      ADD CONSTRAINT ck_ticker_fundamentals_market_code
      CHECK (market_code IN ('TW', 'US', 'AU', 'KR'));
  END IF;
EXCEPTION
  WHEN undefined_table THEN
    NULL;
END $$;

INSERT INTO market_data.provider_health_status (provider_id, status)
VALUES
  ('yahoo-finance-kr', 'down'),
  ('twelve-data-kr', 'down')
ON CONFLICT (provider_id) DO NOTHING;
