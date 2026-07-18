-- Preserve owner-owned AI draft batches when a delegated creator is purged.
-- The owner_user_id remains authoritative ownership; creator identity is
-- historical attribution and may be anonymized.

ALTER TABLE ai_transaction_draft_batches
  ALTER COLUMN created_by_user_id DROP NOT NULL;

ALTER TABLE ai_transaction_draft_batches
  DROP CONSTRAINT IF EXISTS ai_transaction_draft_batches_created_by_user_id_fkey;

ALTER TABLE ai_transaction_draft_batches
  DROP CONSTRAINT IF EXISTS fk_ai_draft_batches_created_by;

ALTER TABLE ai_transaction_draft_batches
  ADD CONSTRAINT fk_ai_draft_batches_created_by
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL;
