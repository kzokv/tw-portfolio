-- Deleted draft lineage is owned by owner_user_id and mutation_run_id. Its
-- draft batch/row links must not block cascades when the portfolio owner is
-- hard-purged.

ALTER TABLE posted_transaction_mutation_deleted_draft_lineage
  DROP CONSTRAINT IF EXISTS posted_transaction_mutation_deleted_draft_lineage_batch_id_fkey;

ALTER TABLE posted_transaction_mutation_deleted_draft_lineage
  DROP CONSTRAINT IF EXISTS fk_ptm_lineage_batch;

ALTER TABLE posted_transaction_mutation_deleted_draft_lineage
  ADD CONSTRAINT fk_ptm_lineage_batch
  FOREIGN KEY (batch_id) REFERENCES ai_transaction_draft_batches(id) ON DELETE CASCADE;

ALTER TABLE posted_transaction_mutation_deleted_draft_lineage
  DROP CONSTRAINT IF EXISTS posted_transaction_mutation_deleted_draft_lineage_row_id_fkey;

ALTER TABLE posted_transaction_mutation_deleted_draft_lineage
  DROP CONSTRAINT IF EXISTS fk_ptm_lineage_row;

ALTER TABLE posted_transaction_mutation_deleted_draft_lineage
  ADD CONSTRAINT fk_ptm_lineage_row
  FOREIGN KEY (row_id) REFERENCES ai_transaction_draft_rows(id) ON DELETE CASCADE;
