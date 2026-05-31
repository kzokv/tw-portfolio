---
slug: kzo-170
source: scope-grill
created: 2026-05-02
tickets: [KZO-170]
required_reading:
  - docs/004-notes/kzo-163/scope-todo-202604251830-provider-registry.md
  - docs/004-notes/kzo-164/scope-todo-202604261830-frankfurter-fx.md
  - docs/004-notes/kzo-169/scope-todo-202604300100-market-code-selector.md
  - .claude/rules/typed-transient-error-catch-audit.md
  - .claude/rules/replay-position-history-invariants.md
  - .claude/rules/migration-strategy.md
  - .claude/rules/integration-test-persistence-direct.md
  - .claude/rules/e2e-shared-memory-bars-ticker-hygiene.md
  - .claude/rules/process-refactor-rename-verification.md
  - .claude/rules/code-review-before-pr.md
superseded_by: null
---

# Todo: KZO-170 — US Market: FinMind USStock plugin + ingestion

> **For agents starting a fresh session:** read this file, the Linear ticket KZO-170 description (with the `## Locked Scope` section appended via this session), and all files in `required_reading` above. Sibling follow-ups: **KZO-186 (stock splits ingestion + replay invariant 6, deferred)** and **KZO-187 (US dividend ingestion via alternate provider — created 2026-05-02 via Phase-1 G-NC-1 escalation, see § "Phase-1 G-NC-1 resolution" below)**.

## Background

KZO-163 (provider registry) and KZO-164 (Frankfurter FX) shipped the foundation. KZO-169 shipped the schema + UI for `(ticker, market_code)` everywhere. KZO-185 shipped strict ZodError validation on the backfill worker, eliminating the back-compat fallback. **KZO-170 plugs the US provider into the slot that's already wired, with one critical correctness fix on the way through (`cash_dividend_currency` hardcoded `'TWD'` in `upsertDividendEvents`).**

The scope-grill on 2026-05-02 chose:
- **Full US catalog sync** (Q5 = A): parity with the TW path; `MarketDataRegistry.catalog.set("US", ...)` populates the autocomplete via the daily cron.
- **Single PR, Tier 2 (Squad)** (Q15 = A): mirror of KZO-163/164/169 cadence.
- **Splits out of scope** (Q3): KZO-186 carries the splits ticket including the AAPL 2020-08-31 4-for-1 reference case.
- **No `exchange_subcode` column** (Q4): downstream consumers (KZO-175, KZO-177) carve it later.

## Decisions (locked via scope-grill 2026-05-02)

