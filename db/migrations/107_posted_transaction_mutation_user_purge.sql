ALTER TABLE posted_transaction_mutation_runs
  DROP CONSTRAINT IF EXISTS posted_transaction_mutation_runs_preview_id_fkey;

ALTER TABLE posted_transaction_mutation_runs
  DROP CONSTRAINT IF EXISTS fk_ptm_runs_preview;

ALTER TABLE posted_transaction_mutation_runs
  ADD CONSTRAINT fk_ptm_runs_preview
  FOREIGN KEY (preview_id) REFERENCES posted_transaction_mutation_previews(id) ON DELETE CASCADE;

ALTER TABLE posted_transaction_mutation_previews
  DROP CONSTRAINT IF EXISTS posted_transaction_mutation_previews_actor_user_id_fkey;

ALTER TABLE posted_transaction_mutation_previews
  DROP CONSTRAINT IF EXISTS fk_ptm_previews_actor;

ALTER TABLE posted_transaction_mutation_previews
  ADD CONSTRAINT fk_ptm_previews_actor
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE posted_transaction_mutation_runs
  DROP CONSTRAINT IF EXISTS posted_transaction_mutation_runs_actor_user_id_fkey;

ALTER TABLE posted_transaction_mutation_runs
  DROP CONSTRAINT IF EXISTS fk_ptm_runs_actor;

ALTER TABLE posted_transaction_mutation_runs
  ADD CONSTRAINT fk_ptm_runs_actor
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE posted_transaction_mutation_deleted_draft_lineage
  DROP CONSTRAINT IF EXISTS posted_transaction_mutation_deleted_draft_lineage_deleted_by_user_id_fkey;

ALTER TABLE posted_transaction_mutation_deleted_draft_lineage
  DROP CONSTRAINT IF EXISTS fk_ptm_lineage_deleted_by;

ALTER TABLE posted_transaction_mutation_deleted_draft_lineage
  ADD CONSTRAINT fk_ptm_lineage_deleted_by
  FOREIGN KEY (deleted_by_user_id) REFERENCES users(id) ON DELETE CASCADE;
