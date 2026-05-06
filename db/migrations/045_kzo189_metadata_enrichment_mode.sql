-- KZO-189: app_config.metadata_enrichment_mode column
--
-- Hybrid env-var + DB-override config for the AU metadata enrichment gate
-- (mirrors the repair_cooldown_minutes precedent in migration 029).
-- NULL means "fall back to Env.METADATA_ENRICHMENT_MODE"; the CHECK constraint
-- restricts the allowed string values to the same enum used at the worker entry.

ALTER TABLE public.app_config
  ADD COLUMN IF NOT EXISTS metadata_enrichment_mode TEXT NULL;

ALTER TABLE public.app_config
  DROP CONSTRAINT IF EXISTS chk_metadata_enrichment_mode;

ALTER TABLE public.app_config
  ADD CONSTRAINT chk_metadata_enrichment_mode
  CHECK (metadata_enrichment_mode IS NULL OR metadata_enrichment_mode IN ('unconditional', 'conditional'));
