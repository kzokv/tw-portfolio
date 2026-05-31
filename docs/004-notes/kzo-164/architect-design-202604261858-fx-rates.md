---
slug: kzo-164
type: architect-design
created: 2026-04-26T18:58
tickets: [KZO-164]
frozen: true
required_reading:
  - docs/004-notes/kzo-164/scope-todo-202604261830-frankfurter-fx.md
  - docs/004-notes/kzo-163/transition-202604251534-provider-registry.md
---

# KZO-164 — Architect Design (Frankfurter FX Rate Ingestion)

> **Frozen.** This is the implementation contract for the Tier 2 Squad. Reference the linked scope-todo for ground truth — this doc adds **decomposition, ownership, test placement, invariant flow-down, and the wave plan** on top of the scope-todo.

## 1. Wave plan (Tier 2 Squad — parallel Phase 1+2)

| Wave | Phase | Teammates | Mode |
|------|-------|-----------|------|
| 1 | Phase 1+2 | fullstack-implementer, senior-qa | **Parallel** — both start at launch on the locked scope |
| 1 | Phase 3 | code-reviewer, validator | After both Phase 1+2 tasks complete (Architect / Dispatcher sends `[GO]`) |
| 1 | Phase 4 | self-fix by domain owner | Triage by Architect — Implementer fixes implementation/CR findings, QA fixes test/fixture findings |
| 2 | Wrap-up | technical-writer | Phase 8 docs + PR description draft |

**Convergence loop budget:** 3 iterations default; Architect may extend to 5 before hard-escalating per `escalation-rules.md`.

## 2. Slice/owner table

| # | Slice | Layers | Owner | Files | E2E coverage |
|---|---|---|---|---|---|
| 1 | DB schema migration | SQL | Implementer | `db/migrations/037_kzo164_fx_rates.sql` | N/A — schema only |
| 2 | Env + vitest config | TS | Implementer | `libs/config/src/env-schema.ts`, `.env.example`, `apps/api/vitest.config.ts` | N/A — config |
| 3 | FX provider types | TS | Implementer | `apps/api/src/services/market-data/types.ts` | N/A |
| 4 | FrankfurterFxRateProvider | TS | Implementer | `apps/api/src/services/market-data/providers/frankfurter.ts`, `…/providers/index.ts` | N/A |
| 5 | MockFrankfurterFxRateProvider | TS | Implementer | `apps/api/src/services/market-data/providers/mockFrankfurter.ts` | N/A |
| 6 | Registry | TS | Implementer | `apps/api/src/services/market-data/registry.ts` | N/A |
| 7 | Persistence interface | TS | Implementer | `apps/api/src/persistence/types.ts` | N/A |
| 8 | Postgres persistence | TS | Implementer | `apps/api/src/persistence/postgres.ts` | N/A |
| 9 | Memory persistence + reset helper | TS | Implementer | `apps/api/src/persistence/memory.ts` | N/A |
| 10 | deriveFetchWindow | TS | Implementer | `apps/api/src/services/market-data/deriveFetchWindow.ts` | N/A |
| 11 | Worker handler + registration | TS | Implementer | `apps/api/src/services/market-data/fxRefreshWorker.ts`, `…/registerFxRefreshWorker.ts` | N/A |
| 12 | pgBoss wiring + cron schedule | TS | Implementer | `apps/api/src/plugins/pgBoss.ts` | N/A |
| 13 | Admin route — refresh | TS | Implementer | `apps/api/src/routes/registerRoutes.ts` (admin section + `ADMIN_ROUTE_KEYS` set) | N/A — admin-only API |
| 14 | Admin route — freshness | TS | Implementer | `apps/api/src/routes/registerRoutes.ts` (admin section + `ADMIN_ROUTE_KEYS` set) | N/A — admin-only API |
| 15 | E2E seed route | TS | Implementer | `apps/api/src/routes/registerRoutes.ts` (`assertE2ESeedEnabled` block) | N/A — test-only |
| 16 | AAA endpoint + assistant + mapper | TS | Implementer | `libs/test-api/src/endpoints/FxRatesEndpoint.ts`, `libs/test-api/src/assistants/fxRates/{FxRatesApiArrange,Actions,Assert}.ts`, `libs/test-api/src/assistants/fxRates/index.ts`, `libs/test-api/src/config/mapper.ts` | N/A — test infra |
| 17 | Test tsconfig include update | JSON | Implementer | `apps/api/test/tsconfig.json` (add new integration + unit + http globs) | N/A |
| 18 | Unit tests — provider | TS | QA | `apps/api/test/unit/frankfurter-fx-rate-provider.test.ts`, `…/mock-frankfurter-fx-rate-provider.test.ts` | N/A |
| 19 | Unit tests — derive window + worker | TS | QA | `apps/api/test/unit/fx-refresh-derive-window.test.ts`, `…/fx-refresh-worker.test.ts` | N/A |
| 20 | Integration test — Postgres persistence + schema | TS | QA | `apps/api/test/integration/fx-rates-postgres.integration.test.ts` | N/A |
| 21 | HTTP/AAA spec — admin refresh | TS | QA | `apps/api/test/http/specs/admin-fx-rates-refresh-aaa.http.spec.ts` | N/A — HTTP only |
| 22 | HTTP/AAA spec — admin freshness | TS | QA | `apps/api/test/http/specs/admin-fx-rates-freshness-aaa.http.spec.ts` | N/A — HTTP only |
| 23 | Phase 8 docs (Wave 2) | MD | Tech Writer | `docs/004-notes/kzo-164/transition-202604261830-fx-rates.md`, `docs/market-data-platform.md`, `docs/002-operations/runbook.md`, `.worklog/team/pr-description-draft.md` | N/A |

