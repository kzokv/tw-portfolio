---
slug: kzo-164
source: scope-grill
created: 2026-04-26
tickets: [KZO-164]
required_reading: []
superseded_by: null
---

# Todo: KZO-164 — Frankfurter FX rate ingestion

> **For agents starting a fresh session:** read this file in full before implementation. The Phase 1.5 invariants near the bottom are load-bearing — they cover the gaps that surfaced during scope-grill but didn't merit their own decision.

This is the implementation contract derived from the 2026-04-26 `/scope-grill` session for KZO-164. Scope-grill **inverted the original ticket's primary/fallback framing**: Frankfurter v2 is the sole FX provider; FinMind FX is dropped. Read the **"Major scope deltas from the ticket"** section before assuming any wording from the ticket description still applies.

---

## Major scope deltas from the ticket

The original Linear ticket text is partially superseded. Honor this todo over the ticket on conflict:

1. **Single provider: Frankfurter v2 default-blend.** Empirically verified: Frankfurter v2 covers TWD natively (start 1981-01-02), supports `?base=TWD`, supports time-series. Routes through Central Bank of Taiwan (CBC) when fresh, falls back across 53 other central banks. No FinMind FX implementation. No fallback orchestration. The ticket's "fallback to Frankfurter for AUD" plan is moot — Frankfurter handles all 3 pairs natively.
2. **No `RateLimiter` for FX.** Frankfurter has no quota — empirically verified at 400 requests in <60s with 0× HTTP 429. Provider's `reserveCapacity(n)` is a no-op.
3. **Historical walk delegated to KZO-174.** The ticket text "fills history back to user's earliest cross-currency trade date" is removed. KZO-164 does the **30-day initial seed** automatically on first cron run; KZO-174 owns the trade-events walk + recompute + UI disclaimer.
4. **`FxRateProvider` interface lives in `apps/api/src/services/market-data/types.ts`** (not a separate file or library) — sibling of `MarketDataProvider`/`InstrumentCatalogProvider`. Per-base signature, not per-pair.
5. **Singleton field on the registry**, not a `Map<MarketCode, FxRateProvider>`. There is one FX provider for the whole app; the per-market map shape would be a degenerate single-entry map.

---

## Phase 1 — Foundation (schema, env, types)

- [ ] **1.1 Migration** — `db/migrations/037_kzo164_fx_rates.sql`. New table `market_data.fx_rates` with columns `date DATE NOT NULL`, `base_currency CHAR(3)`, `quote_currency CHAR(3)`, `rate NUMERIC(20, 8) NOT NULL`, `source TEXT NOT NULL`, `ingested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`. PK `(date, base_currency, quote_currency)`.
- [ ] **1.2 Schema CHECKs** — `rate > 0`, `base_currency ~ '^[A-Z]{3}$'`, `quote_currency ~ '^[A-Z]{3}$'`, `base_currency <> quote_currency`.
- [ ] **1.3 Index** — `CREATE INDEX IF NOT EXISTS idx_fx_rates_pair_date_desc ON market_data.fx_rates(base_currency, quote_currency, date DESC)`. Required for snapshot generation's "latest rate for pair X/Y" lookups in KZO-165.
- [ ] **1.4 Env additions** — `libs/config/src/env-schema.ts`:
      ```
      FRANKFURTER_BASE_URL: z.string().url().default("https://api.frankfurter.dev/v2"),
      FX_PROVIDER_MOCK:     z.coerce.boolean().default(false),
      ```
- [ ] **1.5 `.env.example`** — add a new `## FX rates (KZO-164)` block documenting both vars; mirror the formatting of the KZO-163 FinMind block.
- [ ] **1.6 Vitest config** — `apps/api/vitest.config.ts` test `env` block: add `FX_PROVIDER_MOCK: "true"`.
- [ ] **1.7 Types** — extend `apps/api/src/services/market-data/types.ts` with:
      ```ts
      export interface FxRate {
        date: string;
        baseCurrency: string;
        quoteCurrency: string;
        rate: number;
        source: string;
      }
      export interface FxRateProvider {
        fetchRatesForBase(
          base: string,
          fromDate: string,
          toDate: string,
          quotes?: readonly string[],
        ): Promise<FxRate[]>;
        reserveCapacity(n: number): void;
      }
      export interface FxRefreshJobData {
        trigger: 'cron' | 'manual';
        startDate: string;
        endDate: string;
        bases: readonly ('TWD' | 'USD' | 'AUD')[];
      }
      ```

## Phase 2 — Provider implementation

