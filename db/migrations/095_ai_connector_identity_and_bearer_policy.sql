-- Additive connector identity model for the all-in-one MCP server.
--
-- Rollback notes:
-- - Forward-only migration. Old `provider` columns and policy toggles remain
--   intact for transitional compatibility.
-- - To roll back application behavior, stop reading these new columns; do not
--   drop them until all deployed app versions no longer depend on them.

ALTER TABLE ai_connector_connections
  ADD COLUMN IF NOT EXISTS vendor TEXT,
  ADD COLUMN IF NOT EXISTS client_kind TEXT,
  ADD COLUMN IF NOT EXISTS auth_mode TEXT NOT NULL DEFAULT 'oauth',
  ADD COLUMN IF NOT EXISTS capabilities TEXT[] NOT NULL DEFAULT ARRAY[]::text[];

UPDATE ai_connector_connections
SET vendor = CASE provider
    WHEN 'chatgpt' THEN 'openai'
    WHEN 'self_hosted' THEN 'generic'
    ELSE COALESCE(vendor, 'generic')
  END,
  client_kind = CASE provider
    WHEN 'chatgpt' THEN 'chatgpt_app'
    WHEN 'self_hosted' THEN 'generic_mcp'
    ELSE COALESCE(client_kind, 'generic_mcp')
  END,
  capabilities = CASE provider
    WHEN 'chatgpt' THEN ARRAY['oauth', 'widgets', 'interactive_ops', 'deep_link_fallback']::text[]
    WHEN 'self_hosted' THEN ARRAY['bearer_fallback', 'deep_link_fallback']::text[]
    ELSE capabilities
  END
WHERE vendor IS NULL OR client_kind IS NULL OR capabilities = ARRAY[]::text[];

ALTER TABLE ai_connector_connections
  ALTER COLUMN vendor SET NOT NULL,
  ALTER COLUMN client_kind SET NOT NULL;

ALTER TABLE ai_connector_connections
  DROP CONSTRAINT IF EXISTS ai_connector_connections_vendor_check,
  ADD CONSTRAINT ai_connector_connections_vendor_check CHECK (
    vendor IN ('openai', 'anthropic', 'openai_codex', 'google', 'microsoft', 'generic')
  );

ALTER TABLE ai_connector_connections
  DROP CONSTRAINT IF EXISTS ai_connector_connections_client_kind_check,
  ADD CONSTRAINT ai_connector_connections_client_kind_check CHECK (
    client_kind IN ('chatgpt_app', 'claude_code', 'codex_cli', 'gemini_cli', 'copilot_mcp', 'generic_mcp')
  );

ALTER TABLE ai_connector_connections
  DROP CONSTRAINT IF EXISTS ai_connector_connections_auth_mode_check,
  ADD CONSTRAINT ai_connector_connections_auth_mode_check CHECK (
    auth_mode IN ('oauth', 'bearer', 'dev_token')
  );

ALTER TABLE ai_connector_connections
  DROP CONSTRAINT IF EXISTS ai_connector_connections_capabilities_check,
  ADD CONSTRAINT ai_connector_connections_capabilities_check CHECK (
    capabilities <@ ARRAY['oauth', 'bearer_fallback', 'widgets', 'interactive_ops', 'deep_link_fallback']::text[]
  );

CREATE UNIQUE INDEX IF NOT EXISTS ux_ai_connector_connections_user_client_kind_auth_active
  ON ai_connector_connections (user_id, vendor, client_kind, auth_mode)
  WHERE status = 'active';

ALTER TABLE ai_connector_policy_settings
  ADD COLUMN IF NOT EXISTS allow_chatgpt_app BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS allow_claude_code BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS allow_codex_cli BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS allow_gemini_cli BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS allow_copilot_mcp BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS allow_generic_mcp BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS bearer_fallback_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS bearer_allowed_client_kinds TEXT[] NOT NULL DEFAULT ARRAY['claude_code', 'codex_cli', 'gemini_cli', 'copilot_mcp', 'generic_mcp']::text[],
  ADD COLUMN IF NOT EXISTS bearer_max_lifetime_days INTEGER NOT NULL DEFAULT 30 CHECK (bearer_max_lifetime_days BETWEEN 1 AND 365),
  ADD COLUMN IF NOT EXISTS bearer_max_active_connectors_per_user INTEGER NOT NULL DEFAULT 3 CHECK (bearer_max_active_connectors_per_user BETWEEN 1 AND 25),
  ADD COLUMN IF NOT EXISTS bearer_allowed_tool_groups TEXT[] NOT NULL DEFAULT ARRAY['read']::text[];

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'ai_connector_policy_settings'
      AND column_name = 'client_allowlists_migrated_at'
  ) THEN
    UPDATE ai_connector_policy_settings
    SET allow_chatgpt_app = allow_chatgpt,
        allow_claude_code = allow_self_hosted,
        allow_codex_cli = allow_self_hosted,
        allow_gemini_cli = allow_self_hosted,
        allow_copilot_mcp = allow_self_hosted,
        allow_generic_mcp = allow_self_hosted
    WHERE client_allowlists_migrated_at IS NULL;
  ELSE
    UPDATE ai_connector_policy_settings
    SET allow_chatgpt_app = allow_chatgpt,
        allow_claude_code = allow_self_hosted,
        allow_codex_cli = allow_self_hosted,
        allow_gemini_cli = allow_self_hosted,
        allow_copilot_mcp = allow_self_hosted,
        allow_generic_mcp = allow_self_hosted
    WHERE allow_chatgpt_app = TRUE
      AND allow_claude_code = TRUE
      AND allow_codex_cli = TRUE
      AND allow_gemini_cli = TRUE
      AND allow_copilot_mcp = TRUE
      AND allow_generic_mcp = TRUE;
  END IF;
END $$;

ALTER TABLE ai_connector_policy_settings
  ADD COLUMN IF NOT EXISTS client_allowlists_migrated_at TIMESTAMPTZ;

UPDATE ai_connector_policy_settings
SET client_allowlists_migrated_at = COALESCE(client_allowlists_migrated_at, NOW());

ALTER TABLE ai_connector_policy_settings
  DROP CONSTRAINT IF EXISTS ai_connector_policy_settings_bearer_allowed_client_kinds_check,
  ADD CONSTRAINT ai_connector_policy_settings_bearer_allowed_client_kinds_check CHECK (
    bearer_allowed_client_kinds <@ ARRAY['chatgpt_app', 'claude_code', 'codex_cli', 'gemini_cli', 'copilot_mcp', 'generic_mcp']::text[]
  );

ALTER TABLE ai_connector_policy_settings
  DROP CONSTRAINT IF EXISTS ai_connector_policy_settings_bearer_allowed_tool_groups_check,
  ADD CONSTRAINT ai_connector_policy_settings_bearer_allowed_tool_groups_check CHECK (
    bearer_allowed_tool_groups <@ ARRAY['read', 'drafts', 'write']::text[]
  );

ALTER TABLE ai_connector_credentials
  DROP CONSTRAINT IF EXISTS ai_connector_credentials_credential_type_check;

ALTER TABLE ai_connector_credentials
  ADD CONSTRAINT ai_connector_credentials_credential_type_check CHECK (
    credential_type IN ('oauth_refresh_token', 'self_hosted_token', 'bearer_token')
  );