- **D1.** Fix `cash_dividend_currency` derivation in `upsertDividendEvents()` (`apps/api/src/services/market-data/upserts.ts:139`). Replace `array_fill('TWD'::text, ARRAY[$9::int])` with a per-row `currencies = events.map((ev) => currencyFor(ev.marketCode))` array. **Critical bug today**: every dividend row stamps `'TWD'` regardless of market; would silently break US dividend ingestion + market guard at `dividends.ts:184`.
- **D1b.** Fix companion TWD hardcode at `apps/api/src/services/dividends.ts:593` (auto-fill DIVIDEND_INCOME source line). Derive `currencyCode` from `dividendEvent.cashDividendCurrency` instead of hardcoded `"TWD"`.
- **D2.** Delete `apps/api/src/services/market-data/marketResolution.ts` and the `resolveMarketCode()` stub. `/market-data/price` route gains a required `marketCode` query param of `marketCodeSchema = z.enum(["TW","US","AU"])`. `apps/web/features/portfolio/services/portfolioService.ts:103-113` and `apps/web/features/portfolio/hooks/useTransactionSubmission.ts:97` pass the form's chip-selector `marketCode`. Delete `apps/api/test/unit/marketResolution.test.ts`. Update stale JSDoc references in `pgBoss.ts:42-44`, `postgres.ts:6141`, `backfill-handler-branching.test.ts:18,74`.
- **D3.** Splits **out of scope**. Created **KZO-186** as the splits follow-up. Transition note documents the limitation with AAPL 2020-08-31 4-for-1 worked example.
- **D4.** No `exchange_subcode` column. `industry_category_raw` carries any FinMind exchange string verbatim (no schema change). First downstream consumer adds the structured column.
- **D5.** ~~Full US catalog sync — parity with TW path.~~ **REVISED 2026-05-02 (Phase-1 G-NC-1 resolution, Option C):** Partial US catalog sync. `FinMindUsStockMarketDataProvider` implements `MarketDataProvider.fetchBars` from `USStockPrice` (using `Close`, not `Adj_Close`, for column-semantic parity with TW) and `MarketDataProvider.fetchDividends() => []` (FinMind has no `USStockDividend` dataset — verified 2026-05-02 via curl, returns 422). `InstrumentCatalogProvider.fetchInstrumentCatalog` from `USStockInfo` and `InstrumentCatalogProvider.fetchDelistingHistory() => []` (FinMind has no `USStockDelisting` dataset — verified 2026-05-02 via curl, returns 422). `MockFinMindUsStockMarketDataProvider` mirrors: deterministic prices, empty dividends, empty delistings. Registered under `marketData.set("US", ...)` AND `catalog.set("US", ...)`. The `registerCatalogSyncWorker.ts` loop auto-pulls; "US has empty delisting" is just a degenerate per-iteration result. US dividend ingestion lives in **KZO-187** (created 2026-05-02 via this escalation).
- **D6.** ~~Minimal US instrument classifier with substring matching on `"ETF"`/`"Bond ETF"`.~~ **REVISED 2026-05-02 (Phase-1 G-NC-1 resolution, Option C):** US instrument classifier in `libs/domain/src/classifyInstrument.ts`. `classifyInstrument(industryCategory, ticker, marketCode)` gains a `marketCode` parameter. US branch reads FinMind `USStockInfo.Subsector` (free-text — verified 2026-05-02; sample values include `"Aluminum"`, `"Biotechnology: Laboratory Analytical Instruments"`, `"EDPServices"`, `"Blank Checks"`). Strategy is a **hand-curated allow-list** keyed on Subsector and ticker: seed with the 4 reserved E2E tickers (AAPL/MSFT → STOCK, VOO → ETF, BND → BOND_ETF) plus 5–10 common ETF Subsector strings discovered during the verification curl (e.g. `"Investment Trusts/Mutual Funds"`, `"Exchange Traded Funds"` if observed). Default fallback: STOCK. Tests assert allow-list correctness, not heuristic completeness. Comprehensive coverage deferred — autocomplete UX falls back to STOCK gracefully.
- **D7.** Per-market `HISTORY_START_BY_MARKET: Record<MarketCode, string>` map + `historyStartFor(marketCode)` helper. TW: `"1994-10-01"`; US: `"2019-06-01"`; AU: `"1994-10-01"` placeholder with explicit `// TODO(KZO-171): pin AU history start` comment. `backfillWorker.ts:97`: `effectiveStartDate = max(startDate, historyStartFor(market))`.
- **D8.** Reserved E2E US tickers: **AAPL** (STOCK, quarterly cash divs), **VOO** (ETF, quarterly cash divs), **MSFT** (STOCK, second-isolation-guard), **BND** (BOND_ETF, monthly cash divs). Update `.claude/rules/e2e-shared-memory-bars-ticker-hygiene.md` reserved-ticker list with these four + their owning spec mapping.
- **D9.** No US defaults in `DEFAULT_INSTRUMENTS` (`apps/api/src/services/instrumentRegistry.ts:8`). Catalog sync populates US instruments organically.
- **D10.** Separate `MockFinMindUsStockMarketDataProvider` class (parallel to TW mock). Real provider shares the existing FinMind 600/hr `RateLimiter` instance with the TW provider in `registry.ts`.
- **D11.** ~~Synthetic-with-realistic-shape mock fixtures (prices + quarterly/monthly cash dividends).~~ **REVISED 2026-05-02 (Phase-1 G-NC-1 resolution, Option C):** `MockFinMindUsStockMarketDataProvider` emits deterministic AAPL/VOO/MSFT/BND **prices only** starting 2024-01-01. Dividend cadence and per-share-amount fixtures are dropped from KZO-170 because the real provider returns no US dividends — mock dividends would diverge from real and defeat the mock's purpose. Mock divergence parity is restored when **KZO-187** lands. The fixture-start-override constructor variant for the truncation test (G-CRIT-3) is preserved for prices.
- **D12.** Per-market catalog sync reschedule via `{ pendingMarkets?: MarketCode[] }` job payload on `CATALOG_SYNC_QUEUE`. Catch wraps the per-market loop body (not the whole loop). Rate-limited markets reschedule with `singletonKey: CATALOG_SYNC_QUEUE`; daily-refresh enqueue runs for completed markets immediately. Zod parse precedes the try block (per `typed-transient-error-catch-audit.md` Companion). Cron schedule keeps sending `{}` (back-compat).
- **D13.** Trade dates predating `historyStartFor(market)` are **accepted**, not rejected. `effectiveStartDate = max(tradeDate, historyStartFor(market))`. Worker logs `log.info({ ticker, requestedStartDate, providerStartDate }, "pre_provider_history_truncated")` on every truncation. Transition note documents pre-2019 empty-history behavior with worked example.
- **D14.** Drop the explicit "provider health metric updates" AC. Add `readonly providerId: string` field to `MarketDataProvider` + `InstrumentCatalogProvider` interfaces (`'finmind-tw' | 'finmind-us' | 'frankfurter'`). Workers/routes log `{ provider: provider.providerId, ... }` on every fetch failure path. KZO-177 owns the `provider_health_status` table when it lands.
- **D15.** Single PR, Tier 2 (Squad) execution. Code Reviewer runs structured pre-PR review per `.claude/rules/code-review-before-pr.md` before PR creation.
- **D16.** No code change for FinMind 600/hr shared-budget capacity. Document the shared-budget reality in the transition note. `FINMIND_RATE_LIMIT_PER_HOUR` env override exists for ops.
- **D17.** No default US fee profile in scope. Transition note adds a one-line caveat that users should configure US tax rules + USD commission currency on the account's fee profile.

