BEGIN;

ALTER TABLE market_data.dividend_events
  ADD COLUMN IF NOT EXISTS stock_provider_value NUMERIC(20, 12),
  ADD COLUMN IF NOT EXISTS stock_provider_value_unit TEXT,
  ADD COLUMN IF NOT EXISTS stock_provider_source TEXT,
  ADD COLUMN IF NOT EXISTS stock_provider_dataset TEXT,
  ADD COLUMN IF NOT EXISTS stock_provider_authoritative_ratio NUMERIC(20, 12);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ck_dividend_events_stock_provider_value_non_negative'
      AND conrelid = 'market_data.dividend_events'::regclass
  ) THEN
    ALTER TABLE market_data.dividend_events
      ADD CONSTRAINT ck_dividend_events_stock_provider_value_non_negative
      CHECK (stock_provider_value IS NULL OR stock_provider_value >= 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ck_dividend_events_stock_provider_value_unit'
      AND conrelid = 'market_data.dividend_events'::regclass
  ) THEN
    ALTER TABLE market_data.dividend_events
      ADD CONSTRAINT ck_dividend_events_stock_provider_value_unit
      CHECK (
        stock_provider_value_unit IS NULL
        OR stock_provider_value_unit IN ('RATIO', 'TWD_PER_SHARE', 'UNKNOWN')
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ck_dividend_events_stock_provider_authoritative_ratio_non_negative'
      AND conrelid = 'market_data.dividend_events'::regclass
  ) THEN
    ALTER TABLE market_data.dividend_events
      ADD CONSTRAINT ck_dividend_events_stock_provider_authoritative_ratio_non_negative
      CHECK (stock_provider_authoritative_ratio IS NULL OR stock_provider_authoritative_ratio >= 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ck_dividend_events_stock_provider_raw_value_consistency'
      AND conrelid = 'market_data.dividend_events'::regclass
  ) THEN
    ALTER TABLE market_data.dividend_events
      ADD CONSTRAINT ck_dividend_events_stock_provider_raw_value_consistency
      CHECK (
        stock_distribution_amount_raw IS NULL
        OR stock_provider_value IS NULL
        OR stock_distribution_amount_raw = stock_provider_value
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ck_dividend_events_stock_provider_value_unit_consistency'
      AND conrelid = 'market_data.dividend_events'::regclass
  ) THEN
    ALTER TABLE market_data.dividend_events
      ADD CONSTRAINT ck_dividend_events_stock_provider_value_unit_consistency
      CHECK (
        (stock_provider_value_unit = 'RATIO' AND stock_provider_authoritative_ratio IS NOT NULL)
        OR (stock_provider_value_unit IN ('TWD_PER_SHARE', 'UNKNOWN') AND stock_provider_authoritative_ratio IS NULL)
        OR (stock_provider_value_unit IS NULL AND stock_provider_authoritative_ratio IS NULL)
      );
  END IF;
END $$;

UPDATE market_data.dividend_events
   SET stock_provider_value = COALESCE(stock_provider_value, stock_distribution_amount_raw),
       stock_distribution_amount_raw = COALESCE(stock_distribution_amount_raw, stock_provider_value),
       stock_provider_source = COALESCE(stock_provider_source, source),
       stock_provider_dataset = COALESCE(
         stock_provider_dataset,
         CASE
           WHEN COALESCE(stock_provider_source, source) = 'finmind'
             AND market_code = 'TW'
             AND COALESCE(raw_provider_data, '{}'::jsonb) ? 'CashEarningsDistribution'
             AND COALESCE(raw_provider_data, '{}'::jsonb) ? 'StockEarningsDistribution'
             THEN 'TaiwanStockDividend'
           ELSE NULL
         END
       ),
       stock_provider_authoritative_ratio = COALESCE(
         stock_provider_authoritative_ratio,
         CASE
           WHEN stock_distribution_ratio_state = 'authoritative' AND stock_distribution_ratio IS NOT NULL
             THEN stock_distribution_ratio
           ELSE NULL
         END
       ),
       stock_provider_value_unit = COALESCE(
         stock_provider_value_unit,
         CASE
           WHEN stock_distribution_ratio_state = 'authoritative' AND stock_distribution_ratio IS NOT NULL THEN 'RATIO'
           WHEN market_code = 'TW'
             AND COALESCE(stock_provider_source, source) = 'finmind'
             AND COALESCE(
               stock_provider_dataset,
               CASE
                 WHEN COALESCE(raw_provider_data, '{}'::jsonb) ? 'CashEarningsDistribution'
                   AND COALESCE(raw_provider_data, '{}'::jsonb) ? 'StockEarningsDistribution'
                   THEN 'TaiwanStockDividend'
                 ELSE NULL
               END
             ) = 'TaiwanStockDividend'
             AND COALESCE(stock_provider_value, stock_distribution_amount_raw) IS NOT NULL
             THEN 'TWD_PER_SHARE'
           WHEN COALESCE(stock_provider_value, stock_distribution_amount_raw) IS NOT NULL THEN 'UNKNOWN'
           ELSE NULL
         END
       )
 WHERE stock_provider_value IS NULL
    OR stock_provider_source IS NULL
    OR stock_provider_dataset IS NULL
    OR stock_provider_authoritative_ratio IS NULL
    OR stock_provider_value_unit IS NULL;

