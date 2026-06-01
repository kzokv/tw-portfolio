-- Allow the account-management MCP scope anywhere connector/share capabilities
-- are persisted. Code can advertise account:manage without this migration, but
-- Postgres approval writes fail at ai_connector_connection_scopes.

ALTER TABLE ai_connector_connection_scopes
  DROP CONSTRAINT IF EXISTS ai_connector_connection_scopes_scope_check;

ALTER TABLE ai_connector_connection_scopes
  ADD CONSTRAINT ai_connector_connection_scopes_scope_check CHECK (
    scope IN (
      'portfolio:mcp_read',
      'account:manage',
      'transaction_draft:create',
      'transaction_draft:edit',
      'transaction_draft:archive',
      'transaction_draft:delete',
      'transaction:write'
    )
  );

ALTER TABLE portfolio_share_capabilities
  DROP CONSTRAINT IF EXISTS portfolio_share_capabilities_capability_check;

ALTER TABLE portfolio_share_capabilities
  ADD CONSTRAINT portfolio_share_capabilities_capability_check CHECK (
    capability IN (
      'portfolio:mcp_read',
      'account:manage',
      'transaction_draft:create',
      'transaction_draft:edit',
      'transaction_draft:archive',
      'transaction_draft:delete',
      'transaction:write'
    )
  );

ALTER TABLE pending_share_invite_capabilities
  DROP CONSTRAINT IF EXISTS pending_share_invite_capabilities_capability_check;

ALTER TABLE pending_share_invite_capabilities
  ADD CONSTRAINT pending_share_invite_capabilities_capability_check CHECK (
    capability IN (
      'portfolio:mcp_read',
      'account:manage',
      'transaction_draft:create',
      'transaction_draft:edit',
      'transaction_draft:archive',
      'transaction_draft:delete',
      'transaction:write'
    )
  );
