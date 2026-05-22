---
slug: kzo-209
type: spike
created: 2026-05-21T19:05
tickets: [KZO-209]
depends_on: [KZO-208]
---

# KZO-209 - AI Connector, Share Capability, And Draft Data Model

## Outcome

Use an additive Postgres data model that extends the existing user/share/notification/audit foundations:

- Connector state is first-class and owned by a user, with separate scope, tool-toggle, credential, and access-log tables.
- Share AI access is capability-based and defaults off for all existing and new shares.
- Transaction draft batches are durable objects tied to a portfolio context, with row-level optimistic concurrency, unsupported source audit items, and append-only draft events.
- Transactions badge counts should be derived from draft tables first, not persisted as a separate counter table.
- Notifications reuse the existing `notifications` table with `source = 'ai_transaction_draft'` and `source_ref = batch_id`.

This design intentionally does not reuse browser session cookies for MCP. It follows the KZO-208 decision: hosted ChatGPT uses OAuth-style connector authorization, while self-hosted token mode is optional and token hashes are stored only as connector credentials.

## Existing Model Fit

Relevant current tables:

- `users` owns authenticated identities, roles, session version, demo lifecycle.
- `audit_log` is global/admin-facing and constrained by an action CHECK.
- `portfolio_shares` models owner -> grantee read-only access with active uniqueness.
- `invites.share_owner_user_id` supports pending share-coupled invites.
- `notifications` already supports user-facing source/source_ref/detail rows, unread counts, dismissal, and escalation.
- `trade_events` is the canonical posted transaction table; draft rows should reference confirmed trade events after posting, not write directly during MCP draft creation.

Current gaps:

- `portfolio_shares` has no capability granularity.
- Existing notification unread count is global; Transactions needs a domain-specific badge count.
- Existing `/ai/transactions/parse` and `/ai/transactions/confirm` are proto routes and do not model persistent draft lifecycle.
- Existing baseline migration only supersedes migrations through `018`; new work should be append-only numbered migrations after `056`.

## Capability Vocabulary

Use stable string capabilities:

```ts
export type AiConnectorScope =
  | "portfolio:mcp_read"
  | "transaction_draft:create"
  | "transaction_draft:edit"
  | "transaction_draft:archive"
  | "transaction_draft:delete"
  | "transaction:write";

export type ShareCapability = AiConnectorScope;
```

Rules:

- `portfolio:mcp_read` is required before any portfolio read MCP tool can access a shared portfolio.
- Draft capabilities are independent:
  - `transaction_draft:create`
  - `transaction_draft:edit`
  - `transaction_draft:archive`
  - `transaction_draft:delete`
- `transaction:write` is reserved for future owner-approved posting/write flows. V1 should not expose final posting over MCP even if the schema can represent it.
- Existing shares and newly created default shares get no AI capabilities.
- Capabilities on pending share invites must materialize onto `portfolio_shares` when the invite is consumed.

## Connector Tables

### `ai_connector_connections`

One row per connected external client/app.

```sql
CREATE TABLE ai_connector_connections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('chatgpt', 'self_hosted')),
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'expired', 'revoked')),
  oauth_client_id TEXT,
  oauth_subject TEXT,
  expires_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revoked_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  revocation_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (revoked_at IS NULL OR status = 'revoked')
);
```

Indexes:

- `(user_id, status, expires_at)`
- `(user_id, created_at DESC)`
- partial active index on `(user_id, provider)` where `status = 'active'`

Notes:

- `status = 'expired'` may be derived from `expires_at`, but storing it makes revocation/expiry UI and background cleanup simpler. Use service code to keep it consistent.
- `oauth_client_id` supports ChatGPT DCR/predefined-client correlation.
- `oauth_subject` is optional and should not replace `user_id`.

### `ai_connector_connection_scopes`

```sql
CREATE TABLE ai_connector_connection_scopes (
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
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (connection_id, scope)
);
```

### `ai_connector_tool_toggles`

Advanced per-tool narrowing. Group scopes are the ceiling; tool toggles can only disable or narrow behavior.

```sql
CREATE TABLE ai_connector_tool_toggles (
  connection_id TEXT NOT NULL REFERENCES ai_connector_connections(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (connection_id, tool_name),
  CHECK (tool_name ~ '^[a-z][a-z0-9_]{0,127}$')
);
```

### `ai_connector_credentials`

