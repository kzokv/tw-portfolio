-- KZO-132: Add refresh_batches (operational audit log for daily refresh fan-in)
-- and notifications (user-facing, extensible notification center).

BEGIN;

-- ── refresh_batches ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS refresh_batches (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id         TEXT REFERENCES users(id) ON DELETE SET NULL,
  jobs_total      INTEGER NOT NULL CHECK (jobs_total > 0),
  jobs_succeeded  INTEGER NOT NULL DEFAULT 0,
  jobs_failed     INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  ticker_results  JSONB NOT NULL DEFAULT '{}',
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_refresh_batches_created_at
  ON refresh_batches (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_refresh_batches_user_created
  ON refresh_batches (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_refresh_batches_active_status
  ON refresh_batches (status)
  WHERE status IN ('pending', 'running');

-- ── notifications ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  severity        TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'error')),
  source          TEXT NOT NULL,
  source_ref      TEXT,
  title           TEXT NOT NULL,
  body            TEXT,
  detail          JSONB,
  read_at         TIMESTAMPTZ,
  escalated_at    TIMESTAMPTZ,
  dismissed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unread dropdown: unread + not dismissed
CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON notifications (user_id, created_at DESC)
  WHERE read_at IS NULL AND dismissed_at IS NULL;

-- All notifications paginated (excludes dismissed)
CREATE INDEX IF NOT EXISTS idx_notifications_active
  ON notifications (user_id, created_at DESC)
  WHERE dismissed_at IS NULL;

-- Escalation candidates: unread, not escalated, warning/error only
CREATE INDEX IF NOT EXISTS idx_notifications_escalation
  ON notifications (user_id, created_at DESC)
  WHERE read_at IS NULL
    AND dismissed_at IS NULL
    AND escalated_at IS NULL
    AND severity IN ('warning', 'error');

-- Source-based lookup
CREATE INDEX IF NOT EXISTS idx_notifications_source
  ON notifications (source, created_at DESC);

COMMIT;