- [ ] **2.1 FrankfurterFxRateProvider** — `apps/api/src/services/market-data/providers/frankfurter.ts`. Implements `FxRateProvider`. Constructor takes `{ baseUrl: string }`. `fetchRatesForBase` builds `GET ${baseUrl}/rates?base={base}&from={fromDate}&to={toDate}`, parses array `[{date, base, quote, rate}, ...]`, optionally filters to `quotes`, stamps each result with `source: 'frankfurter'`. `reserveCapacity` is a no-op. Map non-2xx and JSON-parse errors to plain `Error` (no typed `RateLimitedError`).
- [ ] **2.2 MockFrankfurterFxRateProvider** — `apps/api/src/services/market-data/providers/mockFrankfurter.ts`. Implements `FxRateProvider`. Tracks `calls: Array<{ method: string; args: unknown[] }>` (matching `MockFinMindMarketDataProvider` precedent). `fetchRatesForBase` returns deterministic rates (e.g., `USD/TWD=31.5`, `USD/AUD=1.4`, derived inverses) for each date in `[fromDate, toDate]`. Stamps `source: 'frankfurter'`.
- [ ] **2.3 Provider barrel** — extend `apps/api/src/services/market-data/providers/index.ts` to export both new classes alongside the existing FinMind exports.
- [ ] **2.4 Registry update** — `apps/api/src/services/market-data/registry.ts`. Add `fxRate: FxRateProvider` field to `MarketDataRegistry`. In `buildMarketDataRegistry(env)`:
      ```ts
      const fxRate: FxRateProvider = env.FX_PROVIDER_MOCK
        ? new MockFrankfurterFxRateProvider()
        : new FrankfurterFxRateProvider({ baseUrl: env.FRANKFURTER_BASE_URL });
      return { marketData, catalog, fxRate };
      ```

## Phase 3 — Persistence

- [ ] **3.1 Persistence interface** — `apps/api/src/persistence/types.ts`. Add three methods:
      ```ts
      upsertFxRates(rates: ReadonlyArray<FxRate>): Promise<number>;
      getLatestFxRateDate(): Promise<string | null>;
      getFxRateFreshness(): Promise<Array<{ baseCurrency: string; quoteCurrency: string; latestDate: string }>>;
      ```
- [ ] **3.2 PostgresPersistence** — implement all 3 in `apps/api/src/persistence/postgres.ts`. `upsertFxRates` uses bulk insert via `unnest` arrays + `ON CONFLICT (date, base_currency, quote_currency) DO UPDATE SET rate = EXCLUDED.rate, source = EXCLUDED.source, ingested_at = EXCLUDED.ingested_at`, returns `rowCount`. `getLatestFxRateDate` is `SELECT MAX(date) FROM market_data.fx_rates`. `getFxRateFreshness` is `SELECT base_currency, quote_currency, MAX(date) FROM market_data.fx_rates GROUP BY 1, 2 ORDER BY 1, 2`.
- [ ] **3.3 MemoryPersistence** — implement all 3 in `apps/api/src/persistence/memory.ts` via `Map<dateKey, FxRate>` (key: `${date}:${base}:${quote}`).
- [ ] **3.4 `_resetFxRates()` helper** — export from `MemoryPersistence` alongside `_resetDemoRateBuckets`. Clears the map. Tests call in `beforeEach`.

## Phase 4 — Worker (cron + handler)

- [ ] **4.1 `deriveFetchWindow`** — `apps/api/src/services/market-data/deriveFetchWindow.ts`. Pure function: input `(jobData: FxRefreshJobData, persistence)`, output `{ startDate, endDate }`. Logic per locked Q7:
      - `manual` trigger → return `jobData.{startDate, endDate}` verbatim, no autodetection
      - `cron` trigger → query `getLatestFxRateDate()`. Empty → return last-30-day window. Otherwise → return `(MAX(date)+1, today)`, capped at 30 days backward.
- [ ] **4.2 Worker handler** — `apps/api/src/services/market-data/fxRefreshWorker.ts`. Export `FX_REFRESH_QUEUE = "fx-refresh"`, `FX_REFRESH_CRON = "0 22 * * *"`, `createFxRefreshHandler(deps)`. Handler:
      1. Compute window via `deriveFetchWindow`
      2. For each base in `jobData.bases ?? ['TWD','USD','AUD']`: call `fxProvider.fetchRatesForBase(base, window.startDate, window.endDate, STORED_QUOTES)`
      3. Filter response: `r => STORED_QUOTES.includes(r.quote) && r.quote !== r.base` (Phase 1.5 invariant — schema CHECK rejects self-pairs)
      4. Concatenate and call `persistence.upsertFxRates(...)`
      5. Log `fx_refresh_completed { trigger, dates_covered, rows_upserted, durationMs }` on success
      6. Catch errors, log `fx_refresh_failed { error, trigger }`, re-throw to let pg-boss retry
