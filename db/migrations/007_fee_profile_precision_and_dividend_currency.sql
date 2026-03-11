ALTER TABLE fee_profiles
  ADD COLUMN IF NOT EXISTS board_commission_rate NUMERIC(20, 6),
  ADD COLUMN IF NOT EXISTS commission_charge_mode TEXT;

UPDATE fee_profiles
SET board_commission_rate = commission_rate_bps::NUMERIC / 10
WHERE board_commission_rate IS NULL;

UPDATE fee_profiles
SET commission_charge_mode = 'CHARGED_UPFRONT'
WHERE commission_charge_mode IS NULL;

ALTER TABLE fee_profiles
  ALTER COLUMN board_commission_rate SET DEFAULT 1.425,
  ALTER COLUMN board_commission_rate SET NOT NULL,
  ALTER COLUMN commission_charge_mode SET DEFAULT 'CHARGED_UPFRONT',
  ALTER COLUMN commission_charge_mode SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class rel ON rel.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = 'public'
      AND rel.relname = 'fee_profiles'
      AND c.conname = 'ck_fee_profiles_board_commission_rate'
  ) THEN
    ALTER TABLE fee_profiles
      ADD CONSTRAINT ck_fee_profiles_board_commission_rate
      CHECK (board_commission_rate >= 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class rel ON rel.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = 'public'
      AND rel.relname = 'fee_profiles'
      AND c.conname = 'ck_fee_profiles_commission_charge_mode'
  ) THEN
    ALTER TABLE fee_profiles
      ADD CONSTRAINT ck_fee_profiles_commission_charge_mode
      CHECK (commission_charge_mode IN ('CHARGED_UPFRONT', 'CHARGED_UPFRONT_REBATED_LATER'));
  END IF;
END $$;

ALTER TABLE dividend_events
  ADD COLUMN IF NOT EXISTS cash_dividend_currency TEXT;

UPDATE dividend_events
SET cash_dividend_currency = 'TWD'
WHERE cash_dividend_currency IS NULL;

ALTER TABLE dividend_events
  ALTER COLUMN cash_dividend_currency SET DEFAULT 'TWD',
  ALTER COLUMN cash_dividend_currency SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class rel ON rel.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = 'public'
      AND rel.relname = 'dividend_events'
      AND c.conname = 'ck_dividend_events_cash_dividend_currency'
  ) THEN
    ALTER TABLE dividend_events
      ADD CONSTRAINT ck_dividend_events_cash_dividend_currency
      CHECK (cash_dividend_currency = 'TWD');
  END IF;
END $$;
