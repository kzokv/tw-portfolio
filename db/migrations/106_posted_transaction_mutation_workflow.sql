CREATE TABLE IF NOT EXISTS posted_transaction_mutation_previews (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  operation TEXT NOT NULL CHECK (operation IN ('update', 'delete')),
  status TEXT NOT NULL CHECK (status IN ('ready', 'expired', 'stale', 'confirmed', 'failed')),
  version INTEGER NOT NULL,
  reason TEXT NOT NULL,
  confirmation_summary TEXT NOT NULL,
  confirmation_digest TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  batch_limit INTEGER NOT NULL CHECK (batch_limit > 0),
  summary_json JSONB NOT NULL,
  warnings_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  blockers_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  errors_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  affected_account_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  affected_tickers_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  scopes_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  account_revisions_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  final_accounting_json JSONB NOT NULL,
  replay_scopes_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  confirmed_at TIMESTAMPTZ NULL,
  confirmed_run_id TEXT NULL
);

CREATE INDEX IF NOT EXISTS idx_posted_transaction_mutation_previews_owner_created
  ON posted_transaction_mutation_previews (owner_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS posted_transaction_mutation_preview_items (
  preview_id TEXT NOT NULL REFERENCES posted_transaction_mutation_previews(id) ON DELETE CASCADE,
  transaction_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  account_id TEXT NULL,
  ticker TEXT NULL,
  market_code TEXT NULL,
  status TEXT NOT NULL CHECK (status IN ('changed', 'deleted', 'unchanged', 'blocked')),
  note TEXT NULL,
  before_json JSONB NULL,
  after_json JSONB NULL,
  impacts_json JSONB NOT NULL,
  warnings_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  blockers_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  errors_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  PRIMARY KEY (preview_id, transaction_id)
);

CREATE INDEX IF NOT EXISTS idx_posted_transaction_mutation_preview_items_filter
  ON posted_transaction_mutation_preview_items (preview_id, account_id, ticker, market_code, status, ordinal);

CREATE TABLE IF NOT EXISTS posted_transaction_mutation_runs (
  id TEXT PRIMARY KEY,
  preview_id TEXT NOT NULL REFERENCES posted_transaction_mutation_previews(id) ON DELETE RESTRICT,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  operation TEXT NOT NULL CHECK (operation IN ('update', 'delete')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'partially_failed', 'failed')),
  rebuild_status TEXT NOT NULL CHECK (rebuild_status IN ('pending', 'running', 'completed', 'partially_failed', 'failed')),
  reason TEXT NOT NULL,
  warnings_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  blockers_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  errors_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  summary_json JSONB NOT NULL,
  affected_account_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  affected_tickers_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  scopes_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  fingerprint TEXT NOT NULL,
  confirmation_digest TEXT NOT NULL,
  replay_run_id TEXT NULL REFERENCES mcp_replay_position_runs(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL,
  started_at TIMESTAMPTZ NULL,
  completed_at TIMESTAMPTZ NULL,
  CONSTRAINT uq_posted_transaction_mutation_runs_preview UNIQUE (preview_id),
  CONSTRAINT uq_posted_transaction_mutation_runs_preview_digest UNIQUE (preview_id, confirmation_digest)
);

CREATE INDEX IF NOT EXISTS idx_posted_transaction_mutation_runs_owner_created
  ON posted_transaction_mutation_runs (owner_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS posted_transaction_mutation_deleted_draft_lineage (
  trade_event_id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  batch_id TEXT NOT NULL REFERENCES ai_transaction_draft_batches(id) ON DELETE RESTRICT,
  row_id TEXT NOT NULL REFERENCES ai_transaction_draft_rows(id) ON DELETE RESTRICT,
  deleted_at TIMESTAMPTZ NOT NULL,
  deleted_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  mutation_run_id TEXT NOT NULL REFERENCES posted_transaction_mutation_runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_posted_transaction_mutation_deleted_draft_lineage_owner
  ON posted_transaction_mutation_deleted_draft_lineage (owner_user_id, deleted_at DESC);

ALTER TABLE mcp_replay_position_run_scopes
  ADD COLUMN IF NOT EXISTS earliest_replay_date DATE NULL;

ALTER TABLE mcp_replay_position_run_scopes
  ADD COLUMN IF NOT EXISTS deleted_trade_event_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb;

UPDATE mcp_replay_position_run_scopes
SET deleted_trade_event_ids_json = '[]'::jsonb
WHERE deleted_trade_event_ids_json IS NULL;
