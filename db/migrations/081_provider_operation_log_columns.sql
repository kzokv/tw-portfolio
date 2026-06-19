ALTER TABLE market_data.provider_operation_logs
  ADD COLUMN IF NOT EXISTS provider_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS market_code TEXT NULL,
  ADD COLUMN IF NOT EXISTS event_kind TEXT NULL,
  ADD COLUMN IF NOT EXISTS batch_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS job_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS success_count INTEGER NULL,
  ADD COLUMN IF NOT EXISTS warning_count INTEGER NULL,
  ADD COLUMN IF NOT EXISTS error_count INTEGER NULL,
  ADD COLUMN IF NOT EXISTS detail TEXT NULL,
  ADD COLUMN IF NOT EXISTS raw_context JSONB NULL;

CREATE INDEX IF NOT EXISTS idx_provider_operation_logs_provider_created
  ON market_data.provider_operation_logs (provider_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_provider_operation_logs_market_created
  ON market_data.provider_operation_logs (market_code, created_at DESC);
