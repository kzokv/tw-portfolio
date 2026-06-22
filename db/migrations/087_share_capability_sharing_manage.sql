-- Allow delegated sharing management to be persisted on named-share grants
-- and pending share-coupled invites. This is intentionally not added to
-- ai_connector_connection_scopes because sharing:manage is not an MCP scope.

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
      'transaction:write',
      'sharing:manage'
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
      'transaction:write',
      'sharing:manage'
    )
  );
