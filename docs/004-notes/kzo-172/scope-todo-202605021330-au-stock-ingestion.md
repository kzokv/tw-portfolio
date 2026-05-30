---
slug: kzo-172
source: scope-grill+debate
created: 2026-05-02
tickets: [KZO-172, KZO-188, KZO-189, KZO-190]
required_reading:
  - docs/004-notes/kzo-171/spike-202605021115-au-provider.md
  - docs/004-notes/kzo-170/transition-202605022121-us-stock-ingestion.md
  - docs/004-notes/kzo-163/transition-202604251534-provider-registry.md
  - .worklog/scopes/kzo-172/debate-brief.md
  - .worklog/scopes/kzo-172/debate-result.md
  - .worklog/scopes/kzo-172/debate-note.md
superseded_by: null
---

# Todo: KZO-172 — AU Market Data Ingestion via yahoo-finance2

> **For agents starting a fresh session:** read all files listed in `required_reading` above before starting implementation. The KZO-171 spike and KZO-172 debate result are the canonical source of architectural decisions; this todo is the actionable distillation.

## Locked Decisions Summary

This scope was produced through:

1. **KZO-171 spike** (`docs/004-notes/kzo-171/spike-202605021115-au-provider.md`) — pre-locked ~85% of decisions: `yahoo-finance2@^3.14.0`, `chart()` over `historical()`, `${ticker}.AX` symbol normalization, `historyStartFor("AU") = "1988-01-28"`, bounded catalog only, splits → KZO-186, provider health → KZO-177, franking → EODHD upgrade.
2. **scope-grill Phase 1** — locked the 7 deferred items (Q1–Q7).
3. **scope-grill Phase 1.5** — proposed 10 default details + 1 user correction (Path A UI scope expansion).
4. **`/debate` Phase 2** — adversarial review by 6-agent team (architect/backend/frontend/security/qa/reviewer/moderator). Converged in 2 rounds. Produced 5 architectural REVISITs + 2 completeness fixes + 1 input-validation tightening, all folded into the locks below.
5. **User adjudication of REVISIT-PROPOSED E2** — locked **P1 (unconditional)** for daily-refresh metadata enrichment. Conditional optimization tracked as KZO-189.

## Path Decomposition

KZO-172 ships **backend slice only**: provider, endpoint, HTTP test, reserved-ticker rule. UI integration (`InstrumentCatalogSheet` + `InstrumentCombobox` live-search fallback, web service, debounce, E2E) split into **KZO-188** per `phased-ticket-scope-completeness.md` standalone-deployable test.