Stores refresh-token or self-hosted token hashes only. Access tokens can be JWTs and do not need a row unless opaque-token introspection is chosen.

```sql
CREATE TABLE ai_connector_credentials (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL REFERENCES ai_connector_connections(id) ON DELETE CASCADE,
  credential_type TEXT NOT NULL CHECK (credential_type IN ('oauth_refresh_token', 'self_hosted_token')),
  token_hash TEXT NOT NULL,
  token_hint TEXT,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  UNIQUE (connection_id, credential_type, token_hash)
);
```

### `ai_connector_access_logs`

Recent access log for user settings and admin audit support. This is operational/access history, not the permanent draft event stream.

```sql
CREATE TABLE ai_connector_access_logs (
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Indexes:

- `(connection_id, created_at DESC)`
- `(user_id, created_at DESC)`
- `(portfolio_context_user_id, created_at DESC)`
- `(tool_name, created_at DESC)`

Retention:

- Keep detailed logs for an admin-configured period, then aggregate or purge.
- Never log prompt text, raw file contents, auth tokens, or full source snippets here.

## Share Capability Tables

### `portfolio_share_capabilities`

```sql
CREATE TABLE portfolio_share_capabilities (
  share_id TEXT NOT NULL REFERENCES portfolio_shares(id) ON DELETE CASCADE,
  capability TEXT NOT NULL CHECK (
    capability IN (
      'portfolio:mcp_read',
      'transaction_draft:create',
      'transaction_draft:edit',
      'transaction_draft:archive',
      'transaction_draft:delete',
      'transaction:write'
    )
  ),
  granted_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (share_id, capability)
);
```

### `pending_share_invite_capabilities`

```sql
CREATE TABLE pending_share_invite_capabilities (
  invite_code TEXT NOT NULL REFERENCES invites(code) ON DELETE CASCADE,
  capability TEXT NOT NULL CHECK (
    capability IN (
      'portfolio:mcp_read',
      'transaction_draft:create',
      'transaction_draft:edit',
      'transaction_draft:archive',
      'transaction_draft:delete',
      'transaction:write'
    )
  ),
  granted_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (invite_code, capability)
);
```

Service rules:

- Existing active shares receive zero rows in `portfolio_share_capabilities`.
- New normal share grants receive zero capability rows unless the owner explicitly chooses an AI-enabled preset.
- Pending invite materialization must copy `pending_share_invite_capabilities` to the new `portfolio_share_capabilities` rows in the same transaction as share creation.
- Updating capabilities should write global `audit_log` action `share_capabilities_updated` with old/new capability arrays.

## Draft Tables

### `ai_transaction_draft_batches`

```sql
CREATE TABLE ai_transaction_draft_batches (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connector_connection_id TEXT REFERENCES ai_connector_connections(id) ON DELETE SET NULL,
  share_id TEXT REFERENCES portfolio_shares(id) ON DELETE SET NULL,
  source_channel TEXT NOT NULL CHECK (source_channel IN ('mcp', 'web')),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'archived', 'deleted')),
  version INT NOT NULL DEFAULT 1 CHECK (version > 0),
  source_label TEXT,
  source_filename TEXT,
  note TEXT,
  provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
  row_count INT NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  unsupported_count INT NOT NULL DEFAULT 0 CHECK (unsupported_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ,
  archived_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  deleted_at TIMESTAMPTZ,
  deleted_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (id, owner_user_id),
  CHECK (source_label IS NULL OR char_length(source_label) <= 200),
  CHECK (source_filename IS NULL OR char_length(source_filename) <= 200),
  CHECK (note IS NULL OR char_length(note) <= 1000)
);
```

Important fields:

- `owner_user_id`: portfolio context owner. This is the user whose portfolio would receive final posted trades.
- `created_by_user_id`: connected user/principal. For owner-created batches it equals `owner_user_id`; for shared AI access it is the grantee.
- `share_id`: populated only for shared-context drafts, used for audit and reauthorization. If the share is revoked later, existing batches remain visible to the owner and hidden/forbidden to the grantee.
- `version`: optimistic concurrency for batch-level archive/delete actions.

Indexes:

- `(owner_user_id, status, updated_at DESC)`
- `(created_by_user_id, updated_at DESC)`
- `(connector_connection_id, created_at DESC)`
- `(share_id, created_at DESC)` where `share_id IS NOT NULL`

### `ai_transaction_draft_rows`

```sql
CREATE TABLE ai_transaction_draft_rows (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES ai_transaction_draft_batches(id) ON DELETE CASCADE,
  owner_user_id TEXT NOT NULL,
  row_number INT NOT NULL CHECK (row_number > 0),
  state TEXT NOT NULL CHECK (
    state IN (
      'needs_clarification',
      'pending_validation',
      'ready',
      'invalid',
      'duplicate_blocked',
      'excluded',
      'rejected',
      'confirmed',
      'unsupported'
    )
  ),
  version INT NOT NULL DEFAULT 1 CHECK (version > 0),
  account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  account_name_input TEXT,
  trade_type TEXT CHECK (trade_type IN ('BUY', 'SELL')),
  ticker TEXT,
  market_code TEXT CHECK (market_code IS NULL OR market_code ~ '^[A-Z]{2,10}$'),
  quantity INT CHECK (quantity IS NULL OR quantity > 0),
  unit_price NUMERIC(20, 4) CHECK (unit_price IS NULL OR unit_price >= 0),
  price_currency TEXT CHECK (price_currency IS NULL OR price_currency ~ '^[A-Z]{3}$'),
  trade_date DATE,
  trade_timestamp TIMESTAMPTZ,
  booking_sequence INT CHECK (booking_sequence IS NULL OR booking_sequence > 0),
  is_day_trade BOOLEAN,
  commission_amount NUMERIC(20, 4) CHECK (commission_amount IS NULL OR commission_amount >= 0),
  tax_amount NUMERIC(20, 4) CHECK (tax_amount IS NULL OR tax_amount >= 0),
  fees_source TEXT CHECK (fees_source IS NULL OR fees_source IN ('CALCULATED', 'MANUAL', 'SOURCE_PROVIDED')),
  note TEXT,
  source_row_ref TEXT,
  source_snippet TEXT,
  normalized_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  preflight_issues JSONB NOT NULL DEFAULT '[]'::jsonb,
  warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  duplicate_trade_event_id TEXT REFERENCES trade_events(id) ON DELETE SET NULL,
  confirmed_trade_event_id TEXT REFERENCES trade_events(id) ON DELETE SET NULL,
  confirmed_at TIMESTAMPTZ,
  confirmed_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (batch_id, owner_user_id) REFERENCES ai_transaction_draft_batches(id, owner_user_id) ON DELETE CASCADE,
  UNIQUE (batch_id, row_number),
  CHECK (source_snippet IS NULL OR char_length(source_snippet) <= 500),
  CHECK (note IS NULL OR char_length(note) <= 1000)
);
```

Notes:

- `unit_price NUMERIC(20, 4)` preserves parsed/provider precision. Posting may still round or reject according to the canonical transaction path.
- `owner_user_id` is intentionally duplicated so Postgres can enforce that a row belongs to a batch for the same portfolio owner. Account ownership still needs route/service validation before insert/update.
- `normalized_payload` stores the bounded normalized candidate object used by deterministic preflight, not raw file contents.
- `preflight_issues` and `warnings` should be arrays with service-enforced caps.
- `confirmed_trade_event_id` links audit history to the canonical posted row.

Indexes:

- `(batch_id, state, row_number)`
- `(batch_id, updated_at DESC)`
- `(owner lookup via batch join)` can use batch indexes first; add a covering row index only if query plans require it.
- partial `(confirmed_trade_event_id)` where not null.

### `ai_transaction_draft_unsupported_items`

Rows ChatGPT or deterministic parsing could identify but V1 will not draft, for example dividends, cash movements, FX transfers, or corporate actions.

```sql
CREATE TABLE ai_transaction_draft_unsupported_items (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES ai_transaction_draft_batches(id) ON DELETE CASCADE,
  row_number INT,
  category TEXT NOT NULL,
  reason TEXT NOT NULL,
  source_snippet TEXT,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (source_snippet IS NULL OR char_length(source_snippet) <= 500)
);
```

Index:

- `(batch_id, row_number NULLS LAST)`

### `ai_transaction_draft_events`

Permanent append-only audit stream for draft lifecycle. Do not cascade-delete it when a batch is soft-deleted or future-purged.

```sql
CREATE TABLE ai_transaction_draft_events (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  row_id TEXT,
  owner_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  connector_connection_id TEXT REFERENCES ai_connector_connections(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'batch_created',
      'preflight_run',
      'row_updated',
      'row_state_changed',
      'rows_excluded',
      'rows_reincluded',
      'rows_rejected',
      'rows_confirmed',
      'batch_archived',
      'batch_deleted'
    )
  ),
  summary TEXT,
  before_state JSONB,
  after_state JSONB,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_ip INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Indexes:

