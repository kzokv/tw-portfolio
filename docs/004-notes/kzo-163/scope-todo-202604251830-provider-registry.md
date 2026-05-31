---
slug: kzo-163
source: scope-grill
created: 2026-04-25
tickets: [KZO-163]
required_reading: []
superseded_by: null
---

# Todo: KZO-163 — Provider registry + market data abstraction refactor

> **For agents starting a fresh session:** read this file end-to-end before starting implementation. The locked decisions encode 10 grill-session findings — skipping them re-opens questions that were already resolved.

## Goal

Pure refactor — extract FinMind into a generic `MarketDataProvider` abstraction so KZO-164 (FX), KZO-170 (US), KZO-171 (AU) can each plug in a single provider without touching call sites. **No functional change** for TW ingestion paths, with one explicit behavioral delta (item N8 in the gap check — the price route gains rate-limiting).

## Locked Decisions Reference

| # | Decision |
|---|---|
| D1 | Define only `MarketDataProvider` in 163. Hold `FxRateProvider` for KZO-164. |
| D2 | Registry is `Map<MarketCode, MarketDataProvider>` — single key per market. |
| D3 | Two interfaces: `MarketDataProvider` (bars/dividends) + `InstrumentCatalogProvider` (catalog/delisting). Separate registries. |
| D4 | No `market` parameter on method signatures. Provider is per-market. |
| D5 | Per-provider `RateLimiter` owned by the provider. Throws typed `RateLimitedError`. Worker catches and reschedules. |
| D6 | Single composition root at `apps/api/src/services/market-data/registry.ts` → `app.marketDataRegistry`. Collapses `pgBoss.ts` and `registerRoutes.ts:2567` construction sites. |
| D7 | Optional `sourceId?: string` on `RawDailyBar`/`DividendRecord`. FinMind sets `'finmind'`. `upserts.ts` reads with `?? 'finmind'` fallback. No DB rows change. |
| D8 | New helper `marketResolution.ts` exporting `resolveMarketCode(ticker)` — returns `'TW'` for all tickers in 163. Single seam. |
| D9 | Extend `envSchema` with `FINMIND_BASE_URL` (defaulted) and `FINMIND_RATE_LIMIT_PER_HOUR` (defaulted to 600). Update `.env.example`. |
| D10 | Providers in `apps/api/src/services/market-data/providers/`. Rename `FinMindClient` → `FinMindMarketDataProvider`. No new `libs/` package. |
| C1 | Delete `FinMindProvider` interface from `types.ts`. Replace with the two new interfaces. |
| C2 | `sourceId` is **optional** with `'finmind'` fallback (preserves existing test fixtures). |
| N8 | Price route `/market-data/price` gains rate-limiting via shared FinMind budget. Call out in PR description. |

## Implementation Steps

### Phase 1 — Type definitions + registry skeleton

- [ ] **Step 1: New interfaces in `apps/api/src/services/market-data/types.ts`**
  - [ ] Define `MarketDataProvider` interface: `fetchBars(ticker, startDate?, endDate?)`, `fetchDividends(ticker, startDate?, endDate?)`
  - [ ] Define `InstrumentCatalogProvider` interface: `fetchInstrumentCatalog()`, `fetchDelistingHistory()`
  - [ ] Add **optional** `sourceId?: string` field to `RawDailyBar`
  - [ ] Add **optional** `sourceId?: string` field to `DividendRecord`
  - [ ] Define typed `RateLimitedError` class with `msUntilAvailable: number` field
  - [ ] **Delete** `FinMindProvider` interface (replaced by the two new interfaces)

- [ ] **Step 2: Env schema extension in `libs/config/src/env-schema.ts`**
  - [ ] Add `FINMIND_BASE_URL: z.string().url().default("https://api.finmindtrade.com/api/v4/data")`
  - [ ] Add `FINMIND_RATE_LIMIT_PER_HOUR: z.coerce.number().int().positive().default(600)`
  - [ ] Update `.env.example` with both new vars + comments
  - [ ] Rebuild `@tw-portfolio/config` package

