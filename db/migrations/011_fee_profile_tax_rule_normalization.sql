DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class rel ON rel.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = 'public'
      AND rel.relname = 'fee_profiles'
      AND c.conname = 'ck_fee_profiles_commission_rate_bps'
  ) THEN
    ALTER TABLE fee_profiles
      ADD CONSTRAINT ck_fee_profiles_commission_rate_bps
      CHECK (commission_rate_bps >= 0);
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
      AND c.conname = 'ck_fee_profiles_commission_discount_bps'
  ) THEN
    ALTER TABLE fee_profiles
      ADD CONSTRAINT ck_fee_profiles_commission_discount_bps
      CHECK (commission_discount_bps >= 0 AND commission_discount_bps <= 10000);
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
      AND c.conname = 'ck_fee_profiles_minimum_commission_amount'
  ) THEN
    ALTER TABLE fee_profiles
      ADD CONSTRAINT ck_fee_profiles_minimum_commission_amount
      CHECK (minimum_commission_amount >= 0);
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
      AND c.conname = 'ck_fee_profiles_commission_rounding_mode'
  ) THEN
    ALTER TABLE fee_profiles
      ADD CONSTRAINT ck_fee_profiles_commission_rounding_mode
      CHECK (commission_rounding_mode IN ('FLOOR', 'ROUND', 'CEIL'));
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
      AND c.conname = 'ck_fee_profiles_tax_rounding_mode'
  ) THEN
    ALTER TABLE fee_profiles
      ADD CONSTRAINT ck_fee_profiles_tax_rounding_mode
      CHECK (tax_rounding_mode IN ('FLOOR', 'ROUND', 'CEIL'));
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
      AND c.conname = 'ck_fee_profiles_stock_sell_tax_rate_bps'
  ) THEN
    ALTER TABLE fee_profiles
      ADD CONSTRAINT ck_fee_profiles_stock_sell_tax_rate_bps
      CHECK (stock_sell_tax_rate_bps >= 0);
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
      AND c.conname = 'ck_fee_profiles_stock_day_trade_tax_rate_bps'
  ) THEN
    ALTER TABLE fee_profiles
      ADD CONSTRAINT ck_fee_profiles_stock_day_trade_tax_rate_bps
      CHECK (stock_day_trade_tax_rate_bps >= 0);
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
      AND c.conname = 'ck_fee_profiles_etf_sell_tax_rate_bps'
  ) THEN
    ALTER TABLE fee_profiles
      ADD CONSTRAINT ck_fee_profiles_etf_sell_tax_rate_bps
      CHECK (etf_sell_tax_rate_bps >= 0);
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
      AND c.conname = 'ck_fee_profiles_bond_etf_sell_tax_rate_bps'
  ) THEN
    ALTER TABLE fee_profiles
      ADD CONSTRAINT ck_fee_profiles_bond_etf_sell_tax_rate_bps
      CHECK (bond_etf_sell_tax_rate_bps >= 0);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS fee_profile_tax_rules (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  fee_profile_id TEXT NOT NULL REFERENCES fee_profiles(id) ON DELETE CASCADE,
  market_code TEXT NOT NULL DEFAULT 'TW' CHECK (market_code ~ '^[A-Z]{2,10}$'),
  trade_side TEXT NOT NULL CHECK (trade_side IN ('SELL')),
  instrument_type TEXT NOT NULL CHECK (instrument_type IN ('STOCK', 'ETF', 'BOND_ETF')),
  day_trade_scope TEXT NOT NULL CHECK (day_trade_scope IN ('ANY', 'DAY_TRADE_ONLY', 'NON_DAY_TRADE_ONLY')),
  tax_component_code TEXT NOT NULL,
  calculation_method TEXT NOT NULL CHECK (calculation_method IN ('RATE_BPS')),
  rate_bps INTEGER NOT NULL CHECK (rate_bps >= 0),
  effective_from DATE,
  effective_to DATE,
  sort_order INTEGER NOT NULL DEFAULT 1 CHECK (sort_order > 0),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from)
);

CREATE INDEX IF NOT EXISTS idx_fee_profile_tax_rules_user_id
  ON fee_profile_tax_rules(user_id);

CREATE INDEX IF NOT EXISTS idx_fee_profile_tax_rules_fee_profile_id
  ON fee_profile_tax_rules(fee_profile_id, market_code, instrument_type, day_trade_scope, sort_order);

CREATE UNIQUE INDEX IF NOT EXISTS ux_fee_profile_tax_rules_identity
  ON fee_profile_tax_rules(
    fee_profile_id,
    market_code,
    trade_side,
    instrument_type,
    day_trade_scope,
    tax_component_code,
    sort_order
  );

INSERT INTO fee_profile_tax_rules (
  id,
  user_id,
  fee_profile_id,
  market_code,
  trade_side,
  instrument_type,
  day_trade_scope,
  tax_component_code,
  calculation_method,
  rate_bps,
  sort_order
)
SELECT
  id || ':tax-rule:stock-sell',
  user_id,
  id,
  'TW',
  'SELL',
  'STOCK',
  'NON_DAY_TRADE_ONLY',
  'SECURITIES_TRANSACTION_TAX',
  'RATE_BPS',
  stock_sell_tax_rate_bps,
  1
