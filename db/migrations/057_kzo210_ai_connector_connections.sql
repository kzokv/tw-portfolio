-- KZO-210 — AI connector persistence foundation.
--
-- Rollback notes:
-- - Forward-only migration. Revert behavior in application code first, then
--   archive or ignore these tables; do not drop them in-place on a live system.
-- - Revocation/expiry are modeled as row state so operational rollback should
--   prefer UPDATE-based disablement over destructive schema changes.

CREATE TABLE IF NOT EXISTS ai_connector_connections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('chatgpt', 'self_hosted')),
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'revoked')),
  oauth_client_id TEXT,
  oauth_subject TEXT,
  expires_at TIMESTAMPTZ,
  expiry_notified_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revoked_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  revocation_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (revoked_at IS NULL OR status = 'revoked')
);

CREATE INDEX IF NOT EXISTS idx_ai_connector_connections_user_status_expires
  ON ai_connector_connections (user_id, status, expires_at);

CREATE INDEX IF NOT EXISTS idx_ai_connector_connections_user_created
  ON ai_connector_connections (user_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS ux_ai_connector_connections_user_provider_active
  ON ai_connector_connections (user_id, provider)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS ai_connector_policy_settings (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  max_active_connections_per_user INTEGER NOT NULL DEFAULT 3 CHECK (max_active_connections_per_user BETWEEN 1 AND 25),
  allow_chatgpt BOOLEAN NOT NULL DEFAULT TRUE,
  allow_self_hosted BOOLEAN NOT NULL DEFAULT TRUE,
  read_tools_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  draft_tools_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  write_tools_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  inactivity_expiry_days INTEGER NOT NULL DEFAULT 90 CHECK (inactivity_expiry_days BETWEEN 1 AND 365),
  expiration_warning_days INTEGER NOT NULL DEFAULT 7 CHECK (expiration_warning_days BETWEEN 1 AND 60),
  fresh_auth_max_age_ms INTEGER NOT NULL DEFAULT 600000 CHECK (fresh_auth_max_age_ms BETWEEN 60000 AND 86400000),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO ai_connector_policy_settings (id)
VALUES (TRUE)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS ai_connector_connection_scopes (
  connection_id TEXT NOT NULL REFERENCES ai_connector_connections(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (
    scope IN (
      'portfolio:mcp_read',
      'transaction_draft:create',
      'transaction_draft:edit',
      'transaction_draft:archive',
      'transaction_draft:delete',
      'transaction:write'
    )
  ),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (connection_id, scope)
);

CREATE TABLE IF NOT EXISTS ai_connector_tool_toggles (
  connection_id TEXT NOT NULL REFERENCES ai_connector_connections(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (connection_id, tool_name),
  CHECK (tool_name ~ '^[a-z][a-z0-9_]{0,127}$')
);

CREATE TABLE IF NOT EXISTS ai_connector_credentials (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL REFERENCES ai_connector_connections(id) ON DELETE CASCADE,
  credential_type TEXT NOT NULL CHECK (credential_type IN ('oauth_refresh_token', 'self_hosted_token')),
  token_hash TEXT NOT NULL,
  token_hint TEXT,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  UNIQUE (connection_id, credential_type, token_hash)
);

CREATE TABLE IF NOT EXISTS ai_connector_access_logs (
  id TEXT PRIMARY KEY,
  connection_id TEXT REFERENCES ai_connector_connections(id) ON DELETE SET NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  portfolio_context_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  share_id TEXT REFERENCES portfolio_shares(id) ON DELETE SET NULL,
  tool_name TEXT NOT NULL,
  access_kind TEXT NOT NULL CHECK (access_kind IN ('read', 'draft_create', 'draft_update', 'draft_archive', 'draft_delete', 'write')),
  result TEXT NOT NULL CHECK (result IN ('ok', 'denied', 'error')),
  denial_reason TEXT,
  request_id TEXT,
  source_ip INET,
  user_agent TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_connector_access_logs_connection_created
  ON ai_connector_access_logs (connection_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_connector_access_logs_user_created
  ON ai_connector_access_logs (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_connector_access_logs_context_user_created
  ON ai_connector_access_logs (portfolio_context_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_connector_access_logs_tool_created
  ON ai_connector_access_logs (tool_name, created_at DESC);
