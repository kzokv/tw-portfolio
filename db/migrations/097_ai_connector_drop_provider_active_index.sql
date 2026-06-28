-- Drop the legacy provider-level active connector index now that active
-- identity is scoped by vendor + client_kind + auth_mode.
--
-- The old index blocks multiple active `self_hosted` bearer connectors for
-- different client kinds such as Claude Code and Codex CLI.

DROP INDEX IF EXISTS ux_ai_connector_connections_user_provider_active;