- [ ] **Step 3: New folder `apps/api/src/services/market-data/providers/`**
  - [ ] Create directory + `index.ts` barrel

### Phase 2 — Provider class refactor

- [ ] **Step 4: Rename + relocate FinMind classes**
  - [ ] Move `apps/api/src/services/market-data/finmindClient.ts` → `providers/finmind.ts`
  - [ ] Rename `FinMindClient` class → `FinMindMarketDataProvider`
  - [ ] Class implements both `MarketDataProvider` AND `InstrumentCatalogProvider`
  - [ ] Constructor accepts `{ token, baseUrl, market, datasets, rateLimiter }` config
  - [ ] Hardcoded `FINMIND_BASE` removed; use `config.baseUrl`
  - [ ] In each method: call `rateLimiter.canConsume()` → on false, throw `RateLimitedError({ msUntilAvailable })`; on true, `consume()` then fetch
  - [ ] Each method that returns `RawDailyBar`/`DividendRecord` sets `sourceId: 'finmind'` on the returned objects
  - [ ] Move `apps/api/src/services/market-data/finmindClient.mock.ts` → `providers/mockFinmind.ts`
  - [ ] Rename `MockFinMindClient` class → `MockFinMindMarketDataProvider`. Preserve `readonly calls` field for test compatibility.
  - [ ] Mock implements both interfaces. Mock returns objects with `sourceId: 'finmind'` set.

- [ ] **Step 5: Worker rate-limit refactor (`backfillWorker.ts`, `registerCatalogSyncWorker.ts`)**
  - [ ] Remove `rateLimiter: RateLimiter` from worker deps (now owned by provider)
  - [ ] Remove pre-call `canConsume()` checks in workers
  - [ ] Wrap provider calls in `try/catch(RateLimitedError)`. On catch: reschedule via `boss.send(QUEUE, job.data, { startAfter: Math.ceil(err.msUntilAvailable / 1000) })`
  - [ ] Worker tests: update mock providers to throw `RateLimitedError` for the rate-limit test cases (replaces the `rateLimiter.canConsume.mockReturnValue(false)` pattern)

### Phase 3 — Registry + composition root

- [ ] **Step 6: Build `apps/api/src/services/market-data/registry.ts`**
  - [ ] Export type `MarketDataRegistry = { marketData: Map<MarketCode, MarketDataProvider>, catalog: Map<MarketCode, InstrumentCatalogProvider> }`
  - [ ] Export `buildMarketDataRegistry(env: EnvConfig): MarketDataRegistry`
  - [ ] Inside: build `RateLimiter({ budget: env.FINMIND_RATE_LIMIT_PER_HOUR })` for FinMind
  - [ ] Inside: select `Env.FINMIND_API_TOKEN ? new FinMindMarketDataProvider(...) : new MockFinMindMarketDataProvider()` (centralizes the dev/prod fallback that was duplicated)
  - [ ] Register the FinMind instance under both `marketData.set('TW', ...)` AND `catalog.set('TW', ...)`
  - [ ] Return registry

- [ ] **Step 7: New `marketResolution.ts`**
  - [ ] Export `resolveMarketCode(ticker: string): MarketCode` — returns `'TW'` for all tickers in 163
  - [ ] Add JSDoc noting KZO-170 will upgrade with `instruments` lookup + heuristic

- [ ] **Step 8: Attach to `app` in `apps/api/src/app.ts`**
  - [ ] Add `marketDataRegistry: MarketDataRegistry` to `AppInstance` type
  - [ ] Build registry at boot, assign `app.marketDataRegistry = buildMarketDataRegistry(Env)`

### Phase 4 — Call-site updates