**E2E gate:** Every row says `N/A` because the scope-todo (locked Q10) explicitly excludes UI/E2E coverage — admin routes have no web UI in v1, KZO-174 ships the disclaimer. The convergence loop's E2E gate is satisfied trivially.

## 3. Test placement decisions

Per `test-placement-persistence-backend.md` and `integration-test-persistence-direct.md`:

- **Unit (`apps/api/test/unit/`)** — pure logic, no DB. Provider tests use mocked global `fetch`; mock provider tests use the deterministic mock; `deriveFetchWindow` is pure; the worker handler runs against `MemoryPersistence` + `MockFrankfurterFxRateProvider`.
- **Integration (`apps/api/test/integration/`)** — Postgres-only behavior (schema CHECKs, ON CONFLICT, NUMERIC precision, MAX(date) semantics). Use the canonical `describePostgres` + `applyNumberedMigrations` pattern from `anonymous-share-token-purge.integration.test.ts`. **Do NOT use `buildApp({ persistenceBackend: "postgres" })`** — instantiate `PostgresPersistence` directly.
- **HTTP (`apps/api/test/http/specs/`)** — exercises the wired admin routes through Playwright's `request` fixture. Auth gating, demo-blocked, validation, queue-down 503, singleton dedup, audit-log emission, response shape.

Memory backend gaps that justify Postgres-only assertions:
- Schema CHECK violations (negative rate, lowercase currency, self-pair) only fire in Postgres.
- `NUMERIC(20, 8)` precision round-trip (e.g., `0.00071`) only matters in Postgres.
- MAX(date) ordering semantics on real columns vs. JS `Math.max(...dates)` divergence.

## 4. Phase 1.5 invariants (flow-down to teammates)

Both Implementer and QA receive the full invariant list in their task descriptions. **Tagged ownership:**

| # | Invariant | Implementer must... | QA must... |
|---|---|---|---|
| 1 | Self-pair filter (`r.quote !== r.base`) | Filter in `fxRefreshWorker.ts` BEFORE `upsertFxRates` call | Add a worker test asserting the filter (mock returns a self-pair row → upsert called without it) |
| 2 | Audit log on manual trigger only | Emit `admin.fx_rates.refresh` audit entry ONLY in `POST /admin/fx-rates/refresh`; cron path emits no audit | HTTP spec: assert audit entry on manual trigger; integration spec: assert no audit entry from cron-style direct worker invocation |
| 3 | `source` field column-aligned, no fallback | `upsertFxRates` reads `rate.source` directly — NO `?? 'frankfurter'` | Integration test asserts column value matches provider's stamp |
| 4 | `STORED_QUOTES = ['TWD','USD','AUD'] as const` hardcoded | Module-top constant in `fxRefreshWorker.ts` | Worker test asserts response filtered to STORED_QUOTES |
| 5 | `today` resolves to UTC | Helper `today_utc()` returns `new Date().toISOString().slice(0, 10)` | Tests use a mock clock or fixed dates — no `new Date()` reliance in assertions |
| 6 | Upsert uses `response.date`, not `today_utc()` | Pass through provider's per-row `date` field unchanged | Test using a mock that returns yesterday's date confirms upsert keys on yesterday |
| 7 | Worker errors bubble to pg-boss retry | No special catch — let `Error` propagate; pg-boss policy `stately` + `retryLimit: 3` handles | Worker test: throw from provider → handler re-throws (pg-boss retry surface) |
| 8 | Postgres FK seed admin user | When testing `POST /admin/fx-rates/refresh` integration paths, seed real admin via `persistence.resolveOrCreateUser` first; never hardcode `actorUserId` strings | HTTP spec already auth-gates via session cookie (no FK risk); integration spec MUST seed via `resolveOrCreateUser` |

