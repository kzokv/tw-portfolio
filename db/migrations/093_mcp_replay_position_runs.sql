CREATE TABLE IF NOT EXISTS mcp_replay_position_previews (
  id TEXT PRIMARY KEY,
  session_user_id TEXT NOT NULL,
  portfolio_context_user_id TEXT NOT NULL,
  scopes_json JSONB NOT NULL,
  warnings_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  confirmation_summary TEXT NOT NULL,
  confirmation_digest TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_mcp_replay_position_previews_context
  ON mcp_replay_position_previews (portfolio_context_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS mcp_replay_position_runs (
  id TEXT PRIMARY KEY,
  preview_id TEXT NOT NULL REFERENCES mcp_replay_position_previews(id) ON DELETE RESTRICT,
  session_user_id TEXT NOT NULL,
  portfolio_context_user_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'completed_with_failures', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TIMESTAMPTZ NULL,
  finished_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_mcp_replay_position_runs_context
  ON mcp_replay_position_runs (portfolio_context_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS mcp_replay_position_run_scopes (
  run_id TEXT NOT NULL REFERENCES mcp_replay_position_runs(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL,
  account_name TEXT NOT NULL,
  ticker TEXT NOT NULL,
  market_code TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'succeeded', 'failed')),
  error_message TEXT NULL,
  replayed_trade_count INTEGER NULL,
  snapshot_generation_run_id TEXT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (run_id, account_id, ticker, market_code)
);