### Mitigations from Phase 1.5 gap check

- **G-CRIT-1 — Second `'TWD'` hardcode at `dividends.ts:593`.** Folded into D1b above. Implementer fixes both currency-derivation sites in the same surface.
- **G-CRIT-2 — `resolveMarketCode` callers + JSDoc.** Folded into D2. Implementer's checklist must include the test-file delete, the JSDoc updates, and a final grep to confirm no stale references remain.
- **G-CRIT-3 — Mock fixture start (2024-01-01) vs trade-date truncation (D13).** QA task description: **all US E2E test seeds use trade dates ≥ 2024-01-01** to match the mock fixture start. Tests asserting truncation behavior use a `MockFinMindUsStockMarketDataProvider` constructor variant that lets them control the fixture start date.
- **G-NC-1 — Verification gate.** Phase 1 step 1 (below) is a hard gate: hit FinMind's `USStockPrice`, `USStockDividend`, `USStockInfo`, `USStockDelisting` datasets manually with the production token; capture response shapes. **If `USStockInfo` or `USStockDelisting` 4xxs, send `[QUESTION]` to the user before proceeding.** This may collapse D5 from "full catalog sync" back to "per-trade metadata"; that's a scope decision not implementation choice. **RESOLVED 2026-05-02:** `USStockDividend` AND `USStockDelisting` both return HTTP 422 (not in FinMind's dataset enum); `USStockPrice` and `USStockInfo` return 200. User picked **Option C** (architect-recommended hybrid): ship narrowed US in KZO-170 (price + catalog only, no dividends, no delistings), open **KZO-187** for US dividend ingestion via alternate provider. See § "Phase-1 G-NC-1 resolution" below for the full resolution payload + raw evidence at `.worklog/team/escalation.md`.
- **G-NC-2 — `provider:` log tag enumeration.** Folded into D14: `providerId` field on the interface is the source-of-truth, not free-form strings.
- **G-NC-3 — Catalog sync payload typing.** `JobWithMetadata<{ pendingMarkets?: MarketCode[] }>[]` with Zod parse pre-try. Mirror of KZO-185's pattern.
- **G-NC-4 — Reserved-ticker rule companion comments.** Phase 9 docs step: keep `dashboard-daily-change-aaa.spec.ts` + `portfolio-snapshots-aaa.spec.ts` top-of-file NOTEs in sync with the rule's reserved-list.
- **G-NC-5 — `CatalogInstrument.marketCode` is non-optional.** Test fixtures requiring `CatalogInstrument[]` literals get type errors during compile; Implementer owns the test fixture updates per `implementer-qa-test-ownership.md`.
- **G-NC-6 — Test API mapper.** No new endpoints; existing endpoint classes for `/market-data/price` need `marketCode` parameter handling. QA owns this update.
- **G-NC-7 — `commission_currency` defaults.** Out-of-scope per D17; transition note caveat only.

## Phase-1 G-NC-1 resolution (2026-05-02)

Phase-1 verification curls returned: `USStockPrice` 200, `USStockDividend` 422 (not in enum), `USStockInfo` 200, `USStockDelisting` 422 (not in enum). The 422s are dataset-enum failures, not auth — adding the prod token would not have changed the result.

**User chose Option C — modified hybrid.** Resolution:

1. **In KZO-170 (this ticket):** ship D1/D1b currency fix + D2/D7/D12/D13/D14 (clean) + narrowed US provider class (price from `USStockPrice` using `Close`, dividends `=> []`, catalog from `USStockInfo`, delisting `=> []`) + classifier allow-list keyed on `Subsector` + price-only mocks.
2. **KZO-187** opened in Linear (priority 3, project "International Markets — US & AU Expansion", related to KZO-170/KZO-186/KZO-177): "US dividend ingestion via alternate provider (Yahoo / Alpha Vantage / manual)." Inherits the dropped AAPL ≥4 quarterly dividend AC.
3. **US delisting detection** deferred — best-effort, low priority. May fold into KZO-187 as a Phase 2 or open a separate ticket later.

Raw curl evidence captured in `.worklog/team/escalation.md` (Architect analysis sections + `## Appendix — Implementer raw verification evidence` with full URLs, status codes, body excerpts, and per-row keys).

Sub-decisions (locked):
- **Bars column:** `Close` (unadjusted), NOT `Adj_Close`. Parity with TW. Adjustment policy is owned by KZO-186 when splits land.
- **Classifier seed:** AAPL/MSFT → STOCK, VOO → ETF, BND → BOND_ETF; default fallback STOCK; tests assert allow-list correctness.
- **Mock provider:** prices only for AAPL/VOO/MSFT/BND from 2024-01-01; no mock dividends.
- **Catalog volume:** `USStockInfo` returns ~9000+ rows; chunk upsert into batches of 500. Implementer to verify on first run.

## Out of Scope (explicit)

- **KZO-186** — Stock splits ingestion + replay invariant 6 (split-aware lot adjustment). Created via this scope-grill session as the splits follow-up.
- **KZO-187** — US dividend ingestion via alternate provider (Yahoo / Alpha Vantage / manual). Created 2026-05-02 via Phase-1 G-NC-1 escalation. Inherits the AAPL ≥4 quarterly dividend AC originally on KZO-170.
- **KZO-177** — Per-provider health UI + stale-data badges. KZO-170 ships the `provider:` log tag groundwork only.
- **KZO-175** — Holdings + transactions table multi-market display. KZO-170's data shape is what 175 reads; no coordination needed.
- **`exchange_subcode` column / structured exchange sub-classification.** First downstream consumer adds it.
- **Default US fee profile templates** — separate ticket (TBD).
- **`provider_health_status` table writes** — KZO-177 owns the schema and the aggregator.
- **API token / env additions** — FinMind token covers all datasets including USStock.
- **US default instruments seeded in `DEFAULT_INSTRUMENTS`** — catalog sync populates organically.

## Acceptance criteria mapping

| Ticket AC | Where satisfied |
|---|---|
| Daily refresh ingests US prices for 4 reserved tickers cleanly | D5 (revised), D8; integration test (Phase 5) — AAPL/VOO/MSFT/BND. Prices only; dividends N/A (KZO-187). |
| Backfill of 1 year history for AAPL (price bars) succeeds in <30 sec | D5 (revised), D11 (revised); integration test asserting backfill round-trip wall-clock for bars only. |
| ~~Dividend ingestion for AAPL captures at least 4 quarterly entries~~ | **DROPPED 2026-05-02 (Phase-1 G-NC-1 resolution, Option C).** FinMind has no `USStockDividend` dataset. AC moved to **KZO-187**. KZO-170 verifies the D1/D1b currency-derivation fix via TW path + a manually-stamped US dividend through the upsert (memory-backed unit test) instead. |
| Provider health metric updates (ties into #15) | **DROPPED per D14**; KZO-177 owns. Groundwork in `provider:` log tags only. |
| Reserved-ticker rule updated with US picks | D8, Phase 9 (docs step) |
| **NEW: D1/D1b currency-derivation fix verified via TW + manually-stamped US dividend** | D1, D1b; unit test (Phase 9) asserts `cash_dividend_currency` derives from `currencyFor(ev.marketCode)`, not the dropped `'TWD'` hardcode. Replay invariant 5 is a no-op for US (account, ticker) pairs in KZO-170 because the dividend set is empty. |

## Implementation Steps

### Phase 1 — Verification gate (RESOLVED 2026-05-02)

- [x] Hit FinMind production endpoints (no token needed for the dataset-enum check).
- [x] Capture response shapes — see `.worklog/team/escalation.md` § "Appendix — Implementer raw verification evidence".
- [x] G-NC-1 escalation fired: `USStockDividend` and `USStockDelisting` both 422 (not in enum). User chose **Option C** (Phase-1 resolution above).
- [x] Classifier field pinned: `Subsector` (free-text), NOT `industry_category`/`type`. Hand-curated allow-list keyed on Subsector + ticker (D6 revised).

### Phase 2 — Provider classes

- [x] Add `readonly providerId: string` to `MarketDataProvider` and `InstrumentCatalogProvider` interfaces in `apps/api/src/services/market-data/types.ts`.
- [x] Set `providerId = "finmind-tw"` on `FinMindMarketDataProvider`. Set `providerId = "finmind"` on existing fallback paths is wrong — use `finmind-tw` consistently.
- [x] Set `providerId = "frankfurter"` on `FrankfurterFxRateProvider` (and mock).
- [x] Add `apps/api/src/services/market-data/providers/finmindUsStock.ts` exporting `FinMindUsStockMarketDataProvider`. Implements both interfaces. **Datasets: `USStockPrice` (bars, using `Close` not `Adj_Close`) and `USStockInfo` (catalog) only.** `fetchDividends() => []` and `fetchDelistingHistory() => []` are intentional empty implementations with JSDoc pointing to KZO-187 (dividends) and a future delisting ticket. `providerId = "finmind-us"`. `sourceId = "finmind-us"`.
- [x] Add `apps/api/src/services/market-data/providers/mockFinmindUsStock.ts` exporting `MockFinMindUsStockMarketDataProvider`. **Deterministic price fixtures** for AAPL/VOO/MSFT/BND from 2024-01-01 (D11 revised). `fetchDividends() => []` and `fetchDelistingHistory() => []` (parity with real provider). Includes `MOCK_US_INSTRUMENT_CATALOG` (4 rows with their pinned Subsector strings for the classifier allow-list test). Constructor variant accepts a `fixtureStartDate` override for the truncation regression test (G-CRIT-3).
- [x] Re-export both from `apps/api/src/services/market-data/providers/index.ts`.

### Phase 3 — Types + classifier

- [x] Replace `HISTORY_START` constant in `types.ts` with `HISTORY_START_BY_MARKET` map + `historyStartFor(marketCode)` helper (D7). Inline `// TODO(KZO-171)` comment on the AU placeholder.
- [x] In `libs/domain/src/`, locate `classifyInstrument` (currently TW-only) and add `marketCode` parameter. Branch on `marketCode === "US"` for US classifier; default to existing TW logic. **Hand-curated allow-list per D6 revised** — keyed on `(subsector, ticker)` reading the `Subsector` field from `USStockInfo`. Seed the allow-list with: AAPL → STOCK, MSFT → STOCK, VOO → ETF, BND → BOND_ETF + 5–10 ETF Subsector strings discovered during the verification curl. Default fallback STOCK.
- [x] Update `libs/domain/test/` with US classifier unit tests covering the seeded 4 reserved tickers + a ticker outside the allow-list (assert STOCK fallback). Tests assert allow-list correctness, not heuristic completeness.

### Phase 4 — Persistence + upsert

- [x] **D1 fix:** `apps/api/src/services/market-data/upserts.ts:139` — replace `array_fill('TWD'::text, ARRAY[$9::int])` with a per-row currency array. Build `const currencies = events.map((ev) => currencyFor(ev.marketCode))` and pass as `$X::text[]`. Update `unnest(...)` and parameter list.
- [x] **D1b fix:** `apps/api/src/services/dividends.ts:593` — replace hardcoded `currencyCode: "TWD"` with `currencyCode: dividendEvent.cashDividendCurrency`.
- [x] Make `marketCode` non-optional on `CatalogInstrument` interface in `apps/api/src/persistence/types.ts:261`.
- [x] `apps/api/src/persistence/postgres.ts:5997` `upsertInstrumentCatalog`: thread per-row `marketCodes` array. Replace `array_fill('TW'::text, ARRAY[$7::int])` at line 6025 with `$N::text[]`. Mirror in `MemoryPersistence` (`memory.ts:2458`).
- [x] `apps/api/src/persistence/postgres.ts:6047` delisting `UPDATE`: add `AND market_code = $X` so cross-market delistings don't update the wrong row. Pair with new optional `marketCode` field on `DelistingRecord` (or pass via `runCatalogSync` param).
- [x] Update `runCatalogSync.ts` to accept `marketCode: MarketCode` parameter; thread through to `upsertInstrumentCatalog`.

### Phase 5 — Backfill worker behavior

- [x] `backfillWorker.ts:97`: change `effectiveStartDate = startDate ?? HISTORY_START` to `effectiveStartDate = startDate && startDate >= historyStartFor(market) ? startDate : historyStartFor(market)`.
- [x] When `startDate < historyStartFor(market)`: emit `log.info({ ticker, requestedStartDate: startDate, providerStartDate: historyStartFor(market) }, "pre_provider_history_truncated")`.
- [x] Add `provider: provider.providerId` to every existing `log.warn({ ... }, "backfill_dividend_fetch_failed: ...")` call site (per D14).

### Phase 6 — Catalog sync per-market reschedule (D12)

- [x] In `registerCatalogSyncWorker.ts`, add Zod schema:
      `const CatalogSyncJobDataSchema = z.object({ pendingMarkets: z.array(z.enum(["TW","US","AU"])).optional() });`
- [x] Update handler typing: `JobWithMetadata<unknown>[]` → parse `job.data` BEFORE the try block (per `typed-transient-error-catch-audit.md` Companion).
- [x] Replace the existing `for (const [, catalogProvider] of catalogRegistry)` loop with the per-market reschedule pattern (see scope-grill Q12 example). Track `completedMarkets`; on `RateLimitedError`, build `remaining = pendingMarkets.filter(m => !completedMarkets.includes(m))` and `boss.send(CATALOG_SYNC_QUEUE, { pendingMarkets: remaining }, { startAfter, singletonKey: CATALOG_SYNC_QUEUE })`.
- [x] Daily-refresh enqueue still runs in `finally` for completed markets.

### Phase 7 — Routes + web

- [x] `apps/api/src/routes/registerRoutes.ts:3036` — add `marketCode: marketCodeSchema` to the `/market-data/price` query Zod object. Pass as `marketDataRegistry.marketData.get(body.marketCode)`. Delete the `resolveMarketCode(query.ticker)` line at `:3062`.
- [x] Delete the `import { resolveMarketCode } from "../services/market-data/marketResolution.js";` at `:74`.
- [x] Delete the file `apps/api/src/services/market-data/marketResolution.ts`.
- [x] Update JSDoc references in `pgBoss.ts:42-44`, `postgres.ts:6141`, `backfill-handler-branching.test.ts:18,74` to reflect the deletion.
- [x] `apps/web/features/portfolio/services/portfolioService.ts:103-113` — add `marketCode: MarketCode` parameter to `fetchMarketDataPrice`. Add to the URLSearchParams.
- [x] `apps/web/features/portfolio/hooks/useTransactionSubmission.ts:97` — pass the form's `marketCode` to `fetchMarketDataPrice`.

### Phase 8 — Registry wiring

- [x] `apps/api/src/services/market-data/registry.ts`: construct US provider parallel to TW. Real provider shares the `finmindLimiter`. Mock branch creates `MockFinMindUsStockMarketDataProvider`. Register under `marketData.set("US", ...)` and `catalog.set("US", ...)`.

### Phase 9 — Tests

**Unit (suite 4):**
- [x] `apps/api/test/unit/finmindUsStockProvider.test.ts` — provider class behavior (response parsing, sourceId stamp, providerId field).
- [x] `apps/api/test/unit/upserts.test.ts` (or new file) — dividend currency derivation by market: TW → TWD, US → USD.
- [x] `apps/api/test/unit/historyStartFor.test.ts` — per-market lookup + TW/US/AU returns.
- [x] `apps/api/test/unit/catalogSyncReschedule.test.ts` — per-market reschedule on RateLimitedError; daily-refresh-enqueue runs for completed markets.
- [x] `libs/domain/test/classifyInstrument.test.ts` — extend with US branch tests.
- [x] **DELETE** `apps/api/test/unit/marketResolution.test.ts`.

**Integration (suite 5, Postgres-backed per `integration-test-persistence-direct.md`):**
- [x] `apps/api/test/integration/usStockBackfill.integration.test.ts` — full US AAPL backfill round-trip; assert bar rows with `market_code='US'` and `source='finmind-us'`. **Dividend assertion DROPPED — real provider returns `[]`. Verify replay invariant 5 is a no-op when the (account, AAPL) dividend set is empty.** Wall-clock <30s.
- [x] `apps/api/test/integration/usCatalogSync.integration.test.ts` — `upsertInstrumentCatalog` with US `CatalogInstrument[]`; per-row `market_code` stamped; delisting `UPDATE` is market-scoped (cross-market delistings don't update wrong rows). **Note: US delisting input is empty in KZO-170 — exercise the cross-market regression with a synthetic US delisting fixture in the test, not via the US provider's `fetchDelistingHistory()`.**
- [x] `apps/api/test/integration/preProviderTruncation.integration.test.ts` — backfill request with `tradeDate=2018-01-01` for AAPL truncates to 2019-06-01 + emits `pre_provider_history_truncated` log; instruments row reaches `bars_backfill_status='ready'`.
- [x] **NEW:** `apps/api/test/unit/upserts-dividend-currency.test.ts` — exercises the D1/D1b fix. Insert TW dividend → assert `cash_dividend_currency='TWD'`; insert manually-stamped US dividend → assert `cash_dividend_currency='USD'`. Memory-backed; doesn't depend on the US provider.

**HTTP (suite 8):**
- [x] `apps/api/test/http/specs/market-data-price-aaa.http.spec.ts` (new or extend existing) — `/market-data/price?ticker=AAPL&date=2024-01-15&marketCode=US` returns price; missing `marketCode` returns 400.

**E2E (suites 6/7):**
- [x] `apps/web/tests/e2e/specs/us-backfill-aaa.spec.ts` (or specs-oauth equivalent) — user enters AAPL trade through chip-selector form, backfill kicks off, dashboard renders USD position. Trade date ≥ 2024-01-01 per G-CRIT-3.
- [x] All US-ticker seeds use `trade_date >= 2024-01-01` (G-CRIT-3 constraint documented in spec headers).

### Phase 10 — Docs

- [x] Update `.claude/rules/e2e-shared-memory-bars-ticker-hygiene.md` reserved-ticker list with **AAPL** (us-backfill-aaa, market-data-price-aaa), **VOO** (reserved for us-etf-aaa), **MSFT** (reserved for us-bars-roundtrip-aaa), **BND** (reserved for us-bond-etf-aaa).
- [x] Update top-of-file NOTEs in `dashboard-daily-change-aaa.spec.ts` and `portfolio-snapshots-aaa.spec.ts` if their reserved-ticker comments reference the rule list shape (G-NC-4). (No changes needed — comments reference the rule file; the rule file was updated.)
- [x] Write `docs/004-notes/kzo-170/transition-202605022121-us-stock-ingestion.md` documenting all 6 required content elements (a-f).
- [x] Update `## Locked Scope` on KZO-170 (done in this scope-grill session).

### Phase 11 — Pre-PR review

- [x] Run `/code-reviewer` per `.claude/rules/code-review-before-pr.md` to produce structured review.
- [x] Work through review fix list top-down with TDD validation.
- [x] Run full 8-suite test gate per `.claude/rules/full-test-suite.md` before opening PR. (Evidence: lint ✅ typecheck ✅ web-unit 117 ✅ api-unit 611 ✅ integration 589+1skip ✅ E2E-bypass 191 ✅ E2E-OAuth 87 ✅ HTTP-API 189+2skip ✅)
- [x] PR description draft per `.claude/rules/pr-bound-docs-review-compliance.md` at `.worklog/team/pr-description-draft.md`.

## References

- Scope-grill session: this file
- KZO-186 (splits follow-up): https://linear.app/kzokv/issue/KZO-186
- KZO-187 (US dividend ingestion via alternate provider): https://linear.app/kzokv/issue/KZO-187 — created 2026-05-02 via Phase-1 G-NC-1 escalation. Inherits the AAPL ≥4 quarterly dividend AC.
- KZO-163 (provider registry): completed, scope-todo at `docs/004-notes/kzo-163/`
- KZO-164 (Frankfurter FX): completed, scope-todo at `docs/004-notes/kzo-164/`
- KZO-169 (composite PK + UI selector): completed, scope-todo at `docs/004-notes/kzo-169/`
- KZO-185 (pgboss back-compat removal): completed, transition note at `docs/004-notes/kzo-185/`
