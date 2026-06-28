ALTER TABLE ai_connector_connections
  ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMPTZ;

ALTER TABLE ai_connector_connections
  DROP CONSTRAINT IF EXISTS ai_connector_connections_client_kind_check,
  ADD CONSTRAINT ai_connector_connections_client_kind_check CHECK (
    client_kind IN (
      'chatgpt_app',
      'claude_ai_connector',
      'claude_code',
      'codex_cli',
      'gemini_cli',
      'copilot_mcp',
      'generic_mcp'
    )
  );

DO $$
DECLARE
  had_allow_claude_ai_connector BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'ai_connector_policy_settings'
      AND column_name = 'allow_claude_ai_connector'
  ) INTO had_allow_claude_ai_connector;

  ALTER TABLE ai_connector_policy_settings
    ADD COLUMN IF NOT EXISTS allow_claude_ai_connector BOOLEAN NOT NULL DEFAULT TRUE;

  IF NOT had_allow_claude_ai_connector THEN
    UPDATE ai_connector_policy_settings
    SET allow_claude_ai_connector = COALESCE(allow_chatgpt_app, allow_chatgpt, TRUE);
  END IF;
END $$;

ALTER TABLE ai_connector_policy_settings
  DROP CONSTRAINT IF EXISTS ai_connector_policy_settings_bearer_allowed_client_kinds_check,
  ADD CONSTRAINT ai_connector_policy_settings_bearer_allowed_client_kinds_check CHECK (
    bearer_allowed_client_kinds <@ ARRAY[
      'chatgpt_app',
      'claude_code',
      'codex_cli',
      'gemini_cli',
      'copilot_mcp',
      'generic_mcp'
    ]::text[]
  );