CREATE INDEX IF NOT EXISTS idx_md_dividend_events_stock_provider_lookup
  ON market_data.dividend_events(
    market_code,
    stock_provider_source,
    stock_provider_dataset,
    stock_provider_value_unit,
    ex_dividend_date,
    id
  );

ALTER TABLE dividend_ledger_entries
  ADD COLUMN IF NOT EXISTS active_calculation_id TEXT,
  ADD COLUMN IF NOT EXISTS cash_reconciliation_status TEXT,
  ADD COLUMN IF NOT EXISTS stock_reconciliation_status TEXT,
  ADD COLUMN IF NOT EXISTS stock_reconciliation_note TEXT,
  ADD COLUMN IF NOT EXISTS legacy_reconciliation_status TEXT,
  ADD COLUMN IF NOT EXISTS legacy_reconciliation_note TEXT,
  ADD COLUMN IF NOT EXISTS legacy_reconciliation_captured_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS legacy_reconciliation_capture_action TEXT,
  ADD COLUMN IF NOT EXISTS legacy_reconciliation_audit_metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ck_dividend_ledger_entries_cash_reconciliation_status'
      AND conrelid = 'dividend_ledger_entries'::regclass
  ) THEN
    ALTER TABLE dividend_ledger_entries
      ADD CONSTRAINT ck_dividend_ledger_entries_cash_reconciliation_status
      CHECK (
        cash_reconciliation_status IS NULL
        OR cash_reconciliation_status IN ('open', 'matched', 'explained', 'resolved')
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ck_dividend_ledger_entries_stock_reconciliation_status'
      AND conrelid = 'dividend_ledger_entries'::regclass
  ) THEN
    ALTER TABLE dividend_ledger_entries
      ADD CONSTRAINT ck_dividend_ledger_entries_stock_reconciliation_status
      CHECK (
        stock_reconciliation_status IS NULL
        OR stock_reconciliation_status IN ('needs_calculation', 'pending_receipt', 'matched', 'variance', 'explained')
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ck_dividend_ledger_entries_legacy_reconciliation_capture_action'
      AND conrelid = 'dividend_ledger_entries'::regclass
  ) THEN
    ALTER TABLE dividend_ledger_entries
      ADD CONSTRAINT ck_dividend_ledger_entries_legacy_reconciliation_capture_action
      CHECK (
        legacy_reconciliation_capture_action IS NULL
        OR legacy_reconciliation_capture_action IN (
          'migration_112_status_split',
          'legacy_backfill',
          'manual_audit_patch'
        )
      );
  END IF;
END $$;

UPDATE dividend_ledger_entries AS dle
   SET cash_reconciliation_status = COALESCE(dle.cash_reconciliation_status, dle.reconciliation_status),
       legacy_reconciliation_status = COALESCE(dle.legacy_reconciliation_status, dle.reconciliation_status),
       legacy_reconciliation_note = COALESCE(dle.legacy_reconciliation_note, dle.reconciliation_note),
       legacy_reconciliation_captured_at = COALESCE(
         dle.legacy_reconciliation_captured_at,
         CASE
           WHEN dle.reconciliation_status IS NOT NULL OR dle.reconciliation_note IS NOT NULL
             THEN CURRENT_TIMESTAMP
           ELSE NULL
         END
       ),
       legacy_reconciliation_capture_action = COALESCE(
         dle.legacy_reconciliation_capture_action,
         CASE
           WHEN dle.reconciliation_status IS NOT NULL OR dle.reconciliation_note IS NOT NULL
             THEN 'migration_112_status_split'
           ELSE NULL
         END
       ),
       legacy_reconciliation_audit_metadata = CASE
         WHEN (dle.reconciliation_status IS NOT NULL OR dle.reconciliation_note IS NOT NULL)
           AND COALESCE(dle.legacy_reconciliation_audit_metadata, '{}'::jsonb) = '{}'::jsonb
           THEN jsonb_build_object(
             'sourceStatus', dle.reconciliation_status,
             'sourceNote', dle.reconciliation_note,
             'capturedBy', '112_dividend_calculation_status_split_and_provider_normalization.sql'
           )
         ELSE COALESCE(dle.legacy_reconciliation_audit_metadata, '{}'::jsonb)
       END,
       stock_reconciliation_status = COALESCE(
         dle.stock_reconciliation_status,
         CASE
           WHEN de.event_type = 'CASH' THEN NULL
           WHEN dle.expected_stock_calc_state = 'needs_action' THEN 'needs_calculation'
           WHEN dle.posting_status = 'expected' THEN 'pending_receipt'
           WHEN dle.expected_stock_quantity IS NULL THEN 'needs_calculation'
           WHEN dle.received_stock_quantity = dle.expected_stock_quantity THEN 'matched'
           ELSE 'variance'
         END
       )
  FROM market_data.dividend_events AS de
 WHERE de.id = dle.dividend_event_id;

