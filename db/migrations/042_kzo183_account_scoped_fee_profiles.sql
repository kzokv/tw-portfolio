-- KZO-183: account-scoped fee profiles + account–market binding.
--
-- Rescopes `fee_profiles` from user-scoped (one row shared by N accounts) to
-- account-scoped (exactly one owner). Fans out shared profiles per
-- referencing account and renames the duplicates with " (Account <name>)".
-- Also adds a closed-set currency ↔ market mapping (TWD↔TW, USD↔US, AUD↔AU)
-- and BEFORE INSERT/UPDATE triggers on `trade_events` and
-- `dividend_ledger_entries` that enforce the booking account's market.
--
-- Schema changes (irreversible — no down migration):
--   * fee_profiles: drop `user_id`, add `account_id NOT NULL` FK, add
--     UNIQUE(id, account_id) for the composite-FK ownership invariant.
--   * fee_profile_tax_rules: drop `user_id` (cascades through fee_profiles).
--   * accounts: simple FK on fee_profile_id replaced by composite FK
--     (fee_profile_id, id) → fee_profiles(id, account_id). Prevents account
--     A from defaulting to a profile owned by account B even via direct SQL.
--   * account_fee_profile_overrides: drop `market_code` column, recompute
--     PK to (account_id, ticker). Add composite FK
--     (fee_profile_id, account_id) → fee_profiles(id, account_id).
--   * trade_fee_policy_snapshots.profile_id_at_booking is intentionally left
--     dangling (decision item 15). Snapshot rows are denormalized; the id is
--     decorative and not migrated alongside the rescoped profile rows.
--   * Adds CREATE FUNCTION currency_to_market(text) IMMUTABLE.
--   * Adds BEFORE INSERT/UPDATE triggers on trade_events +
--     dividend_ledger_entries to enforce the market match.
--
-- This migration is NOT idempotent — it runs once. The schema_migrations
-- table tracks completion; rerunning produces a "table already exists / FK
-- already exists" failure as designed.

BEGIN;

-- ── 1. Pre-flight CHECKs (SELECT-based, abort migration on violations) ────

DO $$
DECLARE
  bad_count INTEGER;
BEGIN
  -- Check 1: no trade_events have market_code mismatched against the
  -- booking account's default_currency. Migration cannot proceed if any
  -- existing rows would fail the new BEFORE INSERT/UPDATE trigger.
  SELECT COUNT(*) INTO bad_count
  FROM trade_events te
  JOIN accounts a ON a.id = te.account_id
  WHERE
    (a.default_currency = 'TWD' AND te.market_code <> 'TW')
    OR (a.default_currency = 'USD' AND te.market_code <> 'US')
    OR (a.default_currency = 'AUD' AND te.market_code <> 'AU')
    OR a.default_currency NOT IN ('TWD', 'USD', 'AUD');
  IF bad_count > 0 THEN
    RAISE EXCEPTION 'pre-flight: % trade_events row(s) violate the market guard', bad_count;
  END IF;

  -- Check 2: no dividend_ledger_entries have cash_dividend_currency
  -- mismatched against the booking account's default_currency.
  SELECT COUNT(*) INTO bad_count
  FROM dividend_ledger_entries dle
  JOIN accounts a ON a.id = dle.account_id
  JOIN market_data.dividend_events de ON de.id = dle.dividend_event_id
  WHERE de.cash_dividend_currency <> a.default_currency;
  IF bad_count > 0 THEN
    RAISE EXCEPTION 'pre-flight: % dividend_ledger_entries row(s) violate the market guard', bad_count;
  END IF;

  -- Check 3: defensive — no (account_id, ticker) duplication across markets
  -- in account_fee_profile_overrides. The 1:1 currency↔market mapping makes
  -- this organically impossible, but a duplication would block the new PK.
  SELECT COUNT(*) INTO bad_count
  FROM (
    SELECT account_id, ticker, COUNT(*) AS n
    FROM account_fee_profile_overrides
    GROUP BY account_id, ticker
    HAVING COUNT(*) > 1
  ) AS dupes;
  IF bad_count > 0 THEN
    RAISE EXCEPTION 'pre-flight: % (account_id, ticker) tuple(s) appear in multiple markets', bad_count;
  END IF;
END $$;

-- ── 2. Backfill: per-(account, fee_profile) fan-out with rename ───────────

-- Add account_id column nullable so we can populate it before enforcing.
ALTER TABLE fee_profiles
  ADD COLUMN IF NOT EXISTS account_id TEXT;

