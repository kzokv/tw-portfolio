---
name: Market Data Platform architecture
description: market_data schema boundary, FinMind (TW/US) + Yahoo Finance AU bars/dividends/metadata/search + Twelve Data AU catalog (KZO-194), catalog interface, environment policy decisions
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
- Registry split (KZO-194): `marketData.set("AU", yahooAu)` (bars/dividends/metadata/search) AND `catalog.set("AU", twelveDataAuCatalog)` (catalog ingestion). `TwelveDataAuCatalogProvider` is constructed with `yahooFallback: yahooAu` and delegates `fetchInstrumentMetadata` and `searchInstruments` to it. Pre-194 the AU provider was registered to both surfaces; post-194 the catalog surface is owned by Twelve Data while Yahoo retains everything else.
- GET /market-data/search route: Zod query validation (`/^[A-Za-z0-9 .&'()-]+$/`), per-IP sliding-window 429, RateLimitedError → 503 + Retry-After, catch-all → 503 + X-Search-Degraded:true.
- AU classifier: `industryCategory === "ETF" → "ETF"` else `"STOCK"` — fires BEFORE TW substring path in `classifyInstrument.ts`. No BOND_ETF for AU v1.

## Twelve Data AU catalog provider (KZO-194)

- Provider: `apps/api/src/services/market-data/providers/twelveDataAu.ts` + `mockTwelveDataAu.ts`. Class `TwelveDataAuCatalogProvider implements InstrumentCatalogProvider`. `providerId = "twelve-data-au"`, `supportsMetadataEnrichment = true`.
- Composition shape (Option A): constructor takes `{ apiKey, baseUrl, rateLimiter, yahooFallback }`. `fetchInstrumentMetadata` and `searchInstruments` delegate to `yahooFallback` (the existing `YahooFinanceAuMarketDataProvider`). This preserves KZO-188's live autocomplete and per-ticker `quote()` enrichment, including LICs not present in TD's bulk endpoints (AFI, ARG, AUI, etc.).
- Endpoints: `/stocks?exchange=ASX` + `/etf?exchange=ASX` (Twelve Data Basic free tier). MIC defensive validation: every row asserted `mic_code === "XASX"`; mismatch on `/stocks` warns+skips, mismatch on `/etf` warns+skips. Warrant filter: `type === "Warrant"` dropped. Cross-endpoint dedup: `/etf` classification wins when ticker appears in both.
- Mapping: `ticker = symbol`, `name`, `typeRaw = "ASX"`, `industryCategory = "ETF"` for `/etf` rows, TD's `type` field passed through for `/stocks` rows. Net ~2,439 rows after filter+dedup.
- Yahoo provider neutralization: `YahooFinanceAuMarketDataProvider.fetchInstrumentCatalog()` now returns `[]` (interface compliance only). All other Yahoo methods unchanged. The `AU_RESERVED_INSTRUMENTS` constant is deleted; the 7-ticker reserved set is gone from production.
- Env: `TWELVE_DATA_API_KEY` (optional — absence routes to mock per FinMind precedent), `TWELVE_DATA_BASE_URL` (default `https://api.twelvedata.com`), `TWELVE_DATA_RATE_LIMIT_PER_MINUTE` (default 8, `RateLimiter(8, 60_000)`), `AU_CATALOG_PROVIDER_MOCK` (boolean, separate from `AU_PROVIDER_MOCK` which now scopes to AU bars only).
- Failure handling: `RateLimitedError` re-thrown for outer reschedule (per `typed-transient-error-catch-audit.md`); HTTP 4xx/5xx throw for pg-boss retry; idempotent upsert preserves yesterday's catalog on transient failure.
- Startup-tick (Critical Gap 2): `pgBoss.ts` enqueues a one-shot `boss.send(CATALOG_SYNC_QUEUE, {}, { singletonKey: CATALOG_SYNC_QUEUE })` immediately after `boss.schedule()`. Closes the post-deploy empty-catalog window without waiting for the next 17:30 UTC cron tick (load-bearing for Friday-evening deploys).
- Commercial-use: TD Basic ToS §2.3(l) prohibits commercial use; commercialization swaps to EODHD ($399/mo Internal-Use tier) per the KZO-171 spike. Yahoo retirement also deferred to that swap — TD's free tier doesn't cover bars/dividends/quotes.
- Deferred follow-ups: KZO-195 (delisting detection), KZO-196 (GICS/sector enrichment), KZO-197 (catalog-bootstrap orphan / provider-health "down" symptom).

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