ALTER TABLE dividend_event_calculation_versions
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS provider_authoritative_ratio NUMERIC(20, 12),
  ADD COLUMN IF NOT EXISTS drifted_provider_value NUMERIC(20, 12),
  ADD COLUMN IF NOT EXISTS drifted_provider_unit TEXT,
  ADD COLUMN IF NOT EXISTS drifted_provider_source TEXT,
  ADD COLUMN IF NOT EXISTS drifted_provider_dataset TEXT,
  ADD COLUMN IF NOT EXISTS drifted_authoritative_ratio NUMERIC(20, 12),
  ADD COLUMN IF NOT EXISTS ledger_snapshot_expected_stock_quantity BIGINT,
  ADD COLUMN IF NOT EXISTS ledger_snapshot_received_stock_quantity BIGINT,
  ADD COLUMN IF NOT EXISTS ledger_snapshot_cash_reconciliation_status TEXT,
  ADD COLUMN IF NOT EXISTS ledger_snapshot_stock_reconciliation_status TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_dividend_event_calculation_versions_account_user'
      AND conrelid = 'dividend_event_calculation_versions'::regclass
  ) THEN
    ALTER TABLE dividend_event_calculation_versions
      ADD CONSTRAINT fk_dividend_event_calculation_versions_account_user
      FOREIGN KEY (account_id, user_id) REFERENCES accounts(id, user_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ck_dividend_event_calculation_versions_provider_authoritative_ratio_non_negative'
      AND conrelid = 'dividend_event_calculation_versions'::regclass
  ) THEN
    ALTER TABLE dividend_event_calculation_versions
      ADD CONSTRAINT ck_dividend_event_calculation_versions_provider_authoritative_ratio_non_negative
      CHECK (provider_authoritative_ratio IS NULL OR provider_authoritative_ratio >= 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ck_dividend_event_calculation_versions_drifted_provider_value_non_negative'
      AND conrelid = 'dividend_event_calculation_versions'::regclass
  ) THEN
    ALTER TABLE dividend_event_calculation_versions
      ADD CONSTRAINT ck_dividend_event_calculation_versions_drifted_provider_value_non_negative
      CHECK (drifted_provider_value IS NULL OR drifted_provider_value >= 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ck_dividend_event_calculation_versions_drifted_provider_unit'
      AND conrelid = 'dividend_event_calculation_versions'::regclass
  ) THEN
    ALTER TABLE dividend_event_calculation_versions
      ADD CONSTRAINT ck_dividend_event_calculation_versions_drifted_provider_unit
      CHECK (
        drifted_provider_unit IS NULL
        OR drifted_provider_unit IN ('RATIO', 'TWD_PER_SHARE', 'UNKNOWN')
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ck_dividend_event_calculation_versions_ledger_snapshot_cash_status'
      AND conrelid = 'dividend_event_calculation_versions'::regclass
  ) THEN
    ALTER TABLE dividend_event_calculation_versions
      ADD CONSTRAINT ck_dividend_event_calculation_versions_ledger_snapshot_cash_status
      CHECK (
        ledger_snapshot_cash_reconciliation_status IS NULL
        OR ledger_snapshot_cash_reconciliation_status IN ('open', 'matched', 'explained', 'resolved')
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ck_dividend_event_calculation_versions_ledger_snapshot_stock_status'
      AND conrelid = 'dividend_event_calculation_versions'::regclass
  ) THEN
    ALTER TABLE dividend_event_calculation_versions
      ADD CONSTRAINT ck_dividend_event_calculation_versions_ledger_snapshot_stock_status
      CHECK (
        ledger_snapshot_stock_reconciliation_status IS NULL
        OR ledger_snapshot_stock_reconciliation_status IN ('needs_calculation', 'pending_receipt', 'matched', 'variance', 'explained')
      );
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_dividend_ledger_entries_id_account_event
  ON dividend_ledger_entries(id, account_id, dividend_event_id);