- `(batch_id, created_at ASC)`
- `(owner_user_id, created_at DESC)`
- `(actor_user_id, created_at DESC)`
- `(connector_connection_id, created_at DESC)`

Why no FK to draft batch/row:

- The event stream must survive user-visible deletion or future draft purge.
- `batch_id` and `row_id` remain stable textual identifiers for audit lookup.

## Notifications And Badge Counts

Reuse `notifications`.

Recommended notification shape:

```ts
{
  source: "ai_transaction_draft",
  sourceRef: batchId,
  title: "Transaction draft ready for review",
  detail: {
    batchId,
    contextUserId: ownerUserId,
    readyRowCount,
    issueRowCount,
    unsupportedCount,
    deepLink: `/transactions?tab=ai-inbox&batch=${batchId}&context=${ownerUserId}`
  }
}
```

Transactions badge DTO:

```ts
export interface TransactionAiInboxBadgeDto {
  openBatchCount: number;
  actionRequiredRowCount: number;
  readyRowCount: number;
  latestBatchId: string | null;
}
```

Derive counts with queries over `ai_transaction_draft_batches` + rows:

- `openBatchCount`: open, non-deleted batches visible to the session/context.
- `actionRequiredRowCount`: rows in `needs_clarification`, `invalid`, `duplicate_blocked`, `pending_validation`.
- `readyRowCount`: rows in `ready`.

