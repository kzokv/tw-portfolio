-- Dividend stock-ratio normalization, durable destructive preview storage,
-- and one-time legacy stock-dividend repair queue.

BEGIN;

ALTER TABLE market_data.dividend_events
  ADD COLUMN IF NOT EXISTS stock_distribution_amount_raw NUMERIC(20, 6),
  ADD COLUMN IF NOT EXISTS stock_distribution_ratio NUMERIC(20, 12),
  ADD COLUMN IF NOT EXISTS stock_distribution_ratio_state TEXT,
  ADD COLUMN IF NOT EXISTS stock_par_value_amount NUMERIC(20, 6),
  ADD COLUMN IF NOT EXISTS stock_par_value_currency TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'ck_dividend_events_stock_distribution_ratio_state'
       AND conrelid = 'market_data.dividend_events'::regclass
  ) THEN
    ALTER TABLE market_data.dividend_events
      ADD CONSTRAINT ck_dividend_events_stock_distribution_ratio_state
      CHECK (
        stock_distribution_ratio_state IS NULL
        OR stock_distribution_ratio_state IN ('authoritative', 'derived_non_authoritative', 'unresolved')
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'ck_dividend_events_stock_distribution_ratio_non_negative'
       AND conrelid = 'market_data.dividend_events'::regclass
  ) THEN
    ALTER TABLE market_data.dividend_events
      ADD CONSTRAINT ck_dividend_events_stock_distribution_ratio_non_negative
      CHECK (stock_distribution_ratio IS NULL OR stock_distribution_ratio >= 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'ck_dividend_events_stock_distribution_amount_raw_non_negative'
       AND conrelid = 'market_data.dividend_events'::regclass
  ) THEN
    ALTER TABLE market_data.dividend_events
      ADD CONSTRAINT ck_dividend_events_stock_distribution_amount_raw_non_negative
      CHECK (stock_distribution_amount_raw IS NULL OR stock_distribution_amount_raw >= 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'ck_dividend_events_stock_par_value_amount_non_negative'
       AND conrelid = 'market_data.dividend_events'::regclass
  ) THEN
    ALTER TABLE market_data.dividend_events
      ADD CONSTRAINT ck_dividend_events_stock_par_value_amount_non_negative
      CHECK (stock_par_value_amount IS NULL OR stock_par_value_amount >= 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'ck_dividend_events_stock_par_value_currency'
       AND conrelid = 'market_data.dividend_events'::regclass
  ) THEN
    ALTER TABLE market_data.dividend_events
      ADD CONSTRAINT ck_dividend_events_stock_par_value_currency
      CHECK (stock_par_value_currency IS NULL OR stock_par_value_currency ~ '^[A-Z]{3}$');
  END IF;
END $$;