- [ ] **Step 9: `apps/api/src/plugins/pgBoss.ts`**
  - [ ] Remove `new RateLimiter()` construction (now per-provider, in registry)
  - [ ] Remove the `Env.FINMIND_API_TOKEN ? new FinMindClient() : new MockFinMindClient()` line (now in registry)
  - [ ] Worker deps changes: pass `marketDataRegistry: app.marketDataRegistry.marketData` + `catalogRegistry: app.marketDataRegistry.catalog` + `resolveMarketCode` instead of `finmind` + `rateLimiter`

- [ ] **Step 10: `apps/api/src/services/market-data/backfillWorker.ts`**
  - [ ] Replace `finmind: FinMindProvider` dep → `marketDataRegistry: Map<MarketCode, MarketDataProvider>` + `resolveMarketCode: (ticker) => MarketCode`
  - [ ] Per-job: `const market = resolveMarketCode(ticker); const provider = marketDataRegistry.get(market); if (!provider) throw new Error(...)`
  - [ ] Use `provider.fetchBars(...)`, `provider.fetchDividends(...)`
  - [ ] Catch `RateLimitedError` → reschedule (replaces current pre-check)

- [ ] **Step 11: `apps/api/src/services/market-data/registerCatalogSyncWorker.ts`**
  - [ ] Replace `finmind: FinMindProvider` dep → `catalogRegistry: Map<MarketCode, InstrumentCatalogProvider>`
  - [ ] Worker handler: `for (const [market, catalogProvider] of catalogRegistry) { await runCatalogSyncFn({ catalogProvider, persistence, log }) }` (single iteration today; future-proof for KZO-170)
  - [ ] Remove `rateLimiter` dep + pre-call checks
  - [ ] Remove hardcoded `CATALOG_SYNC_CALLS = 2` (per-provider via internal limiter)

- [ ] **Step 12: `apps/api/src/services/market-data/runCatalogSync.ts`**
  - [ ] Replace `finmind: FinMindProvider` dep → `catalogProvider: InstrumentCatalogProvider`
  - [ ] Use `catalogProvider.fetchInstrumentCatalog()` + `catalogProvider.fetchDelistingHistory()`

- [ ] **Step 13: `apps/api/src/services/market-data/upserts.ts`**
  - [ ] `upsertDailyBars`: replace hardcoded `array_fill('finmind'::text, ...)` with per-row `sourceId ?? 'finmind'` from input. Read each bar's `sourceId` field.
  - [ ] `deriveDividendKey`: read `ev.sourceId ?? 'finmind'` for the prefix instead of hardcoding `finmind:`. Existing IDs preserved (TW path still uses `'finmind'`).

- [ ] **Step 14: `apps/api/src/routes/registerRoutes.ts`**
  - [ ] Line ~57-58: remove `import { FinMindClient }` and `import { MockFinMindClient }`
  - [ ] Line ~2567 (`/market-data/price` route): replace inline construction with `app.marketDataRegistry.marketData.get(resolveMarketCode(query.ticker))` (effectively `'TW'`)
  - [ ] **Behavioral delta** — route now subject to FinMind rate limit. Catch `RateLimitedError` → return 503 + retry-after header (or surface as 429 with `retry-after`). Decide which during implementation; document in PR.
  - [ ] Line ~2576: keep `source: "finmind"` literal for now (the bars are upserted via `opportunisticUpsertDailyBars`; the value comes from `RawDailyBar.sourceId` after refactor)

### Phase 5 — Caller verification + testing

- [ ] **Step 15: `interface-caller-verification.md` audit**
  - [ ] `grep -r "FinMindProvider" apps/api libs` — should return zero matches
  - [ ] `grep -r "FinMindClient\|MockFinMindClient" apps/api libs` — should return zero matches
  - [ ] `grep -r "MarketDataProvider\|InstrumentCatalogProvider" apps/api libs` — verify every method has at least one caller (Decision 6 ensures all three FinMind methods do)