## 5. Cross-cutting rules to honor (incident-learned)

Cited verbatim in teammate briefings:

- **`migration-strategy.md`** — Append a NEW migration `037_kzo164_fx_rates.sql`; do NOT modify any applied migration.
- **`service-error-pattern.md`** — Throw via `routeError(503, "queue_unavailable", …)` when `app.boss === null`; the 503-vs-429 distinction does NOT apply here (Frankfurter has no rate limit; no `RateLimitedError` thrown).
- **`integration-test-persistence-direct.md`** — Postgres integration test MUST instantiate `PostgresPersistence` directly + seed real users via `resolveOrCreateUser` for any audit_log path.
- **`test-api-mapper-registration.md`** — `FxRatesEndpoint` MUST be registered in `libs/test-api/src/config/mapper.ts`; runtime crash without it.
- **`e2e-seed-vs-reset-guards.md`** — `POST /__e2e/seed-fx-rates` uses `assertE2ESeedEnabled()`, NOT `assertE2EResetEnabled()`.
- **`vitest-config-patterns.md`** — Module-level `STORED_QUOTES` is a constant (no test reset needed); registry is module-level too — no reset helper necessary.
- **`interface-caller-verification.md`** — Before claiming Phase 1+2 complete, grep `FxRateProvider`, `FxRate`, `fxRate`, `upsertFxRates`, `getLatestFxRateDate`, `getFxRateFreshness`, `_resetFxRates` and confirm at least one caller per public symbol.
- **`code-review-before-pr.md`** — Add the new test files to `apps/api/test/tsconfig.json` `include` (specifically: `integration/fx-rates-postgres.integration.test.ts` and `unit/{frankfurter-fx-rate-provider,mock-frankfurter-fx-rate-provider,fx-refresh-derive-window,fx-refresh-worker}.test.ts`). HTTP specs already covered by `http/**/*.ts` glob.
- **`commit-format.md`** — Commit message at human-handles-commit time will be `feat(api,db): KZO-164: …` per scope-todo §10.1.
- **`pr-bound-docs-review-compliance.md`** — Wave 2 PR description draft must include `## Problem`, `## Solution`, `## Testing` (with `Evidence:` block per suite), `## Risk/Rollback`. Architect briefs the Code Reviewer on this in Wave 2.
- **`agent-team-workflow.md`** — Tier 2 parallel Phase 1+2; validator [GO] gate; verification gates are contracts; brief precedent files in BOTH Implementer and QA tasks.
- **`team-phase-3-triage.md`** — Pure-docs findings during Phase 3 → defer to Wave 2 (Tech Writer); implementation/test findings → Phase 4 self-fix.
- **`phased-ticket-scope-completeness.md`** — Standalone-deployability check: KZO-164 is fully functional independently. The cron triggers automatically on first deploy; admin routes are accessible; no UI is needed for v1. KZO-174 follows but does not block.

## 6. Scope precedents — name in BOTH Implementer and QA briefs

Per `agent-team-workflow.md` "task description amplification":