FROM fee_profiles
ON CONFLICT (id) DO NOTHING;

INSERT INTO fee_profile_tax_rules (
  id,
  user_id,
  fee_profile_id,
  market_code,
  trade_side,
  instrument_type,
  day_trade_scope,
  tax_component_code,
  calculation_method,
  rate_bps,
  sort_order
)
SELECT
  id || ':tax-rule:stock-day-trade-sell',
  user_id,
  id,
  'TW',
  'SELL',
  'STOCK',
  'DAY_TRADE_ONLY',
  'SECURITIES_TRANSACTION_TAX',
  'RATE_BPS',
  stock_day_trade_tax_rate_bps,
  2
FROM fee_profiles
ON CONFLICT (id) DO NOTHING;

INSERT INTO fee_profile_tax_rules (
  id,
  user_id,
  fee_profile_id,
  market_code,
  trade_side,
  instrument_type,
  day_trade_scope,
  tax_component_code,
  calculation_method,
  rate_bps,
  sort_order
)
SELECT
  id || ':tax-rule:etf-sell',
  user_id,
  id,
  'TW',
  'SELL',
  'ETF',
  'ANY',
  'SECURITIES_TRANSACTION_TAX',
  'RATE_BPS',
  etf_sell_tax_rate_bps,
  3
FROM fee_profiles
ON CONFLICT (id) DO NOTHING;

INSERT INTO fee_profile_tax_rules (
  id,
  user_id,
  fee_profile_id,
  market_code,
  trade_side,
  instrument_type,
  day_trade_scope,
  tax_component_code,
  calculation_method,
  rate_bps,
  sort_order
)
SELECT
  id || ':tax-rule:bond-etf-sell',
  user_id,
  id,
  'TW',
  'SELL',
  'BOND_ETF',
  'ANY',
  'SECURITIES_TRANSACTION_TAX',
  'RATE_BPS',
  bond_etf_sell_tax_rate_bps,
  4
FROM fee_profiles
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS trade_fee_policy_snapshot_tax_components (
  id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL REFERENCES trade_fee_policy_snapshots(id) ON DELETE CASCADE,
  market_code TEXT NOT NULL DEFAULT 'TW' CHECK (market_code ~ '^[A-Z]{2,10}$'),
  trade_side TEXT NOT NULL CHECK (trade_side IN ('SELL')),
  instrument_type TEXT NOT NULL CHECK (instrument_type IN ('STOCK', 'ETF', 'BOND_ETF')),
  day_trade_scope TEXT NOT NULL CHECK (day_trade_scope IN ('ANY', 'DAY_TRADE_ONLY', 'NON_DAY_TRADE_ONLY')),
  tax_component_code TEXT NOT NULL,
  calculation_method TEXT NOT NULL CHECK (calculation_method IN ('RATE_BPS')),
  rate_bps INTEGER NOT NULL CHECK (rate_bps >= 0),
  booked_tax_amount INTEGER NOT NULL CHECK (booked_tax_amount >= 0),
  sort_order INTEGER NOT NULL DEFAULT 1 CHECK (sort_order > 0),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_trade_fee_policy_snapshot_tax_components_snapshot_id
  ON trade_fee_policy_snapshot_tax_components(snapshot_id, sort_order);

CREATE UNIQUE INDEX IF NOT EXISTS ux_trade_fee_policy_snapshot_tax_components_snapshot_order
  ON trade_fee_policy_snapshot_tax_components(snapshot_id, sort_order);

INSERT INTO trade_fee_policy_snapshot_tax_components (
  id,
  snapshot_id,
  market_code,
  trade_side,
  instrument_type,
  day_trade_scope,
  tax_component_code,
  calculation_method,
  rate_bps,
  booked_tax_amount,
  sort_order,
  created_at
)
SELECT
  snapshot.id || ':tax-component:1',
  snapshot.id,
  'TW',
  'SELL',
  trade_event.instrument_type,
  CASE
    WHEN trade_event.instrument_type = 'STOCK' AND trade_event.is_day_trade THEN 'DAY_TRADE_ONLY'
    WHEN trade_event.instrument_type = 'STOCK' THEN 'NON_DAY_TRADE_ONLY'
    ELSE 'ANY'
  END,
  'SECURITIES_TRANSACTION_TAX',
  'RATE_BPS',
  CASE
    WHEN trade_event.instrument_type = 'STOCK' AND trade_event.is_day_trade THEN snapshot.stock_day_trade_tax_rate_bps
    WHEN trade_event.instrument_type = 'STOCK' THEN snapshot.stock_sell_tax_rate_bps
    WHEN trade_event.instrument_type = 'ETF' THEN snapshot.etf_sell_tax_rate_bps
    ELSE snapshot.bond_etf_sell_tax_rate_bps
  END,
  trade_event.tax_amount,
  1,
  trade_event.booked_at
FROM trade_events AS trade_event
JOIN trade_fee_policy_snapshots AS snapshot
  ON snapshot.id = trade_event.fee_policy_snapshot_id
WHERE trade_event.trade_type = 'SELL'
ON CONFLICT (id) DO NOTHING;