- [ ] **4.3 Worker registration** — `apps/api/src/services/market-data/registerFxRefreshWorker.ts`. Mirror `registerCatalogSyncWorker.ts` shape. Queue options: `{ ...DEFAULT_MARKET_DATA_QUEUE_OPTIONS, policy: "singleton" } as const`.
- [ ] **4.4 pgBoss plugin** — `apps/api/src/plugins/pgBoss.ts`. After existing catalog-sync registration, add: `await registerFxRefreshWorker(app, boss, fxDeps)` and `await boss.schedule(FX_REFRESH_QUEUE, FX_REFRESH_CRON, {})`. Construct `fxDeps` from `app.marketDataRegistry.fxRate` + `app.persistence` + `app.log` + `boss`.
- [ ] **4.5 STORED_QUOTES constant** — declare `const STORED_QUOTES = ['TWD','USD','AUD'] as const` at module top. Phase 1.5 invariant: hardcoded for v1; KZO-170/KZO-171 will expand when cross-currency tickers ship.

## Phase 5 — Routes

- [ ] **5.1 `POST /admin/fx-rates/refresh`** — in `apps/api/src/routes/registerRoutes.ts` admin section. Pattern: mirror `/backfill/repair` (lines 3609–3686).
      - Auth: admin-only; demo blocked
      - Body: `{ startDate?: isoDateSchema, endDate?: isoDateSchema, bases?: z.array(z.enum(['TWD','USD','AUD'])).min(1) }` with `superRefine` ensuring `startDate <= endDate`
      - Defaults: `startDate = endDate = today_utc()`, `bases = ['TWD','USD','AUD']`
      - Send to `FX_REFRESH_QUEUE` with `{ trigger: 'manual', ... }` payload, `singletonKey: 'fx-refresh'`
      - Response: `{ status: 'queued', jobId }` on success; `{ status: 'skipped_existing_job', reason }` when `boss.send` returns `null`
      - 503 via `routeError(503, 'queue_unavailable', ...)` when `app.boss === null`
      - Audit log: `actorUserId: <admin session user>`, `action: 'admin.fx_rates.refresh'`, payload includes `startDate, endDate, bases`
- [ ] **5.2 `GET /admin/fx-rates/freshness`** — admin-only. Returns `{ pairs: [{ baseCurrency, quoteCurrency, latestDate, ageInDays }], queriedAt }`. `ageInDays` = `daysBetween(latestDate, today)`. No audit log emission (read-only).
- [ ] **5.3 `POST /__e2e/seed-fx-rates`** — gated by `assertE2ESeedEnabled()` (NOT `assertE2EResetEnabled` per `e2e-seed-vs-reset-guards.md`). Body: `{ rates: FxRate[] }`. Calls `persistence.upsertFxRates(rates)`. Returns 200 with `{ inserted: N }`.

## Phase 6 — AAA test infrastructure

- [ ] **6.1 Endpoint class** — `libs/test-api/src/endpoints/fxRates.ts`. Mirror `NotificationsEndpoint` (or whichever is the simplest existing precedent).
- [ ] **6.2 Assistant class** — `libs/test-api/src/assistants/fxRates.ts`. Methods for `manualRefresh(...)`, `getFreshness()`, `seedFxRates(...)`.
- [ ] **6.3 Mapper registration** — `libs/test-api/src/config/mapper.ts`. **Mandatory** per `test-api-mapper-registration.md` — runtime crash without it. Verify with `grep -r "FxRatesEndpoint" libs/test-api/src/config/mapper.ts`.

## Phase 7 — Tests

### Unit (`apps/api/test/unit/`)

- [ ] **7.1 `frankfurter-fx-rate-provider.test.ts`** — provider against mocked global `fetch`. Verify URL construction, response parsing, error handling for 4xx/5xx/non-JSON, source stamping.
- [ ] **7.2 `mock-frankfurter-fx-rate-provider.test.ts`** — deterministic mock contract. Verify `calls` array, returned shape, date range expansion.
- [ ] **7.3 `fx-refresh-derive-window.test.ts`** — pure-function tests for the gap-detection logic. Cases: empty table → 30-day seed; gap of 3 days → fetches 3 days; gap of 90 days → caps at 30 days backward; manual trigger → verbatim dates; manual trigger with no autodetection.
- [ ] **7.4 `fx-refresh-worker.test.ts`** — worker handler against `MemoryPersistence` + `MockFrankfurterFxRateProvider`. Verify: per-base iteration, self-pair filter, upsert call shape, structured log emission, error path re-throws.