- [ ] **Step 16: `process-refactor-rename-verification.md` audit**
  - [ ] All callers of renamed classes/types updated and listed in PR description

- [ ] **Step 17: Test file updates (~10 files)**
  - [ ] `apps/api/test/unit/backfill-handler-branching.test.ts` — replace `finmind` mock with `MarketDataProvider` mock + registry/`resolveMarketCode` injection
  - [ ] `apps/api/test/unit/catalog-sync-worker.test.ts` — replace `finmind` mock with `InstrumentCatalogProvider` mock + `catalogRegistry` injection
  - [ ] `apps/api/test/unit/finmind-client-mock.test.ts` — update to test renamed `MockFinMindMarketDataProvider`
  - [ ] `apps/api/test/unit/finmind-dividend-mapper.test.ts` — update imports/types
  - [ ] `apps/api/test/unit/catalogSync.test.ts` — update imports/types
  - [ ] `apps/api/test/integration/catalogSync.integration.test.ts` — update DI shape
  - [ ] `apps/api/test/integration/dividend-enrichment.integration.test.ts` — update imports
  - [ ] `apps/api/test/integration/daily-refresh-persistence.integration.test.ts` — update imports
  - [ ] `apps/api/test/integration/backfill-repair.integration.test.ts` — update DI shape + RateLimitedError handling
  - [ ] `apps/api/test/integration/transaction-form-polish.integration.test.ts` — verify no FinMind direct usage; if any, update

- [ ] **Step 18: Full-suite gate (per `full-test-suite.md`)**
  - [ ] `npx eslint . --max-warnings=0`
  - [ ] `npm run typecheck`
  - [ ] `npm run test:all:full`
  - [ ] If anything fails, fix with `fixer-red-green-verification` loop — never modify production auth/route code to satisfy test setup

### Phase 6 — Docs + PR

- [ ] **Step 19: Update architecture docs**
  - [ ] If `docs/market-data-platform.md` exists, add a "Provider Registry" section (single composition root, 2 interfaces, market→provider key, per-provider rate limiter, sourceId field)
  - [ ] If not, create a transition note `docs/004-notes/kzo-163/transition-202604XXNNNN-provider-registry.md` covering the shape

- [ ] **Step 20: PR description**
  - [ ] List all renamed types/classes (interface-caller verification rule)
  - [ ] **Call out the `/market-data/price` rate-limiting behavioral delta** (from gap N8) — explicit "this is intentional, not a regression"
  - [ ] List all callers updated (`registerRoutes.ts:2567`, `pgBoss.ts:41`, both worker files)
  - [ ] Reference KZO-164/170/171 as downstream beneficiaries

## Open Items (carried forward)

- [ ] **Note for KZO-170 implementer:** When a second mock provider lands, the `calls` field aggregator pattern needs to be revisited. Today each provider mock owns its own `calls` array.
- [ ] **Note for KZO-170 implementer:** `resolveMarketCode(ticker)` will need to be upgraded — query `market_data.instruments.market_code` for known tickers; pattern-based heuristic for unknown ones.
- [ ] **PR-time confirmation:** the `/market-data/price` rate-limit delta is intentional. Reviewer should not flag it as a regression.

## References

- Linear ticket: [KZO-163](https://linear.app/kzokv/issue/KZO-163/provider-registry-market-data-abstraction-refactor)
- Blocks: KZO-164 (FX), KZO-167 (default_currency), KZO-170 (US), KZO-171 (AU spike), KZO-173 (multi-market trading calendar)
- Related project: International Markets — US & AU Expansion
- Existing market-data architecture: `docs/004-notes/005-market-data/adr-202603251800-historical-data-store-topology.md` (frozen — phase-1 topology)
- Convention rules cited: `interface-caller-verification.md`, `process-refactor-rename-verification.md`, `migration-strategy.md`, `commit-format.md`, `full-test-suite.md`, `fixer-red-green-verification.md`, `local-pg-debug-environment.md`
