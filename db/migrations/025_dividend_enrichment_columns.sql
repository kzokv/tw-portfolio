-- Add enrichment columns to market_data.dividend_events for FinMind passthrough.
-- All nullable — existing rows unaffected.

ALTER TABLE market_data.dividend_events
  ADD COLUMN IF NOT EXISTS fiscal_year_period TEXT,
  ADD COLUMN IF NOT EXISTS announcement_date DATE,
  ADD COLUMN IF NOT EXISTS total_distribution_shares NUMERIC,
  ADD COLUMN IF NOT EXISTS raw_provider_data JSONB;