UPDATE market_data.dividend_events
   SET stock_distribution_amount_raw =
         CASE
           WHEN stock_distribution_amount_raw IS NOT NULL THEN stock_distribution_amount_raw
           WHEN stock_dividend_per_share > 0 THEN stock_dividend_per_share
           ELSE 0
         END,
       stock_distribution_ratio =
         CASE
           WHEN stock_distribution_ratio_state = 'authoritative'
             AND stock_distribution_ratio IS NOT NULL
             THEN stock_distribution_ratio
           ELSE NULL
         END,
       stock_distribution_ratio_state =
         CASE
           WHEN stock_distribution_ratio_state = 'authoritative'
             AND stock_distribution_ratio IS NOT NULL
             THEN 'authoritative'
           ELSE 'unresolved'
         END,
       stock_par_value_amount = stock_par_value_amount,
       stock_par_value_currency = stock_par_value_currency
 WHERE stock_distribution_amount_raw IS NULL
    OR stock_distribution_ratio IS NULL
    OR stock_distribution_ratio_state IS NULL
    OR stock_distribution_ratio_state <> 'authoritative';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'ck_dividend_events_stock_distribution_ratio_consistency'
       AND conrelid = 'market_data.dividend_events'::regclass
  ) THEN
    ALTER TABLE market_data.dividend_events
      ADD CONSTRAINT ck_dividend_events_stock_distribution_ratio_consistency
      CHECK (
        (stock_distribution_ratio_state IS NULL AND stock_distribution_ratio IS NULL)
        OR (stock_distribution_ratio_state = 'unresolved' AND stock_distribution_ratio IS NULL)
        OR (
          stock_distribution_ratio_state IN ('authoritative', 'derived_non_authoritative')
          AND stock_distribution_ratio IS NOT NULL
        )
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_md_dividend_events_ratio_state
  ON market_data.dividend_events(stock_distribution_ratio_state, payment_date, ex_dividend_date, id);

ALTER TABLE dividend_ledger_entries
  ADD COLUMN IF NOT EXISTS expected_stock_calc_state TEXT,
  ADD COLUMN IF NOT EXISTS expected_stock_distribution_ratio NUMERIC(20, 12),
  ADD COLUMN IF NOT EXISTS expected_stock_par_value_amount NUMERIC(20, 6);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'ck_dividend_ledger_entries_expected_stock_calc_state'
       AND conrelid = 'dividend_ledger_entries'::regclass
  ) THEN
    ALTER TABLE dividend_ledger_entries
      ADD CONSTRAINT ck_dividend_ledger_entries_expected_stock_calc_state
      CHECK (
        expected_stock_calc_state IS NULL
        OR expected_stock_calc_state IN ('resolved', 'needs_action')
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'ck_dividend_ledger_entries_expected_stock_distribution_ratio_non_negative'
       AND conrelid = 'dividend_ledger_entries'::regclass
  ) THEN
    ALTER TABLE dividend_ledger_entries
      ADD CONSTRAINT ck_dividend_ledger_entries_expected_stock_distribution_ratio_non_negative
      CHECK (expected_stock_distribution_ratio IS NULL OR expected_stock_distribution_ratio >= 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'ck_dividend_ledger_entries_expected_stock_par_value_amount_non_negative'
       AND conrelid = 'dividend_ledger_entries'::regclass
  ) THEN
    ALTER TABLE dividend_ledger_entries
      ADD CONSTRAINT ck_dividend_ledger_entries_expected_stock_par_value_amount_non_negative
      CHECK (expected_stock_par_value_amount IS NULL OR expected_stock_par_value_amount >= 0);
  END IF;
END $$;

UPDATE dividend_ledger_entries AS dle
   SET expected_stock_quantity =
         CASE
           WHEN de.event_type IN ('STOCK', 'CASH_AND_STOCK')
             AND de.stock_distribution_ratio_state = 'authoritative'
             AND de.stock_distribution_ratio IS NOT NULL
             THEN FLOOR(dle.eligible_quantity * de.stock_distribution_ratio)
           WHEN de.event_type IN ('STOCK', 'CASH_AND_STOCK') THEN 0
           ELSE dle.expected_stock_quantity
         END,
       expected_stock_distribution_ratio =
         CASE
           WHEN de.stock_distribution_ratio_state = 'authoritative'
             AND de.stock_distribution_ratio IS NOT NULL
             THEN de.stock_distribution_ratio
           ELSE NULL
         END,
       expected_stock_par_value_amount =
         COALESCE(dle.expected_stock_par_value_amount, de.stock_par_value_amount),
       expected_stock_calc_state =
         CASE
           WHEN de.event_type IN ('STOCK', 'CASH_AND_STOCK')
             AND dle.eligible_quantity > 0
             AND NOT (
               de.stock_distribution_ratio_state = 'authoritative'
               AND de.stock_distribution_ratio IS NOT NULL
             ) THEN 'needs_action'
           ELSE 'resolved'
         END
  FROM market_data.dividend_events AS de
 WHERE de.id = dle.dividend_event_id
   AND (
     dle.expected_stock_distribution_ratio IS NULL
     OR dle.expected_stock_par_value_amount IS NULL
     OR dle.expected_stock_calc_state IS NULL
   );

CREATE INDEX IF NOT EXISTS idx_dividend_ledger_entries_expected_stock_calc_state
  ON dividend_ledger_entries(expected_stock_calc_state, account_id, booked_at, id)
  WHERE reversal_of_dividend_ledger_entry_id IS NULL
    AND superseded_at IS NULL;