CREATE UNIQUE INDEX IF NOT EXISTS ux_dividend_event_calculation_versions_active
  ON dividend_event_calculation_versions(account_id, dividend_event_id)
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_dividend_event_calculation_versions_active_lookup
  ON dividend_event_calculation_versions(account_id, dividend_event_id, is_active, created_at DESC);

-- A rerun after the earlier, scope-only trigger may encounter a stale pointer.
-- Relink to the same account-event's active version when one exists; historical
-- calculation/ledger snapshot fields remain untouched.
UPDATE dividend_ledger_entries AS dle
   SET active_calculation_id = (
         SELECT calc.id
           FROM dividend_event_calculation_versions AS calc
          WHERE calc.account_id = dle.account_id
            AND calc.dividend_event_id = dle.dividend_event_id
            AND calc.is_active = TRUE
            AND calc.superseded_at IS NULL
          ORDER BY calc.calculation_version DESC, calc.created_at DESC, calc.id DESC
          LIMIT 1
       )
 WHERE dle.active_calculation_id IS NOT NULL
   AND NOT EXISTS (
         SELECT 1
           FROM dividend_event_calculation_versions AS linked_calc
          WHERE linked_calc.id = dle.active_calculation_id
            AND linked_calc.account_id = dle.account_id
            AND linked_calc.dividend_event_id = dle.dividend_event_id
            AND linked_calc.is_active = TRUE
            AND linked_calc.superseded_at IS NULL
       );

ALTER TABLE dividend_ledger_entries
  DROP CONSTRAINT IF EXISTS fk_dividend_ledger_entries_active_calculation;

ALTER TABLE dividend_ledger_entries
  ADD CONSTRAINT fk_dividend_ledger_entries_active_calculation
  FOREIGN KEY (active_calculation_id)
  REFERENCES dividend_event_calculation_versions(id)
  ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION trg_dividend_event_calculation_versions_enforce_invariants()
RETURNS TRIGGER AS $$
DECLARE
  prior_row dividend_event_calculation_versions%ROWTYPE;
  linked_ledger dividend_ledger_entries%ROWTYPE;
BEGIN
  IF NEW.prior_calculation_id IS NOT NULL AND NEW.prior_calculation_id = NEW.id THEN
    RAISE EXCEPTION 'dividend_calculation_prior_self_reference: %', NEW.id
      USING ERRCODE = '23514';
  END IF;

  IF NEW.is_active AND NEW.calculation_status NOT IN ('confirmed', 'amended') THEN
    RAISE EXCEPTION 'dividend_calculation_invalid_active_status: %', NEW.calculation_status
      USING ERRCODE = '23514';
  END IF;

  IF NEW.is_active AND NEW.superseded_at IS NOT NULL THEN
    RAISE EXCEPTION 'dividend_calculation_active_superseded_conflict: %', NEW.id
      USING ERRCODE = '23514';
  END IF;

  IF NEW.calculation_status IN ('confirmed', 'amended') AND NEW.confirmed_at IS NULL THEN
    RAISE EXCEPTION 'dividend_calculation_confirmed_at_required: %', NEW.id
      USING ERRCODE = '23514';
  END IF;

  IF NEW.calculation_status IN ('preview', 'reset') AND NEW.confirmed_at IS NOT NULL THEN
    RAISE EXCEPTION 'dividend_calculation_confirmed_at_forbidden: %', NEW.id
      USING ERRCODE = '23514';
  END IF;

  IF NEW.prior_calculation_id IS NOT NULL THEN
    SELECT *
      INTO prior_row
      FROM dividend_event_calculation_versions
     WHERE id = NEW.prior_calculation_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'dividend_calculation_prior_missing: %', NEW.prior_calculation_id
        USING ERRCODE = '23503';
    END IF;

    IF prior_row.user_id <> NEW.user_id
       OR prior_row.account_id <> NEW.account_id
       OR prior_row.dividend_event_id <> NEW.dividend_event_id THEN
      RAISE EXCEPTION 'dividend_calculation_prior_scope_mismatch: %', NEW.prior_calculation_id
        USING ERRCODE = '23514';
    END IF;

    IF prior_row.calculation_version >= NEW.calculation_version THEN
      RAISE EXCEPTION 'dividend_calculation_prior_version_not_older: % >= %',
        prior_row.calculation_version, NEW.calculation_version
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.dividend_ledger_entry_id IS NOT NULL THEN
    SELECT *
      INTO linked_ledger
      FROM dividend_ledger_entries
     WHERE id = NEW.dividend_ledger_entry_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'dividend_calculation_linked_ledger_missing: %', NEW.dividend_ledger_entry_id
        USING ERRCODE = '23503';
    END IF;

    IF linked_ledger.account_id <> NEW.account_id
       OR linked_ledger.dividend_event_id <> NEW.dividend_event_id THEN
      RAISE EXCEPTION 'dividend_calculation_linked_ledger_scope_mismatch: %', NEW.dividend_ledger_entry_id
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_dividend_event_calculation_versions_enforce_invariants
  ON dividend_event_calculation_versions;