-- For every (account, profile) pair where the account references the profile
-- (either via accounts.fee_profile_id OR via account_fee_profile_overrides),
-- create a per-account profile row. The "primary" account — whose
-- accounts.fee_profile_id originally pointed at the profile — keeps the
-- original profile id and the original profile name. Other accounts get a
-- fresh id and a suffixed name.
--
-- The `__kzo183_profile_owners_tmp` working table holds one row per
-- (account_id, old_profile_id) pair, with `is_primary = true` for exactly
-- one row per old_profile_id (the lowest account_id that uses it as its
-- default). All other rows get fan-out copies.

CREATE TEMP TABLE __kzo183_profile_owners_tmp AS
WITH profile_users AS (
  -- accounts that point at the profile via accounts.fee_profile_id
  SELECT
    a.fee_profile_id AS old_profile_id,
    a.id AS account_id,
    a.name AS account_name,
    a.user_id AS account_user_id,
    'default'::TEXT AS source
  FROM accounts a
  UNION
  -- accounts that point at the profile via per-symbol overrides
  SELECT DISTINCT
    o.fee_profile_id AS old_profile_id,
    o.account_id,
    a.name AS account_name,
    a.user_id AS account_user_id,
    'override'::TEXT AS source
  FROM account_fee_profile_overrides o
  JOIN accounts a ON a.id = o.account_id
),
deduped AS (
  -- One row per (old_profile_id, account_id) — collapse default+override.
  SELECT
    old_profile_id,
    account_id,
    MIN(account_name) AS account_name,
    MIN(account_user_id) AS account_user_id,
    BOOL_OR(source = 'default') AS is_default
  FROM profile_users
  GROUP BY old_profile_id, account_id
),
ranked AS (
  -- Pick exactly one "primary" per old_profile_id. Prefer the account that
  -- holds it as default; tie-break by lowest account_id for determinism.
  SELECT
    *,
    ROW_NUMBER() OVER (
      PARTITION BY old_profile_id
      ORDER BY is_default DESC, account_id
    ) AS rn
  FROM deduped
)
SELECT
  old_profile_id,
  account_id,
  account_name,
  account_user_id,
  CASE WHEN rn = 1 THEN TRUE ELSE FALSE END AS is_primary,
  -- Primary keeps the original id; others get a fresh UUID-like id with a
  -- deterministic suffix so the migration is reproducible.
  CASE WHEN rn = 1 THEN old_profile_id
       ELSE old_profile_id || ':acc:' || account_id
  END AS new_profile_id
FROM ranked;

-- Backfill 1: update the primary row's account_id (no rename needed).
UPDATE fee_profiles fp
SET account_id = t.account_id
FROM __kzo183_profile_owners_tmp t
WHERE fp.id = t.old_profile_id
  AND t.is_primary = TRUE;

-- Backfill 2: insert fan-out rows for non-primary owners. They duplicate
-- the source profile's columns and append " (Account <name>)" to the name.
-- If two accounts share a name (rare: the ux_accounts_user_id_name index
-- forbids it within a single user, but distinct users can collide), append
-- the account id suffix to break the tie.
INSERT INTO fee_profiles (
  id, user_id, name, commission_rate_bps, commission_discount_bps,
  minimum_commission_amount, commission_rounding_mode, tax_rounding_mode,
  stock_sell_tax_rate_bps, stock_day_trade_tax_rate_bps,
  etf_sell_tax_rate_bps, bond_etf_sell_tax_rate_bps,
  board_commission_rate, commission_charge_mode,
  commission_discount_percent, commission_currency,
  account_id
)
SELECT
  t.new_profile_id,
  src.user_id,  -- temporarily preserve user_id (column dropped below)
  CASE
    WHEN EXISTS (
      SELECT 1 FROM __kzo183_profile_owners_tmp t2
      WHERE t2.old_profile_id = t.old_profile_id
        AND t2.is_primary = FALSE
        AND t2.account_id <> t.account_id
        AND t2.account_name = t.account_name
    )
    THEN src.name || ' (Account ' || t.account_name || ' [' || t.account_id || '])'
    ELSE src.name || ' (Account ' || t.account_name || ')'
  END,
  src.commission_rate_bps, src.commission_discount_bps,
  src.minimum_commission_amount, src.commission_rounding_mode, src.tax_rounding_mode,
  src.stock_sell_tax_rate_bps, src.stock_day_trade_tax_rate_bps,
  src.etf_sell_tax_rate_bps, src.bond_etf_sell_tax_rate_bps,
  src.board_commission_rate, src.commission_charge_mode,
  src.commission_discount_percent, src.commission_currency,
  t.account_id