ALTER TABLE ai_connector_connection_scopes
  DROP CONSTRAINT IF EXISTS ai_connector_connection_scopes_scope_check;

ALTER TABLE ai_connector_connection_scopes
  ADD CONSTRAINT ai_connector_connection_scopes_scope_check CHECK (
    scope IN (
      'portfolio:mcp_read', 'account:manage',
      'transaction_draft:create', 'transaction_draft:edit',
      'transaction_draft:archive', 'transaction_draft:delete',
      'transaction:write', 'dividend:write'
    )
  );

ALTER TABLE portfolio_share_capabilities
  DROP CONSTRAINT IF EXISTS portfolio_share_capabilities_capability_check;

ALTER TABLE portfolio_share_capabilities
  ADD CONSTRAINT portfolio_share_capabilities_capability_check CHECK (
    capability IN (
      'portfolio:mcp_read', 'account:manage',
      'transaction_draft:create', 'transaction_draft:edit',
      'transaction_draft:archive', 'transaction_draft:delete',
      'transaction:write', 'dividend:write', 'sharing:manage'
    )
  );

ALTER TABLE pending_share_invite_capabilities
  DROP CONSTRAINT IF EXISTS pending_share_invite_capabilities_capability_check;

ALTER TABLE pending_share_invite_capabilities
  ADD CONSTRAINT pending_share_invite_capabilities_capability_check CHECK (
    capability IN (
      'portfolio:mcp_read', 'account:manage',
      'transaction_draft:create', 'transaction_draft:edit',
      'transaction_draft:archive', 'transaction_draft:delete',
      'transaction:write', 'dividend:write', 'sharing:manage'
    )
  );

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS accounting_revision BIGINT NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION bump_accounting_revision_from_account_id()
RETURNS trigger AS $$
DECLARE
  target_account_id TEXT;
BEGIN
  target_account_id := COALESCE(
    CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW)->>'account_id' END,
    CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD)->>'account_id' END
  );
  IF target_account_id IS NOT NULL THEN
    UPDATE accounts
       SET accounting_revision = accounting_revision + 1
     WHERE id = target_account_id;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION bump_accounting_revision_from_dividend_ledger_id()
RETURNS trigger AS $$
DECLARE
  target_ledger_id TEXT;
  target_account_id TEXT;
BEGIN
  target_ledger_id := COALESCE(
    CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW)->>'dividend_ledger_entry_id' END,
    CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD)->>'dividend_ledger_entry_id' END
  );
  SELECT account_id INTO target_account_id
    FROM dividend_ledger_entries
   WHERE id = target_ledger_id;
  IF target_account_id IS NOT NULL THEN
    UPDATE accounts
       SET accounting_revision = accounting_revision + 1
     WHERE id = target_account_id;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'trade_events', 'cash_ledger_entries', 'position_actions', 'lots',
    'lot_allocations', 'dividend_ledger_entries'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_accounting_revision ON %I', table_name, table_name);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_accounting_revision AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION bump_accounting_revision_from_account_id()',
      table_name,
      table_name
    );
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS trg_dividend_deduction_entries_accounting_revision ON dividend_deduction_entries;
CREATE TRIGGER trg_dividend_deduction_entries_accounting_revision
AFTER INSERT OR UPDATE OR DELETE ON dividend_deduction_entries
FOR EACH ROW EXECUTE FUNCTION bump_accounting_revision_from_dividend_ledger_id();

DROP TRIGGER IF EXISTS trg_dividend_source_lines_accounting_revision ON dividend_source_lines;
CREATE TRIGGER trg_dividend_source_lines_accounting_revision
AFTER INSERT OR UPDATE OR DELETE ON dividend_source_lines
FOR EACH ROW EXECUTE FUNCTION bump_accounting_revision_from_dividend_ledger_id();

