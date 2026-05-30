-- KZO-196 — AU sector / GICS enrichment.
--
-- Adds `gics_industry_group` to `market_data.instruments` so the ASX GICS
-- catalog provider (`asx-gics-csv`) can enrich AU rows with their official
-- S&P/MSCI industry-group label. The column is nullable, has no CHECK
-- constraint, and is written enrichment-only — `INSERT`s never touch it
-- (only the GICS sync worker `UPDATE`s by ticker).
--
-- A second statement adds a partial covering index for the AU sector-filter
-- query path (`SELECT … WHERE market_code = 'AU' AND gics_industry_group = …`)
-- in `InstrumentCatalogSheet`.
--
-- The third statement nulls out `industry_category_raw` for AU rows. KZO-194
-- repurposed that column to carry the Twelve Data classifier `type`
-- (`Common Stock`, `REIT`, `ETF`, etc.) for ETF / classifier purposes; that
-- value is now redundant with `instrument_type`. The GICS feed populates the
-- new `gics_industry_group` column instead. KZO-196 also patches
-- `TwelveDataAuCatalogProvider.fetchInstrumentCatalog` to stop re-stamping
-- `industry_category_raw` so this cleanup is durable.
--
-- Per `.claude/rules/migration-strategy.md`: NEW migration file (050) — does
-- not edit any prior migrations. No CHECK constraints (matches the
-- `type_raw` precedent — UI bucketizes unknown values to "Other").
-- Per `.claude/rules/integration-test-persistence-direct.md`: schema-qualified
-- table name (`market_data.instruments`) used everywhere.

ALTER TABLE market_data.instruments
  ADD COLUMN IF NOT EXISTS gics_industry_group TEXT NULL;

COMMENT ON COLUMN market_data.instruments.gics_industry_group IS
  'KZO-196 — GICS industry-group label sourced from ASX ASXListedCompanies.csv. NULL on rows the ASX GICS sync has not yet touched. Enrichment-only: writes happen via the asx-gics-sync pg-boss worker; INSERTs never set this field. The column is nullable on TW/US rows by design — those markets do not run the AU GICS feed.';

CREATE INDEX IF NOT EXISTS idx_instruments_gics_industry_group
  ON market_data.instruments (market_code, gics_industry_group)
  WHERE gics_industry_group IS NOT NULL;

-- One-shot AU cleanup: KZO-194 stamped `industry_category_raw` with the
-- Twelve Data classifier `type` (e.g. `Common Stock`, `ETF`). With KZO-196
-- the field is unused for AU; null it out so admin queries / DTOs don't
-- surface a stale classifier label. The GICS sync worker populates
-- `gics_industry_group` on subsequent runs.
UPDATE market_data.instruments
   SET industry_category_raw = NULL,
       updated_at = CURRENT_TIMESTAMP
 WHERE market_code = 'AU'
   AND industry_category_raw IS NOT NULL;

-- KZO-196 — `app_config` Tier A column for the AU GICS sync cron schedule
-- override. Default cron is `'0 2 * * 0'` (Sundays 02:00 UTC). NULL means
-- "fall back to `Env.ASX_GICS_REFRESH_CRON`". Restart-required to take
-- effect (the cron is consulted by `pg_boss.schedule(...)` at boot, not
-- per-tick). Plain TEXT — no CHECK constraint; the env-schema regex is
-- the single validator.
ALTER TABLE public.app_config
  ADD COLUMN IF NOT EXISTS asx_gics_refresh_cron TEXT NULL;

COMMENT ON COLUMN public.app_config.asx_gics_refresh_cron IS
  'KZO-196 — cron schedule override for the AU GICS sync worker. NULL = use Env.ASX_GICS_REFRESH_CRON (default Sundays 02:00 UTC). Restart-required: the cron is consulted at app boot during pg-boss queue registration, not per-tick.';

-- KZO-196 — seed the `asx-gics-csv` row in `provider_health_status` so the
-- admin /providers page renders the row and the run-now button is reachable
-- from the first deploy. Idempotent — environments where the row already
-- exists are unaffected.
INSERT INTO market_data.provider_health_status (provider_id, status)
VALUES ('asx-gics-csv', 'down')
ON CONFLICT (provider_id) DO NOTHING;