FROM __kzo183_profile_owners_tmp t
JOIN fee_profiles src ON src.id = t.old_profile_id
WHERE t.is_primary = FALSE;

-- Backfill 3: cascade fee_profile_tax_rules. Each non-primary fan-out copy
-- needs its own tax-rule rows. Source rows live under old_profile_id;
-- copy them under each non-primary new_profile_id.
INSERT INTO fee_profile_tax_rules (
  id, user_id, fee_profile_id, market_code, trade_side, instrument_type,
  day_trade_scope, tax_component_code, calculation_method, rate_bps,
  effective_from, effective_to, sort_order, created_at
)
SELECT
  src.id || ':acc:' || t.account_id,
  src.user_id,  -- temporarily preserve (column dropped below)
  t.new_profile_id,
  src.market_code, src.trade_side, src.instrument_type,
  src.day_trade_scope, src.tax_component_code, src.calculation_method, src.rate_bps,
  src.effective_from, src.effective_to, src.sort_order, src.created_at
FROM __kzo183_profile_owners_tmp t
JOIN fee_profile_tax_rules src ON src.fee_profile_id = t.old_profile_id
WHERE t.is_primary = FALSE;

-- Backfill 4: repoint accounts.fee_profile_id to the per-account row.
-- For accounts whose existing fee_profile_id is the primary, no change is
-- needed — the primary already carries that account_id (Backfill 1).
-- For accounts that had a non-primary fan-out copy created (Backfill 2),
-- repoint them to the new_profile_id.
UPDATE accounts a
SET fee_profile_id = t.new_profile_id
FROM __kzo183_profile_owners_tmp t
WHERE a.id = t.account_id
  AND t.is_primary = FALSE
  AND a.fee_profile_id = t.old_profile_id;

-- Backfill 5: repoint account_fee_profile_overrides.fee_profile_id similarly.
UPDATE account_fee_profile_overrides o
SET fee_profile_id = t.new_profile_id
FROM __kzo183_profile_owners_tmp t
WHERE o.account_id = t.account_id
  AND o.fee_profile_id = t.old_profile_id
  AND t.is_primary = FALSE;

-- Backfill 6: any orphan fee_profiles row that no account ever referenced
-- still has account_id = NULL after Backfill 1. Such rows are dead — drop
-- them rather than coercing an arbitrary owner.
DELETE FROM fee_profile_tax_rules
WHERE fee_profile_id IN (SELECT id FROM fee_profiles WHERE account_id IS NULL);
DELETE FROM fee_profiles WHERE account_id IS NULL;

DROP TABLE __kzo183_profile_owners_tmp;

-- ── 3. Schema rescope: drop user_id, market_code; add NOT NULL + FKs ──────

-- Drop the simple FK from accounts.fee_profile_id → fee_profiles.id so we
-- can replace it with the composite FK below.
ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_fee_profile_id_fkey;

-- fee_profiles: drop user_id (carried over from before; tax-rule cascade
-- rule keeps fee_profile_tax_rules in sync). After this, the index
-- idx_fee_profiles_user_id (created in baseline) becomes meaningless and is
-- dropped explicitly below.
ALTER TABLE fee_profiles DROP COLUMN IF EXISTS user_id;
DROP INDEX IF EXISTS idx_fee_profiles_user_id;

-- fee_profile_tax_rules: drop user_id and its index.
ALTER TABLE fee_profile_tax_rules DROP COLUMN IF EXISTS user_id;
DROP INDEX IF EXISTS idx_fee_profile_tax_rules_user_id;

-- fee_profiles.account_id: tighten to NOT NULL + add FK to accounts(id).
ALTER TABLE fee_profiles ALTER COLUMN account_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fee_profiles_account_id_fkey'
      AND conrelid = 'fee_profiles'::regclass
  ) THEN
    ALTER TABLE fee_profiles
      ADD CONSTRAINT fee_profiles_account_id_fkey
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_fee_profiles_account_id
  ON fee_profiles(account_id);

-- Composite-FK ownership invariant: every (id, account_id) tuple is unique.
-- This is the target of the composite FKs from accounts and overrides.
CREATE UNIQUE INDEX IF NOT EXISTS ux_fee_profiles_id_account_id
  ON fee_profiles(id, account_id);

-- accounts: replace simple FK with composite FK (fee_profile_id, id) →
-- fee_profiles(id, account_id). Prevents account A from referencing a
-- profile owned by account B.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'accounts_fee_profile_owner_fk'
      AND conrelid = 'accounts'::regclass
  ) THEN
    ALTER TABLE accounts
      ADD CONSTRAINT accounts_fee_profile_owner_fk
      FOREIGN KEY (fee_profile_id, id)
      REFERENCES fee_profiles(id, account_id)
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

