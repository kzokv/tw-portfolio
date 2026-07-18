-- Posted transaction mutation batch limit for AI connector policy settings.
--
-- Rollback notes:
-- - Forward-only migration. Revert application behavior first.
-- - Existing deployments should keep the default limit of 50.

ALTER TABLE ai_connector_policy_settings
  ADD COLUMN IF NOT EXISTS posted_transaction_mutation_batch_limit INTEGER NOT NULL DEFAULT 50
    CHECK (posted_transaction_mutation_batch_limit > 0);

UPDATE ai_connector_policy_settings
SET posted_transaction_mutation_batch_limit = 50
WHERE posted_transaction_mutation_batch_limit IS NULL;
