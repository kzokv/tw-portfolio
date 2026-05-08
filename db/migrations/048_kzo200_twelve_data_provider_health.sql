-- KZO-200: seed `twelve-data-au` row in `provider_health_status`.
--
-- KZO-194 introduced `TwelveDataAuCatalogProvider` (free-tier `/stocks?exchange=ASX`
-- + `/etf?exchange=ASX`) as the AU catalog source — distinct from `yahoo-finance-au`,
-- which still owns AU bars/dividends/metadata. The original KZO-177 health-row seed
-- (migration 046) covered only the four providers known at that time. This migration
-- backfills the fifth.
--
-- The `ON CONFLICT DO NOTHING` clause keeps the migration idempotent — environments
-- where an admin manually inserted the row already are unaffected.

INSERT INTO market_data.provider_health_status (provider_id, status)
VALUES ('twelve-data-au', 'down')
ON CONFLICT (provider_id) DO NOTHING;
