---
name: Market Data Platform architecture
description: market_data schema boundary, FinMind client+backfill implemented, environment policy decisions
type: project
---

## Schema boundary

Same Postgres instance, dedicated `market_data` schema alongside `public` (ledger). Cross-schema joins supported for valuation queries.

**Why:** Phase 1 volume is small (~1,000 symbols, daily EOD bars). Separate microservice rejected — zero benefit at current scale.

**How to apply:** Ingestion code lives at `apps/api/src/services/market-data/`. Market data tables (`instruments`, `daily_bars`, `dividend_events`) are write-owned by `market_data` schema. Ledger tables remain in `public`.

## FinMind integration (implemented in KZO-126)

- Client: `apps/api/src/services/market-data/finmindClient.ts` (real HTTP) + `finmindClient.mock.ts`
- Datasets: `TaiwanStockPrice` (daily bars), `TaiwanStockDividend` (dividends)
- Rate limiter: in-memory sliding window, 600 req/hr (`rateLimiter.ts`)
- Backfill worker: pg-boss queue, 3 retries, exponential backoff (`backfillWorker.ts`)
- Plugin: `apps/api/src/plugins/pgBoss.ts` — lifecycle managed, skipped in memory mode
- Env var: `FINMIND_API_TOKEN` (optional — mock used if missing)

## Environment policy (ADR 2026-03-25)

| Env | Postgres | Market data source | Calls FinMind? |
|---|---|---|---|
| Production | `twp-prod-postgres` on QNAP | Daily ingest job | Yes — sole writer |
| Dev | `twp-dev-postgres` on QNAP | Auto-restore from prod dump | No |
| Local | `twp-local-postgres` on Lume VM | Manual scp restore | No |

Locked ADR: `docs/004-notes/005-market-data/adr-202603251800-historical-data-store-topology.md`

## FinMind catalog endpoints (KZO-83)

`fetchCatalogDataset()` vs `fetchDataset()` — catalog endpoints take **no** `data_id` or `start_date` params:

- `fetchDataset(dataset, ticker, startDate)` — per-ticker historical data (e.g. `TaiwanStockPrice`, `TaiwanStockDividend`)
- `fetchCatalogDataset(dataset)` — catalog-wide, returns ALL rows with no per-ticker filter (e.g. `TaiwanStockInfo`, `TaiwanStockDelisting`)

Reusing `fetchDataset` with empty params would include `data_id=` in the URL, which may cause unexpected API behavior. When adding new FinMind dataset integrations, check if the endpoint is per-ticker or catalog-wide.

## Catalog upsert ON CONFLICT strategy

`upsertInstrumentCatalog` deliberately excludes operational columns from the ON CONFLICT SET clause:
- **NOT overwritten:** `bars_backfill_status`, `last_synced_at`, `verification_status`
- **Overwritten:** catalog metadata (`name`, `isin`, `sector_raw`, `industry_raw`, `listed_date`, `is_active`, etc.)

**Why:** Catalog sync is a metadata refresh. Overwriting backfill status would reset instruments mid-backfill, losing progress. QA test I2 covers `bars_backfill_status` preservation specifically. When modifying the catalog upsert SQL, verify operational columns are NOT in the SET clause.
