-- KZO-197: add durable queued phase for provider operations.
-- This keeps acknowledged work durable while a provider/market write lock is active.

ALTER TABLE market_data.provider_operations
  DROP CONSTRAINT IF EXISTS provider_operations_phase_check;

ALTER TABLE market_data.provider_operations
  ADD CONSTRAINT provider_operations_phase_check CHECK (
    phase IN (
      'diagnose',
      'preview',
      'staged',
      'queued',
      'running',
      'paused',
      'completed',
      'failed',
      'cancelled'
    )
  );

ALTER TABLE market_data.provider_operation_logs
  DROP CONSTRAINT IF EXISTS provider_operation_logs_phase_check;

ALTER TABLE market_data.provider_operation_logs
  ADD CONSTRAINT provider_operation_logs_phase_check CHECK (
    phase IN (
      'diagnose',
      'preview',
      'staged',
      'queued',
      'running',
      'paused',
      'completed',
      'failed',
      'cancelled'
    )
  );

DROP INDEX IF EXISTS market_data.idx_provider_operations_active_execution;

CREATE INDEX IF NOT EXISTS idx_provider_operations_active_execution
  ON market_data.provider_operations (provider_id, market_code, phase, created_at DESC)
  WHERE phase IN ('queued', 'running', 'paused');