### Integration (`apps/api/test/integration/`)

- [ ] **7.5 `fx-rates-postgres.integration.test.ts`** — Postgres-backed. Per `integration-test-persistence-direct.md`: instantiate `PostgresPersistence` directly with `applyNumberedMigrations` pattern. Verify:
      - Schema CHECKs fire (negative rate, lowercase currency, self-pair) → constraint violation
      - `ON CONFLICT (date, base, quote) DO UPDATE` overwrites correctly
      - `NUMERIC(20, 8)` precision round-trips for low-FX-rate values like `0.00071`
      - `getLatestFxRateDate()` returns null on empty table, MAX(date) on populated
      - `getFxRateFreshness()` returns one row per pair, ordered consistently

### HTTP/AAA (`apps/api/test/http/specs/`)

- [ ] **7.6 `admin-fx-rates-refresh-aaa.http.spec.ts`** — admin auth gates non-admin requests; demo blocked; validation rejects `startDate > endDate`, empty `bases`, invalid currency codes; first call returns `queued`; concurrent second call (within singleton lifetime) returns `skipped_existing_job`; queue-down returns 503; audit log entry written (verify via `getAuditLog` reader if exposed, otherwise via integration spec).
- [ ] **7.7 `admin-fx-rates-freshness-aaa.http.spec.ts`** — admin auth gates non-admin; response shape `{ pairs: [...], queriedAt }`; `ageInDays` calculated correctly against seeded test data.

## Phase 8 — Documentation

- [ ] **8.1 Transition note** — `docs/004-notes/kzo-164/transition-202604261830-fx-rates.md` (frozen). Mirror KZO-163's transition note structure. Sections:
      - Major scope deltas from the original ticket (Frankfurter primary, no FinMind FX, no rate limiter)
      - `FxRateProvider` interface (per-base, no rate limit)
      - Registry shape (singleton field, not Map)
      - Schema and indices
      - Worker design (cron + manual trigger + self-healing 30-day cap)
      - Frankfurter v2 default blend mechanics
      - Env additions
      - `source` field naming divergence from KZO-163's `sourceId` (DB-column-aligned, no fallback)
- [ ] **8.2 Evergreen — `docs/market-data-platform.md`** — add a new "FX rates" subsection at the end of the providers/data discussion. Cover: provider choice, schema, refresh cadence, manual trigger.
- [ ] **8.3 Evergreen — `docs/002-operations/runbook.md`** — add operational sections:
      - Daily refresh: cron at 22:00 UTC, queue `fx-refresh`, expected 3 HTTP calls per run, ~6 rows upserted
      - Manual trigger: `POST /admin/fx-rates/refresh` with body shape, dedup behavior
      - Freshness check: `GET /admin/fx-rates/freshness` interpretation, what `ageInDays > 3` likely means (Frankfurter outage or skipped cron runs)
      - 30-day auto-seed-on-empty-table behavior on first deploy
- [ ] **8.4 No ADR.** Reasoning lives in this scope-todo + transition note. Codereviewers should not request an ADR.

## Phase 9 — Pre-PR checks

- [ ] **9.1 Full test suite** — run `npx eslint . --max-warnings=0 && npm run typecheck && npm run test:all:full` per `full-test-suite.md`. All 8 suites green.
- [ ] **9.2 Typecheck scope** — verify all 7 new test files (`apps/api/test/unit/*` and `apps/api/test/integration/*` and `apps/api/test/http/specs/*`) are reached by their respective tsconfig `include`. Per `code-review-before-pr.md` rule.
- [ ] **9.3 Caller verification** — `grep -r "fxRate\|FxRateProvider\|FxRate\b" apps/ libs/ --include="*.ts"` to confirm every new public symbol has at least one caller. Per `interface-caller-verification.md`.
- [ ] **9.4 AAA mapper registration** — `grep "FxRatesEndpoint" libs/test-api/src/config/mapper.ts` returns a match. Mandatory per `test-api-mapper-registration.md`.
- [ ] **9.5 Code review** — run `/code-reviewer` per `code-review-before-pr.md`. Expected output at `docs/004-notes/kzo-164/review-{datetime}-fx-rates.md`.
- [ ] **9.6 Run `/aaa`** — to add or update HTTP/AAA specs covering the two admin routes. (E2E not in scope per locked Q10.)

## Phase 10 — PR + write-back

