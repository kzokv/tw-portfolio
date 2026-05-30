---
slug: kzo-194
source: scope-grill
created: 2026-05-07
tickets: [KZO-194]
required_reading: []
superseded_by: null
---

# Todo: KZO-194 — AU full catalog ingestion via Twelve Data

> **For agents starting a fresh session:** read this file and the parent ticket KZO-194 before starting implementation. The scope-grill session resolved 7 architectural decisions and 2 critical gaps; the bullets below are the lock.

## Summary of locked decisions

Replace the hardcoded 7-ticker `AU_RESERVED_INSTRUMENTS` set with a real ASX-wide catalog sourced from Twelve Data's free `/stocks?exchange=ASX` + `/etf?exchange=ASX` endpoints. Yahoo provider stays for bars/dividends/metadata/search. New `TwelveDataAuCatalogProvider` class owns the catalog surface; injects Yahoo for `fetchInstrumentMetadata` + `searchInstruments` delegation. Net catalog ingest: ~2,439 instruments (warrants filtered).

## Implementation Steps

### Backend — provider class

- [x] Create `apps/api/src/services/market-data/providers/twelveDataAu.ts` exporting `TwelveDataAuCatalogProvider` class.
- [x] Constructor signature: `({ apiKey, baseUrl, rateLimiter, yahooFallback }: { apiKey: string; baseUrl: string; rateLimiter: RateLimiter; yahooFallback: InstrumentCatalogProvider })`.
- [x] Implement `providerId = "twelve-data-au"` (readonly, matches established convention).
- [x] Implement `supportsMetadataEnrichment = true` (delegate path returns real metadata via Yahoo).
- [x] Implement `reserveCapacity(n)` reading from the rate limiter (mirror Yahoo AU's pattern).
- [x] Implement `fetchInstrumentCatalog()`:
  - Call `/stocks?exchange=ASX` and `/etf?exchange=ASX` sequentially (each consumes one rate-limit slot).
  - Defensive validation: assert each row has `mic_code === "XASX"`; throw on mismatch with detailed error.
  - Filter out `type === "Warrant"` from `/stocks` response.
  - Stamp `industryCategory = "ETF"` for `/etf` rows; pass through TD's `type` field verbatim for `/stocks` rows.
  - Cross-endpoint dedup: if a ticker appears in both, prefer `/etf` (drop the `/stocks` row).
  - Map to `RawInstrumentInfo`: `{ ticker: symbol, name, typeRaw: "ASX", industryCategory, date: today.toISOString().slice(0,10) }`.
- [x] Implement `fetchDelistingHistory()` returning `[]`.
- [x] Implement `fetchInstrumentMetadata(ticker)` delegating to `yahooFallback.fetchInstrumentMetadata(ticker)`.
- [x] Implement `searchInstruments(query)` delegating to `yahooFallback.searchInstruments(query)`.
- [x] Add `MockTwelveDataAuCatalogProvider` in `apps/api/src/services/market-data/providers/mockTwelveDataAu.ts` — constructor takes `MockYahooFinanceAuMarketDataProvider` for delegation symmetry. Fixture covers Common Stock, ETF, REIT, Preferred Stock, Depositary Receipt, and one Warrant entry (asserting filter). _(Fixture: RIO/STW/SCG/NABPF/RYDAF/RIOWAR; STW is /etf-origin → ETF.)_
- [x] Re-export both from `apps/api/src/services/market-data/providers/index.ts` (also exports `MOCK_TD_AU_CATALOG_TICKERS` for test assertions).

### Backend — Yahoo provider neutralization

- [x] Delete `AU_RESERVED_INSTRUMENTS` constant from `apps/api/src/services/market-data/providers/yahooFinanceAu.ts`. _(Const removed; only JSDoc reference at line 220 remains as historical context.)_
- [x] Change `YahooFinanceAuMarketDataProvider.fetchInstrumentCatalog()` to return `[]` (keep method for interface compliance).
- [x] Leave `fetchBars`, `fetchDividends`, `fetchInstrumentMetadata`, `searchInstruments`, `fetchDelistingHistory` unchanged. _(Diff stat confirms: only catalog method + JSDoc touched; bars/dividends/metadata/search code untouched.)_
- [x] Update the JSDoc on `fetchInstrumentCatalog` noting catalog now sourced from `TwelveDataAuCatalogProvider` (KZO-194).
- [x] _(Bonus: `MockYahooFinanceAuMarketDataProvider.fetchInstrumentCatalog()` also neutralized to `[]`; previously copied `AU_RESERVED_INSTRUMENTS`.)_

### Backend — registry wiring

- [x] Update `buildMarketDataRegistry` in `apps/api/src/services/market-data/registry.ts`:
  - [x] Construct `yahooAuProvider` as today (it stays as `marketData["AU"]`).
  - [x] Construct `twelveDataAuRateLimiter = new RateLimiter(env.TWELVE_DATA_RATE_LIMIT_PER_MINUTE, 60_000)`.
  - [x] Construct `twelveDataAuCatalog = env.AU_CATALOG_PROVIDER_MOCK || !env.TWELVE_DATA_API_KEY ? new MockTwelveDataAuCatalogProvider({ yahooFallback: yahooAuProvider }) : new TwelveDataAuCatalogProvider({ ... })`. _(Mock-branch widened to also fall back when API key is absent — FinMind precedent. Architectural deviation accepted post-CR.)_
  - [x] `marketData.set("AU", yahooAuProvider)` (unchanged).
  - [x] `catalog.set("AU", twelveDataAuCatalog)` (replaces previous `catalog.set("AU", auProvider)`).

### Backend — env schema

- [x] Update `libs/config/src/env-schema.ts`:
  - [x] Add `TWELVE_DATA_API_KEY: z.string().optional()`.
  - [x] Add `TWELVE_DATA_BASE_URL: z.string().url().default("https://api.twelvedata.com")`.
  - [x] Add `TWELVE_DATA_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(8)`.
  - [x] Add `AU_CATALOG_PROVIDER_MOCK: z.coerce.boolean().default(false)`.
- [x] Rebuild `@tw-portfolio/config` package. _(Implicit via typecheck pass.)_
- [x] Document `TWELVE_DATA_API_KEY` in `.env.example` (4 vars added at lines 101-110).
- [ ] Verify dev/staging/prod secrets pipeline picks up the new key (mirror `FINMIND_API_TOKEN` flow). _(Post-merge operator task — out of team scope.)_

### Backend — startup-tick (Critical Gap 2)

- [x] In `apps/api/src/plugins/pgBoss.ts`, append after `boss.schedule(CATALOG_SYNC_QUEUE, CATALOG_SYNC_CRON, {})`:
  ```ts
  await boss.send(CATALOG_SYNC_QUEUE, {}, { singletonKey: CATALOG_SYNC_QUEUE });
  ```
  _(Confirmed at `pgBoss.ts:111`.)_
- [x] Inline comment referencing KZO-194 + the post-deploy empty-catalog rationale so future readers understand the load-bearing line. _(Lines 104-110 explain the 72h Fri→Mon cron-gap rationale.)_

### Tests — implementer-coupled

- [x] Update `apps/api/test/integration/auStockBackfill.integration.test.ts` case 6 — replace 7-row reserved-set assertion with assertion against the new mock fixture row count. _(Case 6 now uses `MockTwelveDataAuCatalogProvider` + `MOCK_TD_AU_CATALOG_TICKERS`; STW asserted as ETF; rest STOCK.)_
- [x] Run `grep -rln "AU_RESERVED_INSTRUMENTS" apps/api apps/web libs` and update every reference. _(Only JSDoc historical references remain in src/test files; runtime references all removed. dist/* artifacts will regenerate.)_
- [x] Run `grep -rln "vi\\.mock.*yahooFinanceAu" apps/api/test` — for each match, audit whether the new export `TwelveDataAuCatalogProvider` mock factory needs to be added. _(Audit reported clean by Implementer in Phase 1.)_
- [x] Update any test that builds `MarketDataRegistry` inline so the registry construction includes the new catalog provider. _(`apps/api/test/unit/registry.test.ts` updated; `app-config.integration.test.ts` updated for instrument-count check.)_
- [x] Verify `npm run typecheck` passes across all tsconfigs (api, api-test, web). _(6 tsconfigs green per Implementer Phase 1 report.)_

### Tests — QA-owned new

- [x] Unit tests for `TwelveDataAuCatalogProvider` (`apps/api/test/unit/twelveDataAuProvider.test.ts`, 23 tests):
  - [x] Parse `/stocks` response → expected RawInstrumentInfo shape.
  - [x] Parse `/etf` response → expected shape with `industryCategory = "ETF"`.
  - [x] Merge + cross-endpoint dedup (ticker in both endpoints → /etf classification wins).
  - [x] Warrant filter (Warrant entries dropped from output).
  - [x] MIC validation (CXA-listed cross-listing in response → throw).
  - [x] `fetchInstrumentMetadata` delegates to Yahoo (verify call passes through).
  - [x] `searchInstruments` delegates to Yahoo.
  - [x] `RateLimitedError` propagation when limiter exhausted.
- [x] Integration test for catalog-sync round-trip via `MockTwelveDataAuCatalogProvider` (`apps/api/test/integration/auCatalogSyncTwelveData.integration.test.ts`, 9 tests, Postgres-gated):
  - [x] `runCatalogSync({ marketCode: "AU", catalogProvider: mockTd, persistence })` → assert `instruments` rows match fixture.
  - [x] Verify `instrument_type` classification: Common Stock → STOCK, ETF → ETF, REIT → STOCK, Preferred Stock → STOCK, Depositary Receipt → STOCK.
  - [x] Verify `market_code = "AU"` on every inserted row.
  - [x] Postgres-only (`describePostgres`) per `test-placement-persistence-backend.md`.
- [x] Integration test for `fetchInstrumentMetadata` delegation (`apps/api/test/integration/auLicMetadataDelegation.integration.test.ts`, 5 tests, Postgres-gated):
  - [x] Add a transaction for an LIC ticker NOT in the TD bulk catalog (e.g., AFI).
  - [x] Verify the row materializes in `instruments` with `name` populated by Yahoo's `quote()`.
- [x] HTTP test for the catalog-browser route (`apps/api/test/http/specs/au-catalog-browser-aaa.http.spec.ts`, 4 tests):
  - [x] Assert response shape and that AU returns ≥100 rows. _(Test seeds via mock then asserts.)_
- [x] AAA E2E test (`apps/web/tests/e2e/specs/au-catalog-browser-aaa.spec.ts`, 3 tests):
  - [x] Settings → Tickers → Browse Full Catalog → AU shows ≥100 rows.
  - [x] Ticker hygiene: per `e2e-shared-memory-bars-ticker-hygiene.md`, the test must use a non-reserved AU ticker for any specific assertion. _(Mock fixture uses RIO/STW/SCG/NABPF/RYDAF — no overlap with reserved 7.)_

### Docs — Wave 2

_(Wave 2 has not yet fired. Spawned after Phase 5 confirmation gate exits CLEAN.)_

- [ ] Transition note at `docs/004-notes/kzo-194/transition-{YYYYMMDDHHmm}-twelve-data-catalog.md` per `doc-management.md`. Cover:
  - Yahoo → TD catalog split rationale + the architectural shape (Option A composition).
  - LIC/CEF coverage gap; mitigation via Yahoo `searchInstruments` delegation.
  - Type filter (warrants only).
  - Deferred items with their follow-up ticket IDs (KZO-195/196/197).
  - Truth table mapping TD types → `instrument_type` classification.
  - Process notes section per `.claude/memory/project_team_doc_patterns.md` (Phase 3 timing-tangle, iter-2 amendment, validator-activation handling).
- [ ] Update `.claude/rules/e2e-shared-memory-bars-ticker-hygiene.md` AU section: BHP/CSL/VAS/WBC/AFI/GMG/IMD reservation purpose changes (test-fixture-only; no longer auto-seeded via `AU_RESERVED_INSTRUMENTS`).
- [ ] Update or supersede any reference in `docs/001-architecture/**` that mentions the 7-row reserved set.
- [ ] PR description draft at `.worklog/team/pr-description-draft.md` with required sections per `git-pr-flow.md` and `pr-bound-docs-review-compliance.md`:
  - `## Problem` (catalog gap, motivation)
  - `## Solution` (TD provider + Yahoo split, startup-tick)
  - `## Testing` (with `Evidence:` block — exact suite-by-suite results)
  - `## Risk/Rollback` (idempotent upsert, follow-ups, monetization deferral)
  - Link to KZO-195/196/197 follow-ups.
- [ ] _(Auto-memory pre-shutdown task: refresh `.claude/memory/project_market_data_architecture.md` AU section — current text says "Dual-registration: AU provider registered to BOTH `marketData.set('AU', ...)` AND `catalog.set('AU', ...)`" which becomes inaccurate post-194.)_

### Pre-PR validation

_(Phase 5 iter-3 confirmation gate pending. Iter-1 hit 5 carried-over failures; iter-2 amendment landed at 09:47 + 10:04. Iter-3 [GO] from Architect to Validator outstanding at last sync.)_

- [ ] Run `npx eslint . --max-warnings=0 && npm run typecheck && npm run test:all:full` per `.claude/rules/full-test-suite.md`. All 8 suites must be green. _(Iter 2 partial: 6/8 suites green; 2 carried-over were ESLint AAA + bulk-seed chip-filter — both addressed in Phase 4 amendment by Tasks #8 and #9.)_
- [ ] Verify catalog row count in dev DB after running `runCatalogSync` end-to-end (rough sanity check ~2,400 AU rows). _(Requires real Twelve Data API key against dev environment — operator task post-merge.)_
- [ ] Verify `provider_health_status` for `twelve-data-au` stamps `last_successful_run` after successful sync (auto-wired via existing KZO-177 framework). _(Operator verification post-merge; KZO-194 Phase 1 confirmed wiring is transparent.)_
- [ ] Visual smoke: Settings → Tickers → Browse Full Catalog AU shows the expanded universe in a real browser. Per `validator-process-hygiene.md`, use the running E2E webServer rather than spawning `npm run dev`. _(Validator's Phase 5 iter-3 visual verification step.)_

## Open Items

None — all critical gaps resolved during scope-grill. Three deferred items have follow-up tickets (KZO-195/196/197).

## References

- Locked scope: this file
- Linear tickets: KZO-194 (this), KZO-195 (delisting follow-up), KZO-196 (GICS follow-up), KZO-197 (bootstrap orphan follow-up)
- Source verification (2026-05-07):
  - Twelve Data `/stocks?exchange=ASX` — 2,013 rows, 5 type buckets
  - Twelve Data `/etf?exchange=ASX` — 449 rows, includes VAS
  - Free-tier coverage matrix verified: catalog endpoints free; bars/dividends/quotes paywalled (Pro tier $229/mo)
- Architectural decisions:
  - Option A composition (new TD class + Yahoo delegation) over Option B (split interfaces) or Option C (no-op metadata/search)
  - Accept LIC gap (drop AU_RESERVED_INSTRUMENTS, no curated seed list)
  - Filter Warrants only at ingestion
  - Defer delisting detection, GICS enrichment, bootstrap orphan to follow-ups
  - No schema delta in this ticket
  - Yahoo retirement deferred to commercialization (EODHD swap)