CREATE TABLE IF NOT EXISTS dividend_destructive_previews (
  preview_id TEXT PRIMARY KEY,
  preview_version INTEGER NOT NULL CHECK (preview_version > 0),
  fingerprint TEXT NOT NULL,
  operation_kind TEXT NOT NULL CHECK (operation_kind IN ('trade_delete', 'account_cutoff_purge')),
  operation_key TEXT NOT NULL,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  target_trade_event_id TEXT,
  cutoff_date DATE,
  reason TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  affected_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
  affected_dividends JSONB NOT NULL DEFAULT '[]'::jsonb,
  manual_receipt_reentry_ledger_entry_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  CHECK (
    (operation_kind = 'trade_delete' AND target_trade_event_id IS NOT NULL AND cutoff_date IS NULL)
    OR (operation_kind = 'account_cutoff_purge' AND target_trade_event_id IS NULL AND cutoff_date IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_dividend_destructive_previews_owner_operation_version
  ON dividend_destructive_previews(owner_user_id, operation_key, preview_version);

CREATE INDEX IF NOT EXISTS idx_dividend_destructive_previews_owner_created_at
  ON dividend_destructive_previews(owner_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_dividend_destructive_previews_account_expires_at
  ON dividend_destructive_previews(account_id, expires_at DESC);

CREATE TABLE IF NOT EXISTS dividend_legacy_stock_repair_queue (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  ticker TEXT NOT NULL,
  market_code TEXT NOT NULL CHECK (market_code ~ '^[A-Z]{2,10}$'),
  dividend_ledger_entry_id TEXT NOT NULL,
  related_position_action_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_dividend_legacy_stock_repair_queue_ledger_entry
  ON dividend_legacy_stock_repair_queue(dividend_ledger_entry_id);

CREATE INDEX IF NOT EXISTS idx_dividend_legacy_stock_repair_queue_owner_account
  ON dividend_legacy_stock_repair_queue(owner_user_id, account_id, ticker, market_code, created_at);

INSERT INTO dividend_legacy_stock_repair_queue (
  owner_user_id,
  account_id,
  ticker,
  market_code,
  dividend_ledger_entry_id,
  related_position_action_id
)
SELECT
  account.user_id,
  dle.account_id,
  de.ticker,
  de.market_code,
  dle.id,
  pa.id
  FROM dividend_ledger_entries AS dle
  JOIN accounts AS account
    ON account.id = dle.account_id
  JOIN market_data.dividend_events AS de
    ON de.id = dle.dividend_event_id
  LEFT JOIN position_actions AS pa
    ON pa.related_dividend_ledger_entry_id = dle.id
   AND pa.action_type = 'STOCK_DIVIDEND'
   AND pa.reversal_of_position_action_id IS NULL
   AND pa.superseded_at IS NULL
 WHERE dle.posting_status IN ('posted', 'adjusted')
   AND dle.received_stock_quantity > 0
   AND de.event_type IN ('STOCK', 'CASH_AND_STOCK')
ON CONFLICT (dividend_ledger_entry_id) DO NOTHING;

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
    'share_capabilities_updated',
    'ai_connector_connected',
    'ai_connector_revoked',
    'ai_connector_expired',
    'share_token_created',
    'share_token_revoked',
    'impersonation_start',
    'impersonation_end',
    'impersonation_blocked_write',
    'session_force_logout',
    'app_config_updated',
    'admin_fx_rates_refresh',
    'fx_transfer_created',
    'fx_transfer_updated',
    'fx_transfer_reversed',
    'provider_health_rerun',
    'provider_fixer_operation',
    'instrument_undelete',
    'instrument_exclusion_toggle',
    'instrument_delisted_via_absence',
    'instrument_absence_streak_bumped',
    'instrument_absence_guard_tripped',
    'delegated_portfolio_write',
    'market_calendar_previewed',
    'market_calendar_confirmed',
    'market_calendar_invalidated',
    'market_calendar_source_updated',
    'account_soft_deleted',
    'account_restored',
    'account_hard_purged',
    'quote_fallback_policy_created',
    'quote_fallback_policy_updated',
    'quote_fallback_policy_deactivated',
    'quote_fallback_manual_refresh_requested',
    'dividend_destructive_confirmed',
    'dividend_destructive_failed',
    'dividend_destructive_preview_created',
    'dividend_legacy_stock_purge_migrated'
  )
);

COMMIT;