KZO-172 is independently shippable: the bounded 7-ticker AU catalog is functional Day 1; no UI regression on the missing-from-catalog case (that's the current state for any non-monitored ticker).

## Implementation Steps

### Phase 1 — Provider class

- [x] Add `yahoo-finance2@^3.14.0` to `apps/api/package.json` dependencies. `npm install` then commit `package-lock.json`.
- [x] Create `apps/api/src/services/market-data/providers/yahooFinanceAu.ts` exporting `YahooFinanceAuMarketDataProvider`.
  - `providerId = "yahoo-finance-au"`.
  - Constructor: `{ rateLimiter: RateLimiter }`. Instantiate `YahooFinance` internally with `{ suppressNotices: ["yahooSurvey"] }`.
  - Implements **both** `MarketDataProvider` AND `InstrumentCatalogProvider` (single class, two interfaces; FinMind precedent).
  - JSDoc class header documents (a) bare-ticker contract, (b) Yahoo ToS personal/non-commercial constraint with cross-link to spike §7.3.
- [x] Internal helper `normalizeSymbol(ticker: string): string` → `${ticker.trim()}.AX`. **ALL** Yahoo SDK calls (`chart`, `quote`, `quoteSummary`, `search`) route through this helper. Pre-PR grep verifies no direct call.
- [x] `fetchBars(ticker, startDate?, endDate?)`:
  - `chart(normalizeSymbol(ticker), { period1, period2, interval: "1d" })`.
  - **Australia/Sydney timezone shift** before emitting `bar_date` (mirrors KZO-83 TW pattern).
  - Map `r.quotes` → `RawDailyBar[]`, each with `sourceId: "yahoo-finance-au"`.
  - Pre-flight `assertCanConsume()` (1 slot).
- [x] `fetchDividends(ticker, startDate?, endDate?)`:
  - Separate `chart()` call with `events: "div"`.
  - Map `r.events.dividends` → `DividendRecord[]`, each `sourceId: "yahoo-finance-au"`. No franking/DRP/BSP fields.
  - Pre-flight `assertCanConsume()` (1 slot).
- [x] `fetchInstrumentCatalog()` returns 7 hardcoded `RawInstrumentInfo[]`: BHP, CSL, VAS, WBC, AFI, GMG, IMD.
  - Each row: `{ ticker, name, typeRaw: "ASX", industryCategory: <quoteType>, date }`.
  - VAS → `industryCategory: "ETF"`; others → `"EQUITY"`.
  - **No API call** — purely static. `assertCanConsume()` not invoked here.
- [x] `fetchDelistingHistory()` → `[]`. JSDoc explains Yahoo doesn't expose AU delistings.
- [x] `fetchInstrumentMetadata(ticker)` (NEW interface method on `InstrumentCatalogProvider`):
  - Calls `quote(normalizeSymbol(ticker))`.
  - Returns `{ ticker, name: longName, typeRaw: "ASX", industryCategory: quoteType, date: today }` or `null` on error.
  - Pre-flight `assertCanConsume()` (1 slot).
- [x] `searchInstruments(query)` (NEW interface method on `InstrumentCatalogProvider`):
  - Calls `search(query, { quotesCount: 7, lang: "en-AU", region: "AU" })`.
  - **Defensive double-filter**: `exchange === "ASX" && symbol.endsWith(".AX")`.
  - Maps to `RawInstrumentInfo[]`.
  - Pre-flight `assertCanConsume()` (1 slot).

### Phase 2 — Mock provider

- [x] Create `apps/api/src/services/market-data/providers/mockYahooFinanceAu.ts` exporting `MockYahooFinanceAuMarketDataProvider`.
  - Constructor accepts optional `{ fixtureStartDate?: string }` (default `"2024-01-02"`).
  - `calls: Array<{ method, ticker?, query?, n? }>` for test inspection (mirrors `MockFinMindUsStockMarketDataProvider`).
- [x] Mock `fetchBars` produces deterministic bars from `fixtureStartDate` for BHP/CSL/VAS/WBC/AFI.
- [x] **Mock `fetchDividends` for BHP must hardcode ≥4 `DividendRecord` entries spanning ≥3 years.** Real BHP cadence is twice-yearly; a 1-year window yields only 2 — fails AC #2.
- [x] Mock `fetchInstrumentCatalog` returns the same 7-row reserved set.
- [x] Mock `fetchInstrumentMetadata` returns deterministic enriched rows for the 7 reserved tickers + CBA. Returns `null` for unknown.
- [x] Mock `searchInstruments` includes CBA in fixture results so KZO-188's discovery E2E test works without a real Yahoo call.

### Phase 3 — Interface + registry changes

- [x] In `apps/api/src/services/market-data/types.ts`:
  - Add `fetchInstrumentMetadata(ticker: string): Promise<RawInstrumentInfo | null>` to `InstrumentCatalogProvider` interface.
  - Add `searchInstruments(query: string): Promise<RawInstrumentInfo[]>` to `InstrumentCatalogProvider` interface.
- [x] In `apps/api/src/services/market-data/providers/finmind.ts` and `finmindUsStock.ts` (and their mocks): implement both new methods as no-ops (`fetchInstrumentMetadata: async () => null`, `searchInstruments: async () => []`). JSDoc explains design intent (catalog dump is comprehensive; per-ticker enrichment unnecessary).
- [x] In `apps/api/src/services/market-data/registry.ts`:
  - Construct `new RateLimiter(env.YAHOO_AU_RATE_LIMIT_PER_MINUTE, 60_000)` for AU (separate instance from FinMind's 600/hr).
  - Branch on `env.AU_PROVIDER_MOCK ? MockYahooFinanceAuMarketDataProvider : YahooFinanceAuMarketDataProvider`.
  - Register **same instance** to both `marketData.set("AU", ...)` and `catalog.set("AU", ...)`.
  - Add startup log warning when `!env.AU_PROVIDER_MOCK`: `app.log.warn({ provider: "yahoo-finance-au" }, "yahoo_finance_tos_notice: ToS limits use to personal/non-commercial. For multi-tenant deployment, switch to EODHD per spike §7.3.")`. Conditionally include `userCount` field IF `persistence.countUsers()` already exists — do NOT add a new persistence method for this.

### Phase 4 — Env config

- [x] In `libs/config/src/env-schema.ts`, add to `envSchema`:
  - `YAHOO_AU_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(60)`
  - `AU_PROVIDER_MOCK: z.coerce.boolean().default(false)`
  - `MARKET_DATA_SEARCH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(20)`
- [x] Update `.env.example` and `infra/docker/.env.example` with the new vars.

### Phase 5 — Worker integration

- [x] In `apps/api/src/services/market-data/registerBackfillWorker.ts`: `BackfillWorkerDeps` gains `catalogRegistry: Map<MarketCode, InstrumentCatalogProvider>`. Update factory.
- [x] In `apps/api/src/services/market-data/backfillWorker.ts`:
  - Resolve both `marketData.get(market)` (bars/dividends) and `catalog.get(market)` (metadata). Same instance for AU.
  - **Keep dynamic-count formula at line 154** with comment noting the +1 for metadata. Flat `reserveCapacity(3)` is the simpler alternative — pick one and document. KZO-190 tracks the dynamic refactor as cleanup.
  - After `fetchBars` + `fetchDividends`: call `catalogProvider.fetchInstrumentMetadata(ticker)`.
  - **Error policy (REVISIT-D from debate):** warn-and-continue on non-`RateLimitedError`; **mandatory re-throw of `RateLimitedError`** per `.claude/rules/typed-transient-error-catch-audit.md`. Mirror dividend pattern at `backfillWorker.ts:189-202` exactly.
  - If non-null, persist via `buildCatalogInstruments([raw], "AU")` → `persistence.upsertInstrumentCatalog([single], [])`. Optional refactor: extract `upsertInstrumentCatalogRows(pool, instruments)` helper per reviewer MEDIUM-1.
  - **No trigger gating** — every backfill (any trigger) calls `fetchInstrumentMetadata`. P1 locked. KZO-189 tracks the conditional gating optimization.

### Phase 6 — History start + classifier

- [x] In `apps/api/src/services/market-data/types.ts`:
  - `HISTORY_START_BY_MARKET["AU"] = "1988-01-28"` (was placeholder `"1994-10-01"`).
  - Remove `// TODO(KZO-171): pin AU history start.` comment.
- [x] In `libs/domain/src/classifyInstrument.ts`:
  - Add `marketCode === "AU"` branch BEFORE the TW substring path.
  - `industryCategory === "ETF"` → `"ETF"`; else `"STOCK"`.
  - **No `BOND_ETF`** for AU in v1 (spike-locked).
  - Update tests.

### Phase 7 — `/market-data/search` route

- [x] In `apps/api/src/lib/`, create `marketDataSearchRateLimit.ts` exporting:
  - `assertMarketDataSearchRateLimit(ip: string)` — sliding-window per-IP, default 20/min.
  - `registerMarketDataSearchEviction(app: FastifyInstance)` — factory pattern per `.claude/rules/fastify-eviction-lifecycle-pattern.md`.
- [x] In `apps/api/src/routes/registerRoutes.ts`:
  - Call `registerMarketDataSearchEviction(app)` at the top of `registerRoutes()`.
  - Add `GET /market-data/search` handler:
    ```ts
    app.get("/market-data/search", async (req, reply) => {
      resolveUserId(req, app.oauthConfig?.sessionSecret);
      assertMarketDataSearchRateLimit(req.ip);
      const query = z.object({
        q: z.string().trim().min(2).max(50).regex(/^[A-Za-z0-9 .&'()-]+$/),
        market_code: z.enum(["TW", "US", "AU"]),
      }).parse(req.query);
      const provider = app.marketDataRegistry.catalog.get(query.market_code);
      if (!provider) {
        throw routeError(404, "market_not_supported", "market not supported");
      }
      try {
        const raws = await provider.searchInstruments(query.q);
        return { instruments: raws.map(toInstrumentCatalogItemDto) };
      } catch (err) {
        if (err instanceof RateLimitedError) {
          reply.header("Retry-After", String(err.retryAfterSeconds));
          throw routeError(503, "provider_rate_limited", "market data search rate limit exceeded");
        }
        app.log.warn({ err, q: query.q, market: query.market_code }, "search_provider_error");
        reply.header("X-Search-Degraded", "true");
        throw routeError(503, "search_unavailable", "search temporarily unavailable");
      }
    });
    ```
- [x] **Critical** per `.claude/rules/fastify-raw-streaming-cors.md`: this route uses `reply.send()` (not raw), so headers buffered by `onSend` hooks fire normally. No raw-streaming propagation needed.

### Phase 8 — Tests

- [x] **Unit (suite 4):**
  - `apps/api/src/services/market-data/providers/yahooFinanceAu.test.ts` — provider class behavior, `.AX` normalization via `normalizeSymbol`, response parsing, `sourceId` stamp, error mapping for "No data found" / `BadRequestError`.
  - `libs/domain/src/classifyInstrument.test.ts` — AU branch (VAS → ETF, BHP → STOCK, etc.).
  - `apps/api/src/services/market-data/backfill-handler-branching.test.ts` (extend existing) — Yahoo error mapping, `RateLimitedError` re-throw from metadata enrichment, warn-and-continue on generic errors.
- [x] **Integration (suite 5, Postgres-backed):**
  - `apps/api/test/integration/auStockBackfill.integration.test.ts` (NEW) — AU BHP backfill round-trip with **explicit `<60s` wall-clock assertion** (AC #3). Tests dividend ingestion ≥4 entries (AC #2), pre-1988 trade-date truncation, `fetchInstrumentMetadata` enrichment persistence, cross-market market-scoped `UPDATE` regression with synthetic AU delisting fixture. Mirror KZO-170's pattern; use `PostgresPersistence` directly per `.claude/rules/integration-test-persistence-direct.md`.
- [x] **HTTP (suite 8):**
  - `apps/api/test/http/specs/market-data-search-aaa.http.spec.ts` (NEW) — extend existing `MarketDataEndpoint` (do not create `MarketDataSearchEndpoint`; avoids `test-api-mapper-registration.md` recurrence). Cases: AU returns BHP.AX, missing market_code → 400, whitespace-only `q` → 400, regex mismatch → 400, per-IP rate-limit fires after 20 calls.
  - Extend `apps/api/test/http/specs/market-data-price-aaa.http.spec.ts` with AU case: `?ticker=BHP&date=2024-06-15&market_code=AU` → AUD price.
- [x] **E2E (suite 6, bypass mode):**
  - `apps/web/tests/e2e/specs/au-backfill-aaa.spec.ts` (NEW) — parallel to `us-backfill-aaa.spec.ts`. User enters BHP trade through chip-selector form → backfill kicks off → dashboard renders AUD position. Trade dates ≥ `2024-01-02` per mock fixture start.

### Phase 9 — Reserved-ticker rule update

- [x] Update `.claude/rules/e2e-shared-memory-bars-ticker-hygiene.md`:
  - **Add an AU section** listing all 8 reserved tickers:
    - Memory-backed E2E/HTTP: BHP (au-backfill-aaa, au-dividends-aaa), CSL (au-backfill-aaa), VAS (au-etf-aaa), WBC (au-backfill-aaa), AFI (au-lic-aaa).
    - Postgres-only (auStockBackfill.integration.test.ts): GMG, IMD. Note per MSFT/VOO/BND precedent: "currently only referenced in Postgres-backed integration tests; listed here to prevent future memory-backed E2E/HTTP specs from accidentally reusing them."
    - Reserved for KZO-188: CBA (AU discovery test ticker for `au-ticker-discovery-aaa.spec.ts`).
  - Update the top-of-file ticker reservation date to 2026-05-02 KZO-172.

### Phase 10 — Documentation

- [x] Create `docs/004-notes/kzo-172/transition-202605051045-au-stock-ingestion.md`:
  - **What shipped** — provider class, endpoint, env vars, schema additions. ✅
  - **`reserveCapacity` rationale** — flat 3 vs dynamic, 1-slot over-reservation for FinMind providers (KZO-190 tracks cleanup). ✅
  - **First-deploy race documentation** — Q4 inline enrichment is the load-bearing invariant (the static reserved set seeds the catalog; user-add path enriches via `fetchInstrumentMetadata`). ✅
  - **Australia/Sydney timezone shift** — bar dates normalized to ASX session. ✅
  - **Yahoo ToS framing** + EODHD switch triggers (cross-link to spike §7.3). ✅
  - **Path A UI follow-up** — KZO-188 reference. ✅
  - **Provider Health UI deferred** — KZO-177 reference; this ticket ships only `provider:` log enrichment. ✅
  - **Conditional metadata enrichment** — KZO-189 tracked; v1 ships unconditional per user choice. ✅
  - **`industry_category_raw` for AU** — currently `quoteType` (EQUITY/ETF); free-text via `quoteSummary` deferred to follow-up. ✅
  - **5 Informational CR items** — transcribed as deferred design-decision bullets. ✅
  - **Test convergence summary** — Phase 1-7 backend + Phase 8a/b/c/d test surface, 8/8 suites green. ✅
  - **Validator self-activation process notes** — two incidents documented with mitigation. ✅
  - **Scope-todo doc-drift note** (F-Q1) — test file path discrepancy documented. ✅
  - **Runbook §19** — AU deploy notes added (`docs/002-operations/runbook.md`). ✅

### Phase 11 — Pre-PR gate

- [x] Run pre-PR full gate per `.claude/rules/full-test-suite.md`:
  ```bash
  npx eslint . --max-warnings=0 && npm run typecheck && npm run test:all:full
  ```
- [x] Pre-PR code review per `.claude/rules/code-review-before-pr.md` — produce review doc at `docs/004-notes/kzo-172/review-{YYYYMMDDHHmm}-iter1.md`.
- [x] Verify pgboss `BACKFILL_QUEUE` has `retryLimit ≥ 3` + sensible `retryDelay` (Architect open item).
- [x] Grep audit per `.claude/rules/process-refactor-rename-verification.md`: every Yahoo SDK call goes through `normalizeSymbol`.
- [x] Catalog-sync round-trip safety: integration test asserts the 7-row reserved set survives `dedupe → build → upsert` cycle without `isProvisional` flipping (Architect open item).

## Open Items (tracked, non-blocking)

- [ ] **KZO-188** — Path A UI follow-up (created; high priority).
- [ ] **KZO-189** — Conditional metadata enrichment (created; low priority).
- [ ] **KZO-190** — `reserveCapacity` cleanup (created; low priority).
- [ ] **KZO-177** — Per-provider health UI + stale-data badges (existing, covers the original ticket's "per-provider health metric" line item).
- [ ] **Conditional vs flat `reserveCapacity`** — pick one in Phase 5 implementation; document in transition note.
- [ ] **First-deploy race doc** — write into transition note Phase 10.
- [ ] **Catalog-sync round-trip assertion** — add to `auStockBackfill.integration.test.ts`.
- [ ] **AC retry-count verification** — confirm `BACKFILL_QUEUE` retry policy supports the original ticket's "exponential backoff up to 3 attempts" via pg-boss.

## References

- **Linear tickets:**
  - KZO-172 (this ticket): https://linear.app/kzokv/issue/KZO-172/
  - KZO-188 (Path A UI follow-up): https://linear.app/kzokv/issue/KZO-188/
  - KZO-189 (metadata enrichment optimization): https://linear.app/kzokv/issue/KZO-189/
  - KZO-190 (reserveCapacity cleanup): https://linear.app/kzokv/issue/KZO-190/
  - KZO-177 (provider health UI, existing): https://linear.app/kzokv/issue/KZO-177/
  - KZO-186 (splits + replay invariant 6): https://linear.app/kzokv/issue/KZO-186/
- **Frozen records:**
  - KZO-171 spike (locked decisions): `docs/004-notes/kzo-171/spike-202605021115-au-provider.md`
  - KZO-172 debate brief: `.worklog/scopes/kzo-172/debate-brief.md`
  - KZO-172 debate result: `.worklog/scopes/kzo-172/debate-result.md`
  - KZO-172 debate note (full transcript + 4 Mermaid diagrams): `.worklog/scopes/kzo-172/debate-note.md`
- **Repo rules:**
  - `.claude/rules/typed-transient-error-catch-audit.md` (REVISIT-D)
  - `.claude/rules/pgboss-composite-singleton-key.md`
  - `.claude/rules/replay-position-history-invariants.md`
  - `.claude/rules/fastify-eviction-lifecycle-pattern.md`
  - `.claude/rules/service-error-pattern.md` (REVISIT-C)
  - `.claude/rules/integration-test-persistence-direct.md`
  - `.claude/rules/code-review-before-pr.md`
  - `.claude/rules/full-test-suite.md`
  - `.claude/rules/e2e-shared-memory-bars-ticker-hygiene.md`
  - `.claude/rules/test-api-mapper-registration.md`
  - `.claude/rules/process-refactor-rename-verification.md`
  - `.claude/rules/phased-ticket-scope-completeness.md` (REVISIT-B)
  - `.claude/rules/agent-team-workflow.md`
- **Precedent files:**
  - `apps/api/src/services/market-data/providers/finmindUsStock.ts` (KZO-170 US precedent)
  - `apps/api/src/services/market-data/providers/finmind.ts` (TW)
  - `apps/api/src/services/market-data/providers/frankfurter.ts` (KZO-164 unauthenticated pattern)
  - `docs/004-notes/kzo-170/transition-202605022121-us-stock-ingestion.md`
  - `docs/004-notes/kzo-163/transition-202604251534-provider-registry.md`
