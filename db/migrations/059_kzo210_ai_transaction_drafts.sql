-- KZO-210 / KZO-215 / KZO-216 — durable MCP/web transaction draft storage.
--
-- Rollback notes:
-- - Forward-only. Draft lifecycle is modeled with soft-delete state and an
--   append-only event stream, so application rollback should disable writers
--   and leave historical rows intact.

CREATE TABLE IF NOT EXISTS ai_transaction_draft_batches (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connector_connection_id TEXT REFERENCES ai_connector_connections(id) ON DELETE SET NULL,
  share_id TEXT REFERENCES portfolio_shares(id) ON DELETE SET NULL,
  source_channel TEXT NOT NULL CHECK (source_channel IN ('mcp', 'web')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'archived', 'deleted')),
  version INT NOT NULL DEFAULT 1 CHECK (version > 0),
  source_label TEXT,
  source_filename TEXT,
  note TEXT,
  provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
  row_count INT NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  unsupported_count INT NOT NULL DEFAULT 0 CHECK (unsupported_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ,
  archived_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  deleted_at TIMESTAMPTZ,
  deleted_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (id, owner_user_id),
  CHECK (source_label IS NULL OR char_length(source_label) <= 200),
  CHECK (source_filename IS NULL OR char_length(source_filename) <= 200),
  CHECK (note IS NULL OR char_length(note) <= 1000)
);

CREATE INDEX IF NOT EXISTS idx_ai_transaction_draft_batches_owner_status_updated
  ON ai_transaction_draft_batches (owner_user_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_transaction_draft_batches_created_by_updated
  ON ai_transaction_draft_batches (created_by_user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_transaction_draft_batches_connection_created
  ON ai_transaction_draft_batches (connector_connection_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_transaction_draft_batches_share_created
  ON ai_transaction_draft_batches (share_id, created_at DESC)
  WHERE share_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS ai_transaction_draft_rows (
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (batch_id, owner_user_id) REFERENCES ai_transaction_draft_batches(id, owner_user_id) ON DELETE CASCADE,
  UNIQUE (batch_id, row_number),
  CHECK (source_snippet IS NULL OR char_length(source_snippet) <= 500),
  CHECK (note IS NULL OR char_length(note) <= 1000)
);

CREATE INDEX IF NOT EXISTS idx_ai_transaction_draft_rows_batch_state_row
  ON ai_transaction_draft_rows (batch_id, state, row_number);

CREATE INDEX IF NOT EXISTS idx_ai_transaction_draft_rows_batch_updated
  ON ai_transaction_draft_rows (batch_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_transaction_draft_rows_confirmed_trade
  ON ai_transaction_draft_rows (confirmed_trade_event_id)
  WHERE confirmed_trade_event_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS ai_transaction_draft_unsupported_items (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES ai_transaction_draft_batches(id) ON DELETE CASCADE,
  row_number INT,
  category TEXT NOT NULL,
  reason TEXT NOT NULL,
  source_snippet TEXT,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (source_snippet IS NULL OR char_length(source_snippet) <= 500)
);

CREATE INDEX IF NOT EXISTS idx_ai_transaction_draft_unsupported_items_batch_row
  ON ai_transaction_draft_unsupported_items (batch_id, row_number NULLS LAST);

CREATE TABLE IF NOT EXISTS ai_transaction_draft_events (
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_transaction_draft_events_batch_created
  ON ai_transaction_draft_events (batch_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_ai_transaction_draft_events_owner_created
  ON ai_transaction_draft_events (owner_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_transaction_draft_events_actor_created
  ON ai_transaction_draft_events (actor_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_transaction_draft_events_connection_created
  ON ai_transaction_draft_events (connector_connection_id, created_at DESC);