- `apps/api/src/services/market-data/registerCatalogSyncWorker.ts` — worker handler + registration shape (`createCatalogSyncHandler`, `registerCatalogSyncWorker`, `JobWithMetadata<…>[]` argument typing, queue options spread of `DEFAULT_MARKET_DATA_QUEUE_OPTIONS` + `policy: "singleton"`)
- `apps/api/src/services/market-data/providers/mockFinmind.ts` — mock provider's `calls: Array<{ method: string; … }>` field convention
- `apps/api/src/services/market-data/providers/finmind.ts` — real provider's `fetch` + URL params + error mapping (without rate-limit branching since Frankfurter has none)
- `apps/api/src/routes/registerRoutes.ts:3609-3686` — `/backfill/repair` route (zod body with `superRefine`, demo-block, `routeError(503, "queue_unavailable", …)`, `boss.send` shape)
- `apps/api/src/routes/registerRoutes.ts:402-417` — `ADMIN_ROUTE_KEYS` set (must add `"POST /admin/fx-rates/refresh"` and `"GET /admin/fx-rates/freshness"`)
- `apps/api/src/services/market-data/upserts.ts:3-44` — `unnest`-arrays bulk upsert pattern (template for `upsertFxRates` Postgres impl)
- `apps/api/src/services/market-data/registry.ts` — `MarketDataRegistry` interface + `buildMarketDataRegistry(env)` (must add `fxRate: FxRateProvider` field; mock-vs-real branch on `env.FX_PROVIDER_MOCK`)
- `apps/api/src/plugins/pgBoss.ts` — worker registration + `boss.schedule` pattern
- `libs/test-api/src/endpoints/NotificationsEndpoint.ts` — endpoint class shape (BaseEndpoint, `apiUrl`, optional headers)
- `libs/test-api/src/assistants/notifications/{NotificationsApiActions,Arrange,Assert}.ts` + `index.ts` — assistant shape (Step decorator, `_instance` declare narrowing, factory)
- `libs/test-api/src/config/mapper.ts` — registration call site (`apiAssistantRegistry.register(FxRatesEndpoint, fxRatesApiAssistantFactory)`)
- `apps/api/test/integration/anonymous-share-token-purge.integration.test.ts` — canonical Postgres integration test scaffold (`describePostgres`, `applyNumberedMigrations`, `resetDatabase`, FK seeding via `resolveOrCreateUser`)
- `apps/api/test/http/specs/backfill-repair-aaa.http.spec.ts` — HTTP/AAA spec shape (admin auth, queue-down 503, audit-log assertion if applicable)

## 7. Convergence-loop exit criteria

The Architect declares Phase 4 complete (and exits to Wrap-up) when ALL of:

1. Validator returns `[DONE:CLEAN]` — all 8 suites green
2. Code Reviewer returns `[DONE:CLEAN]` OR all P0/P1 findings addressed (LOW/INFO can defer to Phase 4 self-fix or Wave 2)
3. `state.json.exit_check` shows `tests_green=true`, `findings_addressed=true`, `no_regressions=true`
4. Caller-verification grep passes for every new public symbol
5. `FxRatesEndpoint` is in `mapper.ts`
6. New test files reach a tsconfig `include` (verify by running `npx tsc --noEmit -p apps/api/test` and confirming the new files appear in errors if introduced — i.e., they're scoped)

## 8. Wave 2 plan

Wave 2 is single-teammate (technical-writer), doc-only, with a Code Reviewer pass on the output (Tier 2 standard).

Tech Writer task description:
1. Write `docs/004-notes/kzo-164/transition-202604261830-fx-rates.md` mirroring KZO-163's transition shape (sections enumerated in scope-todo §8.1)
2. Add FX-rates subsection to `docs/market-data-platform.md` (provider, schema, refresh cadence, manual trigger)
3. Add operational sections to `docs/002-operations/runbook.md` (daily refresh, manual trigger, freshness check, 30-day auto-seed semantic). **Grep first** for any "future candidate" / "follow-up" notes about FX rates and replace in-place per `doc-stale-forward-notes.md`.
4. Write `.worklog/team/pr-description-draft.md` with structural compliance to `git-pr-flow.md §3-4`: `## Problem`, `## Solution`, `## Testing` (with `Evidence:` block per suite), `## Risk/Rollback`. Architect briefs the Code Reviewer on this in the Wave 2 review pass per `pr-bound-docs-review-compliance.md`.

## 9. Out of scope (do NOT pull in)

Per scope-todo "Out of scope" table — re-iterated for Implementer and QA briefings:

- FinMind FX provider, trade-events historical walk, UI/web changes, CBC pinning, per-pair routing, alarm wiring, `/market-data/fx-rate?...` read endpoint, `currencies` reference table, `FxRate` promotion to `libs/shared-types/`, ADR.

If a teammate is tempted to add anything in this list "while we're here," they MUST send `[QUESTION]` to the Architect first — it is a scope-creep escalation.
