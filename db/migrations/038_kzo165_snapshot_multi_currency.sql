-- KZO-165: Snapshot schema migration — per-currency native columns + provider source +
-- new currency_wallet_snapshots table.
--
-- This migration is the schema scaffolding for multi-currency snapshot reporting. It does
-- NOT add WAC math, realized FX P&L crystallization, or read-side dashboard work — those
-- live in KZO-166 (writer) and KZO-176 (reader).
--
-- Idempotent (safe to re-apply) via IF NOT EXISTS / DO $$ ... END $$ guards. Mirrors the
-- shape of 037_kzo164_fx_rates.sql.
--
-- Step ordering matters:
--   1. ADD COLUMN IF NOT EXISTS for the four new holding columns.
--   2. UPDATE backfill (idempotent guard via WHERE provider_source IS NULL).
--   3. ALTER COLUMN currency TYPE CHAR(3) USING UPPER(LEFT(currency, 3)) — type cast first
--      normalizes any prior data while the DEFAULT 'TWD' is still in place.
--   4. ALTER COLUMN currency DROP DEFAULT — promote semantics to "native currency".
--   5. ADD CONSTRAINT ck_daily_holding_snapshots_currency_iso — ISO 4217 shape guard.
--   6. CREATE TABLE IF NOT EXISTS currency_wallet_snapshots (composite FK + ISO CHECK).
--   7. CREATE INDEX IF NOT EXISTS idx_currency_wallet_snapshots_user_date.
--
-- KZO-166 will populate `wac_fx_to_usd` and `realized_fx_pnl_lifetime` with real values;
-- KZO-176 will rewrite `getAggregatedSnapshots` and drop the legacy cost_basis /
-- market_value / unrealized_pnl columns. Until then, KZO-165's writer dual-writes legacy
-- columns at native value (TWD-only data, no behavioral change).

-- 1. Add native columns + provider source to daily_holding_snapshots.
--    value_native NUMERIC(20, 4) per D9 (4-decimal precision matching close_price * quantity).
--    cost_basis_native / unrealized_pnl_native NUMERIC(20, 2) per D9.
--    provider_source TEXT NULL — denormalizes daily_bars.source for the bar that supplied
--    close_price; NULL on provisional rows; backfilled to 'finmind' for pre-migration rows.
ALTER TABLE daily_holding_snapshots
  ADD COLUMN IF NOT EXISTS value_native NUMERIC(20, 4),
  ADD COLUMN IF NOT EXISTS cost_basis_native NUMERIC(20, 2),
  ADD COLUMN IF NOT EXISTS unrealized_pnl_native NUMERIC(20, 2),
  ADD COLUMN IF NOT EXISTS provider_source TEXT;

-- 2. Backfill pre-migration rows. Idempotent: only touches rows where
--    cost_basis_native is still NULL. That column did not exist before this
--    migration and KZO-165 writers always supply it, so a manual re-apply will not
--    rewrite post-migration provisional rows whose provider_source is intentionally
--    NULL. value_native follows the locked migration contract:
--    COALESCE(market_value, 0).
UPDATE daily_holding_snapshots
SET
  value_native = COALESCE(market_value, 0),
  cost_basis_native = cost_basis,
  unrealized_pnl_native = unrealized_pnl,
  provider_source = 'finmind'
WHERE cost_basis_native IS NULL;

-- 3. Tighten currency column to CHAR(3). USING UPPER(LEFT(currency, 3)) normalizes any
--    pre-migration data (existing rows are 'TWD' from the prior DEFAULT, so this is a
--    no-op for them; defensive against any drift).
ALTER TABLE daily_holding_snapshots
  ALTER COLUMN currency TYPE CHAR(3) USING UPPER(LEFT(currency, 3));

-- 4. Drop the 'TWD' DEFAULT — currency is now authoritative native currency, not a
--    fallback. Writers must always pass an explicit value.
ALTER TABLE daily_holding_snapshots
  ALTER COLUMN currency DROP DEFAULT;

-- 5. ISO 4217 CHECK constraint. Wrapped in DO $$ for compatibility with Postgres
--    versions that don't support `ADD CONSTRAINT IF NOT EXISTS`. Mirrors the precedent
--    in 037_kzo164_fx_rates.sql.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ck_daily_holding_snapshots_currency_iso'
      AND conrelid = 'daily_holding_snapshots'::regclass
  ) THEN
    ALTER TABLE daily_holding_snapshots
      ADD CONSTRAINT ck_daily_holding_snapshots_currency_iso
      CHECK (currency ~ '^[A-Z]{3}$');
  END IF;
END $$;

-- 6. New currency_wallet_snapshots table.
--
-- Composite FK (account_id, user_id) → accounts(id, user_id) provides defense-in-depth
-- against cross-user account references. The required composite UNIQUE index
-- ux_accounts_id_user_id exists from db/migrations/003_accounting_core_schema.sql.
--
-- PK is (account_id, currency, date) per D7 — `user_id` is denormalized for index
-- support but not part of the natural key (one wallet row per account+currency+day).
--
-- FX columns (`wac_fx_to_usd`, `realized_fx_pnl_lifetime`) carry KZO-166 semantics.
-- KZO-165 writes wac_fx_to_usd=NULL and realized_fx_pnl_lifetime=0 on every stub row.
-- `provider_source` is NULL on stub rows; KZO-166 will populate it once FX-rate-derived
-- values land.
CREATE TABLE IF NOT EXISTS currency_wallet_snapshots (
  user_id TEXT NOT NULL REFERENCES users(id),
  account_id TEXT NOT NULL,
  currency CHAR(3) NOT NULL,
  date DATE NOT NULL,
  balance_native NUMERIC(20, 2) NOT NULL,
  wac_fx_to_usd NUMERIC(20, 8),
  realized_fx_pnl_lifetime NUMERIC(20, 2) NOT NULL DEFAULT 0,
  provider_source TEXT,
  generated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  generation_run_id TEXT NOT NULL,
  PRIMARY KEY (account_id, currency, date),
  CONSTRAINT fk_currency_wallet_snapshots_account
    FOREIGN KEY (account_id, user_id) REFERENCES accounts(id, user_id),
  CONSTRAINT ck_currency_wallet_snapshots_currency_iso
    CHECK (currency ~ '^[A-Z]{3}$')
);

-- 7. Secondary index supporting the user-scoped read path (KZO-176 dashboard rewrite).
--    Single index per D8 — no other access patterns are exercised in this ticket.
CREATE INDEX IF NOT EXISTS idx_currency_wallet_snapshots_user_date
  ON currency_wallet_snapshots (user_id, date DESC);
