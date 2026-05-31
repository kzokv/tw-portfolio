-- KZO-164: Frankfurter FX rate ingestion
--
-- Adds market_data.fx_rates: per-pair daily FX rates ingested from Frankfurter v2's
-- default-blend route (covers TWD/USD/AUD natively across CBC, RBA, ECB and 51 other
-- central banks). Schema CHECKs enforce ISO 4217 currency-code shape, positive rate,
-- and prohibit self-pairs (worker is responsible for filtering rows where quote==base).
-- Idempotent (safe to re-apply) via IF NOT EXISTS.
--
-- Source field is column-aligned with no fallback in the upsert path: the provider
-- always stamps source='frankfurter'. Diverges intentionally from the daily_bars
-- pattern (which has a 'finmind' default) — there is no legacy data to preserve.
--
-- Index supports KZO-165 snapshot generation's "latest rate for pair X/Y" lookups.

CREATE SCHEMA IF NOT EXISTS market_data;
GRANT USAGE ON SCHEMA market_data TO current_user;

CREATE TABLE IF NOT EXISTS market_data.fx_rates (
  date DATE NOT NULL,
  base_currency CHAR(3) NOT NULL,
  quote_currency CHAR(3) NOT NULL,
  rate NUMERIC(20, 8) NOT NULL,
  source TEXT NOT NULL,
  ingested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (date, base_currency, quote_currency),
  CONSTRAINT ck_fx_rates_rate_positive CHECK (rate > 0),
  CONSTRAINT ck_fx_rates_base_currency_iso CHECK (base_currency ~ '^[A-Z]{3}$'),
  CONSTRAINT ck_fx_rates_quote_currency_iso CHECK (quote_currency ~ '^[A-Z]{3}$'),
  CONSTRAINT ck_fx_rates_no_self_pair CHECK (base_currency <> quote_currency)
);

CREATE INDEX IF NOT EXISTS idx_fx_rates_pair_date_desc
  ON market_data.fx_rates (base_currency, quote_currency, date DESC);

-- KZO-164: extend audit_log action CHECK to include the manual refresh action.
-- Cron-triggered refreshes do NOT write audit (precedent: catalog-sync). Only
-- POST /admin/fx-rates/refresh emits this entry. Snake_case to match every other
-- action in this CHECK (precedents: 031, 033, 035).
DO $$
BEGIN
  ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS audit_log_action_check;
  ALTER TABLE audit_log ADD CONSTRAINT audit_log_action_check CHECK (
    action IN (
      'admin_promote_cli',
      'admin_promote_startup',
      'admin_promote_first_signin',
      'admin_role_change',
      'admin_disable_user',
      'admin_enable_user',
      'admin_delete_user',
      'admin_hard_purge_user',
      'admin_invite_issued',
      'admin_invite_revoked',
      'share_granted',
      'share_revoked',
      'share_token_created',
      'share_token_revoked',
      'impersonation_start',
      'impersonation_end',
      'impersonation_blocked_write',
      'session_force_logout',
      'app_config_updated',
      'admin_fx_rates_refresh'
    )
  );
END $$;
