-- Preserve legacy self-hosted connector behavior after migration 095.
--
-- Migration 095 introduced auth_mode with an OAuth default, which correctly
-- fits ChatGPT but misclassifies existing self-hosted connector-token rows.
-- Those rows previously authenticated through Vakwen-issued dev tokens, so
-- keep them editable and usable as dev_token connectors.

UPDATE ai_connector_connections
SET auth_mode = 'dev_token'
WHERE provider = 'self_hosted'
  AND client_kind = 'generic_mcp'
  AND auth_mode = 'oauth';
