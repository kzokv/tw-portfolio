-- Preserve owner-owned mutation history when a delegated actor is hard-purged.
-- Actor/deleter identities are optional historical attribution; ownership is
-- represented separately by owner_user_id and continues to cascade on purge.

ALTER TABLE posted_transaction_mutation_previews
  ALTER COLUMN actor_user_id DROP NOT NULL;

ALTER TABLE posted_transaction_mutation_previews
  DROP CONSTRAINT IF EXISTS posted_transaction_mutation_previews_actor_user_id_fkey;

ALTER TABLE posted_transaction_mutation_previews
  DROP CONSTRAINT IF EXISTS fk_ptm_previews_actor;

ALTER TABLE posted_transaction_mutation_previews
  ADD CONSTRAINT fk_ptm_previews_actor
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE posted_transaction_mutation_runs
  ALTER COLUMN actor_user_id DROP NOT NULL;

ALTER TABLE posted_transaction_mutation_runs
  DROP CONSTRAINT IF EXISTS posted_transaction_mutation_runs_actor_user_id_fkey;

ALTER TABLE posted_transaction_mutation_runs
  DROP CONSTRAINT IF EXISTS fk_ptm_runs_actor;

ALTER TABLE posted_transaction_mutation_runs
  ADD CONSTRAINT fk_ptm_runs_actor
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE posted_transaction_mutation_deleted_draft_lineage
  ALTER COLUMN deleted_by_user_id DROP NOT NULL;

ALTER TABLE posted_transaction_mutation_deleted_draft_lineage
  DROP CONSTRAINT IF EXISTS posted_transaction_mutation_deleted_draft_lineage_deleted_by_user_id_fkey;

-- PostgreSQL truncates the generated migration-106 constraint name to 63 bytes.
ALTER TABLE posted_transaction_mutation_deleted_draft_lineage
  DROP CONSTRAINT IF EXISTS posted_transaction_mutation_deleted_dra_deleted_by_user_id_fkey;

ALTER TABLE posted_transaction_mutation_deleted_draft_lineage
  DROP CONSTRAINT IF EXISTS fk_ptm_lineage_deleted_by;

ALTER TABLE posted_transaction_mutation_deleted_draft_lineage
  ADD CONSTRAINT fk_ptm_lineage_deleted_by
  FOREIGN KEY (deleted_by_user_id) REFERENCES users(id) ON DELETE SET NULL;
