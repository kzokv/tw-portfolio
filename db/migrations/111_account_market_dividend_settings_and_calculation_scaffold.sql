BEGIN;

CREATE TABLE IF NOT EXISTS account_market_dividend_settings (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  market_code TEXT NOT NULL,
  fallback_par_value NUMERIC(20, 6),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (account_id, market_code),
  CONSTRAINT ck_account_market_dividend_settings_market_code
    CHECK (market_code IN ('TW', 'US', 'AU', 'KR', 'JP')),
  CONSTRAINT ck_account_market_dividend_settings_fallback_par_value
    CHECK (fallback_par_value IS NULL OR fallback_par_value > 0),
  CONSTRAINT ck_account_market_dividend_settings_version
    CHECK (version > 0)
);

CREATE INDEX IF NOT EXISTS idx_account_market_dividend_settings_account_market
  ON account_market_dividend_settings(account_id, market_code, version);

CREATE TABLE IF NOT EXISTS dividend_event_calculation_versions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  dividend_event_id TEXT NOT NULL REFERENCES market_data.dividend_events(id) ON DELETE CASCADE,
  prior_calculation_id TEXT REFERENCES dividend_event_calculation_versions(id) ON DELETE SET NULL,
  dividend_ledger_entry_id TEXT REFERENCES dividend_ledger_entries(id) ON DELETE SET NULL,
  calculation_version INTEGER NOT NULL,
  calculation_status TEXT NOT NULL DEFAULT 'preview',
  method TEXT NOT NULL,
  provider_value NUMERIC(20, 12),
  provider_unit TEXT,
  provider_source TEXT,
  provider_dataset TEXT,
  selected_par_value NUMERIC(20, 6),
  custom_ratio NUMERIC(20, 12),
  resolved_ratio NUMERIC(20, 12) NOT NULL,
  theoretical_shares NUMERIC(28, 12) NOT NULL,
  expected_whole_shares BIGINT NOT NULL,
  fractional_remainder NUMERIC(20, 12) NOT NULL,
  requires_high_ratio_confirmation BOOLEAN NOT NULL DEFAULT FALSE,
  confirmed_at TIMESTAMP,
  superseded_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT ck_dividend_event_calculation_versions_status
    CHECK (calculation_status IN ('preview', 'confirmed', 'reset', 'amended')),
  CONSTRAINT ck_dividend_event_calculation_versions_method
    CHECK (method IN ('provider_ratio', 'derived_from_par_value', 'custom_ratio')),
  CONSTRAINT ck_dividend_event_calculation_versions_provider_unit
    CHECK (provider_unit IS NULL OR provider_unit IN ('RATIO', 'TWD_PER_SHARE', 'UNKNOWN')),
  CONSTRAINT ck_dividend_event_calculation_versions_selected_par_value
    CHECK (selected_par_value IS NULL OR selected_par_value > 0),
  CONSTRAINT ck_dividend_event_calculation_versions_custom_ratio
    CHECK (custom_ratio IS NULL OR custom_ratio > 0),
  CONSTRAINT ck_dividend_event_calculation_versions_positive_ratio
    CHECK (resolved_ratio > 0),
  CONSTRAINT ck_dividend_event_calculation_versions_theoretical_shares
    CHECK (theoretical_shares >= 0),
  CONSTRAINT ck_dividend_event_calculation_versions_fractional_remainder
    CHECK (fractional_remainder >= 0 AND fractional_remainder < 1),
  CONSTRAINT ck_dividend_event_calculation_versions_confirmed_at
    CHECK (
      (calculation_status IN ('confirmed', 'amended') AND confirmed_at IS NOT NULL)
      OR (calculation_status IN ('preview', 'reset') AND confirmed_at IS NULL)
    ),
  CONSTRAINT ck_dividend_event_calculation_versions_whole_shares
    CHECK (expected_whole_shares >= 0),
  CONSTRAINT fk_dividend_event_calculation_versions_account_user
    FOREIGN KEY (account_id, user_id) REFERENCES accounts(id, user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_dividend_event_calculation_versions_account_event_version
  ON dividend_event_calculation_versions(account_id, dividend_event_id, calculation_version);

CREATE INDEX IF NOT EXISTS idx_dividend_event_calculation_versions_account_event_created
  ON dividend_event_calculation_versions(account_id, dividend_event_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS ux_dividend_event_calculation_versions_id_account_event
  ON dividend_event_calculation_versions(id, account_id, dividend_event_id);

COMMIT;
