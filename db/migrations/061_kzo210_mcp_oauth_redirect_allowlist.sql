-- KZO-210 Phase 2 follow-up — admin-configurable MCP OAuth redirect allowlist.
--
-- Rollback notes:
-- - Safe to leave in place if application code is rolled back.
-- - To disable all custom additions operationally:
--     UPDATE ai_connector_policy_settings SET oauth_redirect_uri_allowlist = ARRAY[]::text[];
-- - Built-in ChatGPT redirect URI patterns remain application-level defaults.

ALTER TABLE ai_connector_policy_settings
  ADD COLUMN IF NOT EXISTS oauth_redirect_uri_allowlist TEXT[] NOT NULL DEFAULT ARRAY[]::text[];

COMMENT ON COLUMN ai_connector_policy_settings.oauth_redirect_uri_allowlist IS
  'Additional exact OAuth redirect URIs allowed for MCP connector authorization. Built-in ChatGPT defaults are handled in application code.';