- [ ] **10.1 Commit format** — per `commit-format.md`: `feat(api,db): KZO-164: Frankfurter FX rates schema, provider, daily refresh, manual trigger`.
- [ ] **10.2 Single PR** per locked Q12 / KZO-163 precedent.
- [ ] **10.3 PR description** — call out the Frankfurter-only single-provider decision (departure from ticket text) and link this scope-todo + transition note.
- [ ] **10.4 Linear write-back** — already done at scope-lock by the `/scope-grill` skill (this file's creation step). No extra action.

---

## Phase 1.5 invariants (load-bearing)

These are gaps surfaced during scope-grill that didn't merit their own decision but MUST be honored by the implementer:

1. **Self-pair filter in worker.** Schema `CHECK (base_currency <> quote_currency)` will reject a self-pair row. Worker MUST filter `r.quote !== r.base` before calling `upsertFxRates`. Without this, any Frankfurter response that includes the requested base in the quote list will crash the entire upsert batch.
2. **Audit log on manual trigger only.** Cron runs do NOT write to audit_log (precedent: catalog-sync). Only `POST /admin/fx-rates/refresh` emits an entry.
3. **`source` field is column-aligned, no fallback.** The DB column is `NOT NULL` with no default; the provider always stamps the field; `upsertFxRates` reads it directly with no `?? 'frankfurter'` fallback. Diverges intentionally from KZO-163's `sourceId` pattern.
4. **`STORED_QUOTES = ['TWD','USD','AUD'] as const` is hardcoded** at module top in `fxRefreshWorker.ts`. KZO-170 (US) and KZO-171 (AU) expand this when cross-currency tickers ship.
5. **`today` resolves to UTC.** Use a `today_utc()` helper or `new Date().toISOString().slice(0, 10)`. Cron at 22:00 UTC means CBC/RBA/ECB have published by query time.
6. **Upsert uses `response.date`, not `today_utc()`.** Frankfurter forward-fills weekends; trusting the response date prevents spurious "Sunday FX rate" rows.
7. **Worker error handling** — non-rate-limit errors (HTTP 5xx, network timeout, JSON parse, schema validation) bubble to `pg-boss` retry per `DEFAULT_MARKET_DATA_QUEUE_OPTIONS` (3 retries, exp backoff). No special handling needed.
8. **Audit_log FK in Postgres** — when adding the integration test for the manual-trigger route, **seed a real admin user** via `persistence.resolveOrCreateUser(...)` before invoking the route. Hardcoded string actorUserIds will fail FK validation per `integration-test-persistence-direct.md`.

---

## Out of scope (explicit)

| Item | Why |
|---|---|
| FinMind FX provider | Frankfurter v2 covers all 3 pairs natively; FinMind would only burn the shared 600/hr budget |
| Trade-events historical walk | KZO-174's scope; clarified at write-back |
| UI / web-app changes (banner, dashboard tile, disclaimer) | KZO-174 ships disclaimer; admin UI for freshness is a v2 ticket |
| CBC pinning (`?providers=CBC`) | Default blend is more reliable (CBC has 18 publishes_missed days on record); future ticket if accounting needs canonicality |
| Per-pair routing (`Map<pair, FxRateProvider>`) | Single-provider doesn't need it; future composition via wrapper if multi-provider |
| Alarm / pager wiring on staleness thresholds | Operational concern, separate ticket |
| `/market-data/fx-rate?...` read endpoint | Snapshot generation in KZO-165 reads from persistence directly |
| `currencies` reference table | Regex CHECK is the sole validation in v1 |
| Promotion of `FxRate` to `libs/shared-types/` | Defers to KZO-165 with real consumer (per `shared-types-barrel-turbopack.md` rule) |
| ADR | Reasoning captured in transition note + this scope-todo |

---

## References

- Linear ticket: [KZO-164](https://linear.app/kzokv/issue/KZO-164)
- Predecessor: [KZO-163](https://linear.app/kzokv/issue/KZO-163) — provider registry refactor (PR #143, merged)
- Downstream: [KZO-165](https://linear.app/kzokv/issue/KZO-165) — snapshot schema migration; [KZO-174](https://linear.app/kzokv/issue/KZO-174) — historical FX backfill + UI disclaimer; [KZO-170](https://linear.app/kzokv/issue/KZO-170) — US market plugin
- KZO-163 transition note (pattern reference): `docs/004-notes/kzo-163/transition-202604251534-provider-registry.md`
- KZO-163 scope-todo (pattern reference): `docs/004-notes/kzo-163/scope-todo-202604251830-provider-registry.md`
- Frankfurter v2 docs: https://frankfurter.dev (verified TWD coverage from 1981-01-02; default blend across 54 central banks; no quotas)