Do not add a badge counter table in v1. The row volume is capped at 200 rows per batch, and indexes above are sufficient until proven otherwise.

## DTO Contracts

Add shared types under `libs/shared-types/src/index.ts`.

```ts
export type AiConnectorProvider = "chatgpt" | "self_hosted";
export type AiConnectorStatus = "active" | "expired" | "revoked";

export interface AiConnectorConnectionDto {
  id: string;
  provider: AiConnectorProvider;
  displayName: string;
  status: AiConnectorStatus;
  scopes: AiConnectorScope[];
  toolToggles: Record<string, boolean>;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  revocationReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AiConnectorAccessLogDto {
  id: string;
  connectionId: string | null;
  portfolioContextUserId: string;
  shareId: string | null;
  toolName: string;
  accessKind: string;
  result: "ok" | "denied" | "error";
  denialReason: string | null;
  createdAt: string;
}
```

Extend sharing DTOs:

```ts
export interface ShareGrantDto {
  // existing fields...
  capabilities: ShareCapability[];
}

export interface PendingShareInviteDto {
  // existing fields...
  capabilities: ShareCapability[];
}
```

Draft DTOs:

```ts
export type TransactionDraftBatchStatus = "open" | "archived" | "deleted";
export type TransactionDraftRowState =
  | "needs_clarification"
  | "pending_validation"
  | "ready"
  | "invalid"
  | "duplicate_blocked"
  | "excluded"
  | "rejected"
  | "confirmed"
  | "unsupported";

export interface TransactionDraftBatchDto {
  id: string;
  ownerUserId: string;
  createdByUserId: string;
  connectorConnectionId: string | null;
  shareId: string | null;
  sourceChannel: "mcp" | "web";
  status: TransactionDraftBatchStatus;
  version: number;
  sourceLabel: string | null;
  sourceFilename: string | null;
  note: string | null;
  rowCount: number;
  unsupportedCount: number;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  deletedAt: string | null;
}

export interface TransactionDraftRowDto {
  id: string;
  batchId: string;
  rowNumber: number;
  state: TransactionDraftRowState;
  version: number;
  accountId: string | null;
  accountNameInput: string | null;
  type: "BUY" | "SELL" | null;
  ticker: string | null;
  marketCode: "TW" | "US" | "AU" | null;
  quantity: number | null;
  unitPrice: number | null;
  priceCurrency: string | null;
  tradeDate: string | null;
  isDayTrade: boolean | null;
  commissionAmount: number | null;
  taxAmount: number | null;
  feesSource: "CALCULATED" | "MANUAL" | "SOURCE_PROVIDED" | null;
  sourceRowRef: string | null;
  sourceSnippet: string | null;
  preflightIssues: unknown[];
  warnings: unknown[];
  confirmedTradeEventId: string | null;
  confirmedAt: string | null;
  updatedAt: string;
}

export interface TransactionDraftUnsupportedItemDto {
  id: string;
  batchId: string;
  rowNumber: number | null;
  category: string;
  reason: string;
  sourceSnippet: string | null;
  createdAt: string;
}

export interface TransactionDraftBatchDetailDto {
  batch: TransactionDraftBatchDto;
  rows: TransactionDraftRowDto[];
  unsupportedItems: TransactionDraftUnsupportedItemDto[];
}
```