-- account_fee_profile_overrides: drop market_code + recompute PK, then add
-- composite FK enforcing per-account ownership.
ALTER TABLE account_fee_profile_overrides
  DROP CONSTRAINT IF EXISTS account_fee_profile_overrides_pkey;
ALTER TABLE account_fee_profile_overrides
  DROP CONSTRAINT IF EXISTS account_fee_profile_overrides_fee_profile_id_fkey;
DROP INDEX IF EXISTS idx_account_fee_profile_overrides_account_market_ticker;

ALTER TABLE account_fee_profile_overrides
  DROP COLUMN IF EXISTS market_code;

ALTER TABLE account_fee_profile_overrides
  ADD PRIMARY KEY (account_id, ticker);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'account_fee_profile_overrides_owner_fk'
      AND conrelid = 'account_fee_profile_overrides'::regclass
  ) THEN
    ALTER TABLE account_fee_profile_overrides
      ADD CONSTRAINT account_fee_profile_overrides_owner_fk
      FOREIGN KEY (fee_profile_id, account_id)
      REFERENCES fee_profiles(id, account_id);
  END IF;
END $$;

-- ── 4. Currency ↔ market mapping function (closed set) ────────────────────

CREATE OR REPLACE FUNCTION currency_to_market(currency TEXT)
RETURNS TEXT
IMMUTABLE
LANGUAGE plpgsql
AS $$
BEGIN
  IF currency = 'TWD' THEN RETURN 'TW'; END IF;
  IF currency = 'USD' THEN RETURN 'US'; END IF;
  IF currency = 'AUD' THEN RETURN 'AU'; END IF;
  RAISE EXCEPTION 'invalid_currency_for_market: %', currency
    USING ERRCODE = '23514';
END $$;

-- ── 5. Trigger: trade_events market guard ─────────────────────────────────

CREATE OR REPLACE FUNCTION trg_trade_events_market_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  expected_market TEXT;
BEGIN
  SELECT currency_to_market(default_currency) INTO expected_market
  FROM accounts
  WHERE id = NEW.account_id;

  IF expected_market IS NULL THEN
    RAISE EXCEPTION 'trade_market_mismatch: unknown account %', NEW.account_id
      USING ERRCODE = '23514';
  END IF;

  IF NEW.market_code <> expected_market THEN
    RAISE EXCEPTION
      'trade_market_mismatch: trade market % does not match account % market %',
      NEW.market_code, NEW.account_id, expected_market
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trade_events_market_guard ON trade_events;
CREATE TRIGGER trade_events_market_guard
  BEFORE INSERT OR UPDATE OF market_code, account_id ON trade_events
  FOR EACH ROW EXECUTE FUNCTION trg_trade_events_market_guard();

-- ── 6. Trigger: dividend_ledger_entries market guard ──────────────────────
--
-- dividend_ledger_entries does not store market_code; the market is derived
-- from the dividend event's cash_dividend_currency. The trigger asserts
-- that the dividend event's currency matches the booking account's
-- default_currency.

CREATE OR REPLACE FUNCTION trg_dividend_ledger_entries_market_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  account_currency TEXT;
  event_currency TEXT;
BEGIN
  SELECT default_currency INTO account_currency
  FROM accounts WHERE id = NEW.account_id;

  SELECT cash_dividend_currency INTO event_currency
  FROM market_data.dividend_events WHERE id = NEW.dividend_event_id;

  IF account_currency IS NULL THEN
    RAISE EXCEPTION 'dividend_market_mismatch: unknown account %', NEW.account_id
      USING ERRCODE = '23514';
  END IF;

  IF event_currency IS NULL THEN
    RAISE EXCEPTION 'dividend_market_mismatch: unknown dividend event %', NEW.dividend_event_id
      USING ERRCODE = '23514';
  END IF;

  IF event_currency <> account_currency THEN
    RAISE EXCEPTION
      'dividend_market_mismatch: dividend event % currency % does not match account % default_currency %',
      NEW.dividend_event_id, event_currency, NEW.account_id, account_currency
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS dividend_ledger_entries_market_guard ON dividend_ledger_entries;
CREATE TRIGGER dividend_ledger_entries_market_guard
  BEFORE INSERT OR UPDATE OF account_id, dividend_event_id ON dividend_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION trg_dividend_ledger_entries_market_guard();

COMMIT;
