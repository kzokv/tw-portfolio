-- KZO-167: per-account default currency + account type metadata.
-- Adds default_currency CHAR(3) and account_type TEXT to accounts.
-- Idempotent. Existing rows get DEFAULT 'TWD' / 'broker' via ADD COLUMN
-- DEFAULT (no explicit UPDATE backfill needed).
--
-- account_type is metadata-only in this ticket (KZO-167 D4) — bank/wallet
-- accounts are not refused trades or specific entry types yet. Behavioral
-- gating is deferred to downstream tickets (KZO-168 FX_TRANSFER, KZO-170/171
-- US/AU markets).
--
-- defaultCurrency mutations are gated at the route layer (KZO-167 D7) — a
-- PATCH that changes default_currency on an account with existing
-- cash_ledger_entries OR trade_events is rejected with 409
-- currency_change_blocked.

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS default_currency CHAR(3) NOT NULL DEFAULT 'TWD';

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS account_type TEXT NOT NULL DEFAULT 'broker';

-- Postgres versions in scope do not support `ADD CONSTRAINT IF NOT EXISTS`.
-- Mirror the precedent in 039_kzo166_cash_ledger_fx_rate.sql (the
-- `ck_cash_ledger_fx_rate_positive` block).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ck_accounts_default_currency'
      AND conrelid = 'accounts'::regclass
  ) THEN
    ALTER TABLE accounts
      ADD CONSTRAINT ck_accounts_default_currency
      CHECK (default_currency IN ('TWD', 'USD', 'AUD'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ck_accounts_account_type'
      AND conrelid = 'accounts'::regclass
  ) THEN
    ALTER TABLE accounts
      ADD CONSTRAINT ck_accounts_account_type
      CHECK (account_type IN ('broker', 'bank', 'wallet'));
  END IF;
END $$;