CREATE TRIGGER trg_dividend_event_calculation_versions_enforce_invariants
  BEFORE INSERT OR UPDATE ON dividend_event_calculation_versions
  FOR EACH ROW
  EXECUTE FUNCTION trg_dividend_event_calculation_versions_enforce_invariants();

CREATE OR REPLACE FUNCTION trg_dividend_ledger_entries_validate_active_calculation()
RETURNS TRIGGER AS $$
DECLARE
  active_calc dividend_event_calculation_versions%ROWTYPE;
BEGIN
  IF NEW.active_calculation_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT *
    INTO active_calc
    FROM dividend_event_calculation_versions
   WHERE id = NEW.active_calculation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'dividend_ledger_active_calculation_missing: %', NEW.active_calculation_id
      USING ERRCODE = '23503';
  END IF;

  IF active_calc.account_id <> NEW.account_id
     OR active_calc.dividend_event_id <> NEW.dividend_event_id THEN
    RAISE EXCEPTION 'dividend_ledger_active_calculation_scope_mismatch: %', NEW.active_calculation_id
      USING ERRCODE = '23514';
  END IF;

  IF NOT active_calc.is_active OR active_calc.superseded_at IS NOT NULL THEN
    RAISE EXCEPTION 'dividend_ledger_active_calculation_not_active: %', NEW.active_calculation_id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_dividend_ledger_entries_validate_active_calculation
  ON dividend_ledger_entries;

CREATE TRIGGER trg_dividend_ledger_entries_validate_active_calculation
  BEFORE INSERT OR UPDATE OF active_calculation_id, account_id, dividend_event_id
  ON dividend_ledger_entries
  FOR EACH ROW
  EXECUTE FUNCTION trg_dividend_ledger_entries_validate_active_calculation();

CREATE OR REPLACE FUNCTION trg_dividend_calculation_validate_ledger_active_links()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM dividend_ledger_entries AS dle
      JOIN dividend_event_calculation_versions AS calc
        ON calc.id = dle.active_calculation_id
     WHERE calc.id = NEW.id
       AND (NOT calc.is_active OR calc.superseded_at IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'dividend_calculation_inactive_ledger_active_link: %', NEW.id
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_dividend_calculation_validate_ledger_active_links
  ON dividend_event_calculation_versions;

-- Deferred validation permits an amendment transaction to relink the ledger before
-- the formerly active calculation becomes historical. Snapshot fields remain pinned.
CREATE CONSTRAINT TRIGGER trg_dividend_calculation_validate_ledger_active_links
  AFTER UPDATE OF is_active, superseded_at ON dividend_event_calculation_versions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION trg_dividend_calculation_validate_ledger_active_links();

CREATE INDEX IF NOT EXISTS idx_dividend_ledger_entries_cash_reconciliation_status
  ON dividend_ledger_entries(cash_reconciliation_status, account_id, booked_at, id)
  WHERE reversal_of_dividend_ledger_entry_id IS NULL
    AND superseded_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_dividend_ledger_entries_stock_reconciliation_status
  ON dividend_ledger_entries(stock_reconciliation_status, account_id, booked_at, id)
  WHERE reversal_of_dividend_ledger_entry_id IS NULL
    AND superseded_at IS NULL;

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
    'dividend_legacy_stock_purge_migrated',
    'dividend_calculation_confirmed',
    'dividend_calculation_reset',
    'dividend_calculation_amended',
    'dividend_stock_reconciliation_updated',
    'account_market_dividend_settings_updated'
  )
);

COMMIT;