## Migration Sequence

Use new append-only migrations after `056_kzo201_ticker_fundamentals.sql`.

1. `057_kzo209_ai_connector_connections.sql`
   - Create connector connection, scope, tool-toggle, credential, access-log tables.
   - Add audit actions: `ai_connector_connected`, `ai_connector_revoked`.
   - No backfill.

2. `058_kzo209_share_capabilities.sql`
   - Create `portfolio_share_capabilities`.
   - Create `pending_share_invite_capabilities`.
   - Add audit action `share_capabilities_updated`.
   - Backfill: no rows for existing shares. This preserves current read-only behavior and keeps AI access explicitly opt-in.

3. `059_kzo209_ai_transaction_drafts.sql`
   - Create draft batch, row, unsupported-item, and event tables.
   - Add all indexes.
   - No backfill.

4. `060_kzo209_ai_notifications_contract.sql`
   - Schema may not need a table change because `notifications.source/source_ref/detail` already fit.
   - If product wants constrained notification source values, do not add a CHECK; existing `source` is intentionally extensible.
   - Add tests/DTOs/routes for badge count and source-specific notifications.

5. Follow-up implementation migrations only if needed:
   - App-config fields for connector expiry min/default/max, access-log retention, and MCP rate limits.
   - Draft purge retention after product locks retention behavior.

## Rollback Notes

Operational rollback should disable MCP/draft feature flags first, then leave tables in place. Since all tables are additive, the safest rollback is code rollback plus inert data.

If a database rollback is explicitly required:

1. Export `ai_connector_*`, `portfolio_share_capabilities`, `pending_share_invite_capabilities`, and `ai_transaction_draft_*` tables first.
2. Drop feature routes/jobs so no writer can touch the tables.
3. Drop child tables before parents:
   - `ai_connector_access_logs`
   - `ai_connector_credentials`
   - `ai_connector_tool_toggles`
   - `ai_connector_connection_scopes`
   - `ai_transaction_draft_events`
   - `ai_transaction_draft_unsupported_items`
   - `ai_transaction_draft_rows`
   - `ai_transaction_draft_batches`
   - `pending_share_invite_capabilities`
   - `portfolio_share_capabilities`
   - `ai_connector_connections`
4. Rebuild `audit_log_action_check` without the new actions only after confirming no rows use them, or leave the widened CHECK in place. Leaving it widened is lower risk.

Do not delete `notifications` rows during rollback; they are harmless if source-specific UI is gone and can still be dismissed by users.

## Open Decisions For Implementation

- Whether to implement OAuth tokens as signed JWTs only, opaque DB-backed tokens only, or JWT access tokens plus hashed refresh tokens. This spike recommends JWT access tokens plus hashed refresh tokens.
- Whether draft deletion means soft-delete forever or delayed purge. This spike recommends soft-delete first, with future retention/purge policy.
- Whether `transaction:write` should ever be grantable to shared users. The schema can represent it, but V1 should keep it disabled.
- Whether to denormalize row-state counters onto `ai_transaction_draft_batches`. This should wait for query-plan evidence.

## Local References

- Protocol spike: `docs/004-notes/ai-copilot-transaction-inbox/kzo-208-mcp-auth-deeplink-spike.md`
- Product scope: `docs/004-notes/ai-copilot-transaction-inbox/grill-wrap-up.md`
- Auth foundations: `db/migrations/030_kzo143_auth_foundations.sql`
- Sharing schema: `db/migrations/032_kzo146_sharing.sql`
- Notifications schema: `db/migrations/023_refresh_batches_notifications.sql`
- Shared DTOs: `libs/shared-types/src/index.ts`
- Persistence contracts: `apps/api/src/persistence/types.ts`
