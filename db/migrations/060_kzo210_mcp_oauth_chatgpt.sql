-- KZO-210 Phase 2 — ChatGPT-compatible OAuth for the MCP connector.
--
-- Rollback notes:
-- - Forward-only migration. Disable OAuth at the application/policy layer
--   before rolling back application code.
-- - Existing connector rows are preserved; `pending` rows may be revoked or
--   expired operationally without dropping data.

ALTER TABLE ai_connector_connections
  DROP CONSTRAINT IF EXISTS ai_connector_connections_status_check;

ALTER TABLE ai_connector_connections
  ADD CONSTRAINT ai_connector_connections_status_check
  CHECK (status IN ('pending', 'active', 'expired', 'revoked'));

ALTER TABLE ai_connector_policy_settings
  ADD COLUMN IF NOT EXISTS max_connector_lifetime_days INTEGER NOT NULL DEFAULT 90
    CHECK (max_connector_lifetime_days BETWEEN 1 AND 365),
  ADD COLUMN IF NOT EXISTS oauth_public_issuer TEXT
    CHECK (oauth_public_issuer IS NULL OR oauth_public_issuer ~ '^https://[^[:space:]/#?]+(:[0-9]+)?$');

ALTER TABLE public.app_config
  ADD COLUMN IF NOT EXISTS mcp_oauth_token_secret TEXT;

ALTER TABLE ai_connector_credentials
  ADD COLUMN IF NOT EXISTS token_family_id TEXT,
  ADD COLUMN IF NOT EXISTS predecessor_credential_id TEXT REFERENCES ai_connector_credentials(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS replaced_by_credential_id TEXT REFERENCES ai_connector_credentials(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS oauth_client_id TEXT,
  ADD COLUMN IF NOT EXISTS resource TEXT,
  ADD COLUMN IF NOT EXISTS scopes TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS session_version INTEGER;

ALTER TABLE ai_connector_credentials
  DROP CONSTRAINT IF EXISTS ai_connector_credentials_credential_type_check;

ALTER TABLE ai_connector_credentials
  ADD CONSTRAINT ai_connector_credentials_credential_type_check
  CHECK (credential_type IN ('oauth_refresh_token', 'self_hosted_token'));

CREATE INDEX IF NOT EXISTS idx_ai_connector_credentials_token_hash
  ON ai_connector_credentials (token_hash);

CREATE INDEX IF NOT EXISTS idx_ai_connector_credentials_connection_active
  ON ai_connector_credentials (connection_id, credential_type)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS mcp_oauth_authorization_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  state TEXT,
  resource TEXT NOT NULL,
  scopes TEXT[] NOT NULL,
  code_challenge TEXT NOT NULL,
  code_challenge_method TEXT NOT NULL CHECK (code_challenge_method = 'S256'),
  csrf_token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  approved_at TIMESTAMPTZ,
  denied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (approved_at IS NULL OR denied_at IS NULL)
);

CREATE INDEX IF NOT EXISTS idx_mcp_oauth_authorization_requests_user_created
  ON mcp_oauth_authorization_requests (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_mcp_oauth_authorization_requests_expires
  ON mcp_oauth_authorization_requests (expires_at);

CREATE TABLE IF NOT EXISTS mcp_oauth_authorization_codes (
  id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  connection_id TEXT NOT NULL REFERENCES ai_connector_connections(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  resource TEXT NOT NULL,
  scopes TEXT[] NOT NULL,
  code_challenge TEXT NOT NULL,
  code_challenge_method TEXT NOT NULL CHECK (code_challenge_method = 'S256'),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mcp_oauth_authorization_codes_connection
  ON mcp_oauth_authorization_codes (connection_id);

CREATE INDEX IF NOT EXISTS idx_mcp_oauth_authorization_codes_expires
  ON mcp_oauth_authorization_codes (expires_at);
