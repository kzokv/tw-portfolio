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
