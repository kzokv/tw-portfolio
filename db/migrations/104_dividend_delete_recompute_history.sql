-- Durable, reviewable recompute-history previews and complete fee provenance.

BEGIN;

DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  FOR constraint_name IN
    SELECT con.conname
      FROM pg_constraint con
     WHERE con.conrelid = 'trade_events'::regclass
       AND con.contype = 'c'
       AND pg_get_constraintdef(con.oid) ILIKE '%fees_source%'
  LOOP
    EXECUTE format('ALTER TABLE trade_events DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END $$;

ALTER TABLE trade_events
  ADD CONSTRAINT ck_trade_events_fees_source
  CHECK (fees_source IN ('CALCULATED', 'MANUAL', 'SOURCE_PROVIDED'));

ALTER TABLE recompute_jobs
  ADD COLUMN IF NOT EXISTS fee_mode TEXT,
  ADD COLUMN IF NOT EXISTS use_fallback_bindings BOOLEAN,
  ADD COLUMN IF NOT EXISTS account_revisions JSONB,
  ADD COLUMN IF NOT EXISTS fee_config_fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS preview_fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS error_code TEXT,
  ADD COLUMN IF NOT EXISTS error_message TEXT;

UPDATE recompute_jobs
   SET fee_mode = COALESCE(fee_mode, 'KEEP_RECORDED'),
       use_fallback_bindings = COALESCE(use_fallback_bindings, TRUE),
       account_revisions = COALESCE(account_revisions, '{}'::jsonb),
       fee_config_fingerprint = COALESCE(fee_config_fingerprint, md5(id || ':fee-config') || md5('fee-config:' || id)),
       preview_fingerprint = COALESCE(preview_fingerprint, md5(id || ':' || created_at::text) || md5(created_at::text || ':' || id)),
       expires_at = COALESCE(expires_at, created_at + INTERVAL '15 minutes'),
       status = CASE WHEN status = 'CONFIRMED' THEN 'CONFIRMED' ELSE 'PREVIEWED' END;

ALTER TABLE recompute_jobs
  ALTER COLUMN fee_mode SET DEFAULT 'KEEP_RECORDED',
  ALTER COLUMN fee_mode SET NOT NULL,
  ALTER COLUMN use_fallback_bindings SET DEFAULT TRUE,
  ALTER COLUMN use_fallback_bindings SET NOT NULL,
  ALTER COLUMN account_revisions SET DEFAULT '{}'::jsonb,
  ALTER COLUMN account_revisions SET NOT NULL,
  ALTER COLUMN fee_config_fingerprint SET NOT NULL,
  ALTER COLUMN preview_fingerprint SET NOT NULL,
  ALTER COLUMN expires_at SET NOT NULL;

DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  FOR constraint_name IN
    SELECT con.conname
      FROM pg_constraint con
     WHERE con.conrelid = 'recompute_jobs'::regclass
       AND con.contype = 'c'
       AND (
         pg_get_constraintdef(con.oid) ILIKE '%fee_mode%'
         OR pg_get_constraintdef(con.oid) ILIKE '%status%'
         OR pg_get_constraintdef(con.oid) ILIKE '%preview_fingerprint%'
         OR pg_get_constraintdef(con.oid) ILIKE '%fee_config_fingerprint%'
       )
  LOOP
    EXECUTE format('ALTER TABLE recompute_jobs DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END $$;

ALTER TABLE recompute_jobs
  ADD CONSTRAINT ck_recompute_jobs_fee_mode
    CHECK (fee_mode IN ('KEEP_RECORDED', 'RECALCULATE_CALCULATED')),
  ADD CONSTRAINT ck_recompute_jobs_status
    CHECK (status IN ('PREVIEWED', 'RUNNING', 'CONFIRMED', 'FAILED')),
  ADD CONSTRAINT ck_recompute_jobs_preview_fingerprint
    CHECK (preview_fingerprint ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT ck_recompute_jobs_fee_config_fingerprint
    CHECK (fee_config_fingerprint ~ '^[a-f0-9]{64}$');

ALTER TABLE recompute_job_items
  ADD COLUMN IF NOT EXISTS currency TEXT,
  ADD COLUMN IF NOT EXISTS fees_source TEXT,
  ADD COLUMN IF NOT EXISTS applied_profile_id TEXT,
  ADD COLUMN IF NOT EXISTS applied_fee_profile_json JSONB;

-- Recompute items are immutable audit evidence. A replay rewrites scoped
-- trade rows, and a later user-authorized deletion may remove the source
-- trade entirely; neither operation may cascade-delete the reviewed audit.
DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  FOR constraint_name IN
    SELECT con.conname
      FROM pg_constraint con
     WHERE con.conrelid = 'recompute_job_items'::regclass
       AND con.contype = 'f'
       AND pg_get_constraintdef(con.oid) ILIKE '%FOREIGN KEY (trade_event_id)%'
  LOOP
    EXECUTE format('ALTER TABLE recompute_job_items DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END $$;

UPDATE recompute_job_items item
   SET currency = COALESCE(item.currency, trade.price_currency, 'TWD'),
       fees_source = COALESCE(item.fees_source, trade.fees_source, 'CALCULATED')
  FROM trade_events trade
 WHERE trade.id = item.trade_event_id
   AND (item.currency IS NULL OR item.fees_source IS NULL);

ALTER TABLE recompute_job_items
  ALTER COLUMN currency SET NOT NULL,
  ALTER COLUMN fees_source SET NOT NULL;

DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  FOR constraint_name IN
    SELECT con.conname
      FROM pg_constraint con
     WHERE con.conrelid = 'recompute_job_items'::regclass
       AND con.contype = 'c'
       AND (
         pg_get_constraintdef(con.oid) ILIKE '%currency%'
         OR pg_get_constraintdef(con.oid) ILIKE '%fees_source%'
         OR pg_get_constraintdef(con.oid) ILIKE '%applied_profile_id%'
         OR pg_get_constraintdef(con.oid) ILIKE '%applied_fee_profile_json%'
       )
  LOOP
    EXECUTE format('ALTER TABLE recompute_job_items DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END $$;

ALTER TABLE recompute_job_items
  ADD CONSTRAINT ck_recompute_job_items_currency
    CHECK (currency ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT ck_recompute_job_items_fees_source
    CHECK (fees_source IN ('CALCULATED', 'MANUAL', 'SOURCE_PROVIDED')),
  ADD CONSTRAINT ck_recompute_job_items_applied_profile_pair
    CHECK ((applied_profile_id IS NULL) = (applied_fee_profile_json IS NULL));

COMMIT;
