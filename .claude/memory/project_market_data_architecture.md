---
name: Market Data Platform architecture
description: market_data schema boundary, FinMind (TW/US) + Yahoo Finance AU client+backfill, catalog interface, environment policy decisions
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

## Yahoo Finance AU integration (implemented in KZO-172)

- Provider: `apps/api/src/services/market-data/providers/yahooFinanceAu.ts` + `mockYahooFinanceAu.ts`
- SDK: `yahoo-finance2@^3.14.0` — use only the public API entry point (`import YahooFinance from "yahoo-finance2"`); deep imports (`esm/src/modules/*.js`) are blocked by `exports` field and must be replaced with inline minimal type interfaces + `as` casting.
- `normalizeSymbol(ticker)` → `${ticker}.AX` applied at every SDK call site (chart, quote, search); NOT applied to search query strings.
- Rate limiter: separate sliding-window bucket `marketDataSearchRateLimit.ts` (20 req/min per-IP, configurable via `MARKET_DATA_SEARCH_RATE_LIMIT_PER_MINUTE`); `registerMarketDataSearchEviction(app)` factory per `fastify-eviction-lifecycle-pattern.md`.
- Env vars: `YAHOO_AU_RATE_LIMIT_PER_MINUTE` (Yahoo SDK rate cap), `AU_PROVIDER_MOCK` (boolean), `MARKET_DATA_SEARCH_RATE_LIMIT_PER_MINUTE`.
- ToS constraint: startup `log.warn("yahoo_finance_tos_notice")` in registry; JSDoc framing on provider class. Yahoo Finance data is unofficial/ToS-constrained for commercial use.
- History start: `HISTORY_START_BY_MARKET["AU"] = "1988-01-28"` (spike-confirmed in KZO-171).
- Dual-registration: AU provider registered to BOTH `marketData.set("AU", ...)` AND `catalog.set("AU", ...)` in `registry.ts`.
- GET /market-data/search route: Zod query validation (`/^[A-Za-z0-9 .&'()-]+$/`), per-IP sliding-window 429, RateLimitedError → 503 + Retry-After, catch-all → 503 + X-Search-Degraded:true.
- AU classifier: `industryCategory === "ETF" → "ETF"` else `"STOCK"` — fires BEFORE TW substring path in `classifyInstrument.ts`. No BOND_ETF for AU v1.

## InstrumentCatalogProvider interface (KZO-172)

`types.ts` defines `InstrumentCatalogProvider` with two methods beyond the base `MarketDataProvider`:
- `fetchInstrumentMetadata(ticker: string): Promise<InstrumentMetadata | null>` — called during backfill metadata enrichment (warn-and-continue + mandatory RateLimitedError re-throw, per `typed-transient-error-catch-audit.md`).
- `searchInstruments(query: string): Promise<SearchResult[]>` — called from GET /market-data/search.

TW and US providers expose no-op stubs (return `null` / `[]`) — they do not implement catalog discovery.

`BackfillWorkerDeps` now includes `catalogRegistry: Map<MarketCode, InstrumentCatalogProvider>` alongside `providerRegistry`. As of KZO-189 it also includes `getEffectiveMetadataEnrichmentMode: () => Promise<"unconditional" | "conditional">` — a functor injected from `pgBoss.ts` that reads the DB override (falling back to `METADATA_ENRICHMENT_MODE` env var). Existing integration tests that construct `BackfillWorkerDeps` must include all three. Tests using `as never` / `as unknown as BackfillWorkerDeps` casts silently omit fields at compile time; see `.claude/rules/interface-caller-verification.md` §*Deps factory audit.

## Provider health layer (KZO-177)

Two new tables in `market_data` schema:
- `provider_health_log` — one row per (provider_id, outcome_date): `last_successful_run`, `last_failed_run`, `error_count_24h`, `error_count_7d`, `rate_limit_count_24h`
- `provider_error_log` — error detail rows (id, provider_id, occurred_at, error_class, error_message)

Key files:
- `apps/api/src/services/market-data/providerHealth.ts` — `computeStatus()`, `recordOutcome()`, `claimProviderDownNotificationSlot()` (CAS via conditional UPDATE WHERE)
- `apps/api/src/routes/adminRoutes.ts` — `GET /admin/providers` recomputes status at read time via `computeStatus()` + trading calendar
- `apps/web/components/admin/AdminProvidersClient.tsx` — dual-layout: table (≥lg) + card grid (<lg); distinct `-card-` testid prefix required per `.claude/rules/responsive-dual-layout-testid-prefixes.md`
- `apps/web/components/portfolio/HoldingsTable.tsx` — stale-data freshness badges (`current` / `stale_amber` / `stale_red`) sourced from `dashboardFreshness.ts`
- `apps/api/src/services/dashboardFreshness.ts` — `enrichHoldingsWithFreshness()` uses `getLatestBarDatesByTickerMarket` (composite `${ticker}:${marketCode}` keys via unnest Postgres query)

Recovery notification fires only when `newStatus === "healthy" && previous.status === "down"` (not `!== "down"` — that was a Codex P2 fix).

## Catalog upsert ON CONFLICT strategy

`upsertInstrumentCatalog` deliberately excludes operational columns from the ON CONFLICT SET clause:
- **NOT overwritten:** `bars_backfill_status`, `last_synced_at`, `verification_status`
- **Overwritten:** catalog metadata (`name`, `isin`, `sector_raw`, `industry_raw`, `listed_date`, `is_active`, etc.)

**Why:** Catalog sync is a metadata refresh. Overwriting backfill status would reset instruments mid-backfill, losing progress. QA test I2 covers `bars_backfill_status` preservation specifically. When modifying the catalog upsert SQL, verify operational columns are NOT in the SET clause.
