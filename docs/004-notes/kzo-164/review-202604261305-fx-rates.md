---
slug: kzo-164
type: code-review
created: 2026-04-26T13:05
tickets: [KZO-164]
frozen: true
required_reading:
  - docs/004-notes/kzo-164/scope-todo-202604261830-frankfurter-fx.md
  - docs/004-notes/kzo-164/architect-design-202604261858-fx-rates.md
  - docs/004-notes/kzo-164/transition-202604261830-fx-rates.md
---

# KZO-164 — Pre-PR Code Review (Frankfurter FX Rate Ingestion)

**Verdict:** Approve with suggestions. No blockers; 4 MEDIUM and 4 LOW items below should be addressed or explicitly deferred before opening the PR.

**Scope reviewed:** 20 modified files + 16 new files (~480 net insertions tracked + new files). Coverage spans schema migration, env, types, providers, registry, persistence, worker, admin/E2E routes, AAA test infra, unit/integration/HTTP tests, and docs.

**Frame of reference:** scope-todo locked invariants (Phase 1.5 #1–#8), architect design § 4-5 cross-cutting rules, KZO-163 precedents (provider registry, route shape), and the project's `.claude/rules/` corpus.

---

## Suite Health (independent verification not yet run)

This review does not assert "all 8 suites green" — that is Phase 9.1 / `full-test-suite.md` and must be the explicit gate before PR open. Findings below were derived by reading the diff against the locked spec.

---

## Findings by severity

### CRITICAL — none

### HIGH — none

### MEDIUM

#### M1. HTTP/AAA freshness tests rely on serial execution with no per-test FX state reset

`apps/api/test/http/specs/admin-fx-rates-freshness-aaa.http.spec.ts` seeds FX rates across 5 tests but never resets state between them. The first non-auth test asserts an **empty** `pairs` array:

```ts
test("[shape]: empty DB returns { pairs: [], queriedAt }", async ({ ... }) => {
  ...
  await fxRatesApi.assert.mxAssertEqual(body.pairs.length, 0, "pairs.length");
});
```

Today this passes only because:
- `apps/api/test/http/playwright.config.ts:18` pins `workers: 1` (serial)
- The `[auth]` test runs before `[shape]: empty DB` and seeds nothing
- The sibling `admin-fx-rates-refresh-aaa.http.spec.ts` returns 503 in memory mode without seeding

The scope-todo §3.4 calls out the intended fix: "`_resetFxRates()` helper — export from `MemoryPersistence` alongside `_resetDemoRateBuckets`. Clears the map. Tests call in `beforeEach`." The helper is implemented (`apps/api/src/persistence/memory.ts:1494`) but no test calls it. The unit-test mock at `apps/api/test/unit/fx-refresh-worker.test.ts:94` registers `_resetFxRates: vi.fn()` but the worker never invokes it.

**Real risk:** anyone reordering tests, adding a test before `[shape]: empty DB`, raising `workers > 1`, or shard-running creates silent flakes. The fragility is not visible in the green-suite signal.

**Suggested fix:** add a `POST /__e2e/reset-fx-rates` endpoint (gated by `assertE2ESeedEnabled()` per `e2e-seed-vs-reset-guards.md` — additive reset is fine for non-destructive memory clear) and call it in a `beforeEach` in both HTTP/AAA spec files. Keep `_resetFxRates` exported as the in-process callable for any future unit-test consumer.

**File pointers:**
- `apps/api/src/persistence/memory.ts:1494` — `_resetFxRates` defined, no callers
- `apps/api/test/http/specs/admin-fx-rates-freshness-aaa.http.spec.ts:63` — empty-DB test
- `apps/api/test/http/specs/admin-fx-rates-freshness-aaa.http.spec.ts:96-103, 126-133, 165-171, 200-206, 235-242` — five `seedFxRates` calls accumulate state

---

#### M2. Defense-in-depth asymmetry: `POST /admin/fx-rates/refresh` is not in `ADMIN_ROUTE_KEYS`

`apps/api/src/routes/registerRoutes.ts:417` adds only `"GET /admin/fx-rates/freshness"` to `ADMIN_ROUTE_KEYS`. The POST route is gated solely by an inline `requireAdminRole(req)` call at `apps/api/src/routes/adminRoutes.ts:411`.

Comment at line 415 of registerRoutes.ts ("POST /admin/fx-rates/refresh has a route-local demo-before-admin guard") explains the intent: keep the demo-vs-admin error precedence inside the handler. But the resulting asymmetry is a maintainability hazard:

- **GET freshness** is double-gated: `enforceRouteRole` (line 922) → `requireAdminRole` (route handler).
- **POST refresh** is single-gated: only the route handler `requireAdminRole`.

If a future refactor accidentally removes line 411, the POST route silently loses admin protection — no compile-time error and no test failure in memory mode (the queue-down 503 fires before any auth-related path).

**Two options:**
1. **Preferred** — add `"POST /admin/fx-rates/refresh"` to `ADMIN_ROUTE_KEYS`. The inline `req.authContext?.isDemo` check still runs before the global `enforceRouteRole` would emit `admin_role_required`? Actually no — `enforceRouteRole` is a preHandler that runs **before** the route body. So adding the route to `ADMIN_ROUTE_KEYS` would make a non-admin demo user see `admin_role_required` instead of `demo_restricted`. Both are 403, semantics differ.
2. **Alternative** — keep the asymmetry but add a defensive comment on `apps/api/src/routes/adminRoutes.ts:411` explicitly stating "DO NOT REMOVE — sole admin gate for this route; not in ADMIN_ROUTE_KEYS by design (demo precedence)."

If the team accepts the demo-first error code semantics being a hard requirement, option 2 is the correct call. Either is acceptable; the silent-removal hazard is what matters.

**File pointers:**
- `apps/api/src/routes/registerRoutes.ts:402-418` — `ADMIN_ROUTE_KEYS` set
- `apps/api/src/routes/adminRoutes.ts:405-446` — POST refresh handler

---

#### M3. Audit-log action uses dot-notation, diverging from the existing snake_case convention

Migration `db/migrations/037_kzo164_fx_rates.sql:64` adds `'admin.fx_rates.refresh'` to `audit_log_action_check`. Every existing action in that constraint is snake_case (`admin_promote_cli`, `admin_role_change`, `share_granted`, `app_config_updated`, etc.).

The migration comment at lines 36–39 says this is intentional and the first action in a new dot-notation namespace, citing scope-todo §5.1. But:

- `apps/api/src/persistence/types.ts:113` adds `"admin.fx_rates.refresh"` to `AuditLogAction` — keeps the same dot form.
- The HTTP/AAA spec at `apps/api/test/http/specs/admin-fx-rates-refresh-aaa.http.spec.ts:269,274` filters and asserts on this exact string.

**Risk surface:**
- Operational queries (`SELECT ... WHERE action = '...'`), Grafana/log-search filters, and Linear ticket grep patterns built around the snake_case norm will silently miss this action.
- Future actions in the same fx-rates namespace (e.g. `admin.fx_rates.repair`) are now committed to the same convention; mixed conventions will compound.

**Suggested resolutions** (any one is fine):
- **Stay with dot notation but document it loudly.** Add a one-line note in `docs/002-operations/runbook.md` § 18 calling out the convention change and that future fx-rates audit actions follow the same shape. Update `apps/api/src/persistence/types.ts` JSDoc on `AuditLogAction` listing the dot-namespace.
- **Switch to `admin_fx_rates_refresh`.** Trivial: edit the migration, the type union member, and the HTTP/AAA spec literal. No audit data exists yet — migration not deployed.

The team's call. Flag because the divergence is invisible in code review without explicit context.

**File pointers:**
- `db/migrations/037_kzo164_fx_rates.sql:43-66` — CHECK constraint extension
- `apps/api/src/persistence/types.ts:113` — type union
- `apps/api/src/routes/adminRoutes.ts:438` — emit site

---

#### M4. Apparent scope creep: `slowPostgresAssertionTimeoutMs` added to `postgres-migrations.integration.test.ts`

The diff for `apps/api/test/integration/postgres-migrations.integration.test.ts` adds:

- A new top-level constant `slowPostgresAssertionTimeoutMs = 15_000` (line 28)
- Per-test timeout overrides on two existing tests (lines 1830, 2358)

These changes have no apparent connection to KZO-164's FX rates scope. The new migration `037_kzo164_fx_rates.sql` is a 67-line CREATE TABLE + index + audit-CHECK extension — well within normal migration runtime budgets.

**Possibilities to verify:**
- The flakiness is real and was introduced by this branch (e.g. by the new migration being applied in `applyNumberedMigrations` for every `beforeEach`). If so, document the failure mode in the commit message.
- The flakiness pre-existed and the fix should land in a separate ticket (`commit-format.md` says scope is `api`/`web`/`db`/etc. — adjust for this).
- It was a stray change picked up from a parallel branch.

If the timeout bumps are genuinely needed by this PR's migration changes, the scope-todo's "out of scope" list (line 200+) should explicitly include this exception, or the runbook note should mention the test-runtime impact. Otherwise, split into a separate `chore(test)` PR.

**File pointers:**
- `apps/api/test/integration/postgres-migrations.integration.test.ts:28` — new constant
- `apps/api/test/integration/postgres-migrations.integration.test.ts:1830,2358` — applied to two tests

---

### LOW

#### L1. Worker handler doc-comment lists invariants 1/3/4/6/7 but invariants 2 and 5 are also honored

`apps/api/src/services/market-data/fxRefreshWorker.ts:34-39` enumerates the Phase 1.5 invariants the handler honors. Invariant 2 (audit on manual only — handler emits NO audit, route does) and invariant 5 (today_utc) are also touched by this code path (via `deriveFetchWindow`'s `now` parameter). Adding both to the docblock keeps the cross-reference auditable.

#### L2. `MockFrankfurterFxRateProvider` does not exercise its own `quotes` filter against an empty-input case

`apps/api/test/unit/mock-frankfurter-fx-rate-provider.test.ts:166-172` covers the truthy quotes filter. The mock implementation at `apps/api/src/services/market-data/providers/mockFrankfurter.ts:66` treats `quotes && quotes.length > 0` — but no test asserts the empty-array path returns ALL quotes. The Frankfurter real-provider test does (line 154). Add a sibling assertion to the mock test for parity.

#### L3. `MockFrankfurterFxRateProvider.calls` shape stamps optional fields for `reserveCapacity` calls

The shape `Array<{ method: string; base?: string; ...; n?: number }>` mixes call types. While functional, the worker tests at `apps/api/test/unit/fx-refresh-worker.test.ts` use a hand-rolled `vi.fn()` rather than this real mock — so the `calls` array is mostly cosmetic. Acceptable, but consider a discriminated-union shape (`{ method: 'fetchRatesForBase'; ... } | { method: 'reserveCapacity'; n: number }`) for future call-site narrowing. Non-blocking.

#### L4. PR description is not yet drafted; Wave 2 obligations per `pr-bound-docs-review-compliance.md`

Per the architect design § 8 and `.claude/rules/pr-bound-docs-review-compliance.md`, the Wave 2 PR description draft must include `## Problem`, `## Solution`, `## Testing` (with `Evidence:` block per suite), `## Risk/Rollback`. It is not present in this branch yet. Confirm Wave 2 (Tech Writer) is queued or that this code-review pass is gating before Wave 2 starts.

---

### INFORMATIONAL

#### I1. Caller verification (per `interface-caller-verification.md` + scope-todo §9.3) — passes

Verified callers exist for every new public symbol introduced in `libs/test-api`, `apps/api/src/services/market-data`, and `apps/api/src/persistence`:

- `FxRateProvider`, `FxRate`, `FxRefreshJobData` — used in registry, worker, persistence, types
- `upsertFxRates`, `getLatestFxRateDate`, `getFxRateFreshness` — used in worker, admin routes, e2e seed route
- `FX_REFRESH_QUEUE`, `FX_REFRESH_CRON` — used in pgBoss plugin
- `STORED_QUOTES` — used in worker filter, admin route default, route-handler defaults
- `today_utc` — used in worker (via deriveFetchWindow), admin route freshness handler
- `FX_REFRESH_MAX_LOOKBACK_DAYS` — used in deriveFetchWindow

Only `_resetFxRates` lacks a real caller — see M1.

#### I2. AAA mapper registration — present

`libs/test-api/src/config/mapper.ts:38` registers `FxRatesEndpoint` with `fxRatesApiAssistantFactory`. Assistant subdirectory layout matches `notifications/` precedent. No runtime crash risk per `test-api-mapper-registration.md`.

#### I3. Migration immutability — observed

Migration `037_kzo164_fx_rates.sql` is a new sequential file; existing applied migrations (030-036) are untouched. Conforms to `migration-strategy.md`.

The `audit_log_action_check` extension uses the `DROP CONSTRAINT IF EXISTS … ADD CONSTRAINT …` pattern matching the precedent in 035_kzo148_impersonation.sql. The 19-action list in 037 matches 035's list verbatim plus the new entry — no actions silently lost.

#### I4. Schema CHECKs validated end-to-end

The Postgres integration test at `apps/api/test/integration/fx-rates-postgres.integration.test.ts:99-170` asserts each of the 4 CHECKs (`rate > 0`, base ISO regex, quote ISO regex, no-self-pair) plus negative cases (rate=0, lowercase, 4-char). Memory persistence has a defensive self-pair filter (`memory.ts:1465`) mirroring the schema CHECK — useful belt-and-suspenders.

#### I5. Frankfurter v2 wire format assumptions

The provider parses `[{date, base, quote, rate}, ...]` with strict per-row `typeof` guards and `Number.isFinite(row.rate)`. Defensive enough for v2 default-blend; if Frankfurter ever switches to a keyed-object format, the provider returns an empty array (not an error). That is consistent with the "no rate-limit branching, plain Error" decision but worth knowing during incident review.

#### I6. `today_utc` exported from `deriveFetchWindow.ts` and reused in `adminRoutes.ts`

The freshness handler at `apps/api/src/routes/adminRoutes.ts:455` uses the same `today_utc()` helper as the worker, ensuring the `ageInDays` field aligns with the cron-window date logic. Good consistency.

---

## Cross-cutting rule compliance check

| Rule | Status | Notes |
|---|---|---|
| `migration-strategy.md` | ✅ | New sequential migration; no in-place edits |
| `service-error-pattern.md` | ✅ | `routeError(503, "queue_unavailable", …)` correctly used; no rate-limit 429/503 branching needed (Frankfurter has no quota) |
| `integration-test-persistence-direct.md` | ✅ | Postgres test uses canonical `describePostgres` + `applyNumberedMigrations` pattern, instantiates `PostgresPersistence` directly |
| `test-api-mapper-registration.md` | ✅ | `FxRatesEndpoint` registered in mapper.ts |
| `e2e-seed-vs-reset-guards.md` | ✅ | `/__e2e/seed-fx-rates` uses `assertE2ESeedEnabled()` |
| `vitest-config-patterns.md` | ✅ | `FX_PROVIDER_MOCK=true` added to `apps/api/vitest.config.ts` env block |
| `interface-caller-verification.md` | ⚠ | All but `_resetFxRates` have callers — see M1 |
| `code-review-before-pr.md` | ✅ | All new test files added to `apps/api/test/tsconfig.json` `include` |
| `commit-format.md` | n/a | Commit not yet authored; scope-todo §10.1 specifies `feat(api,db): KZO-164: …` |
| `typed-transient-error-catch-audit.md` | n/a | No new typed transient-error class introduced |
| `fastify-eviction-lifecycle-pattern.md` | n/a | No new in-memory bucket / setInterval introduced |
| `phased-ticket-scope-completeness.md` | ✅ | Standalone-deployable: cron auto-seeds 30d; admin routes work; no UI dependency |
| `agent-team-workflow.md` | ✅ | Tier 2 parallel Phase 1+2 visible in commit history; HTTP specs pre-imported the AAA infra (TDD-red) |

---

## Suggested fix order (top-down, TDD-validated)

1. **M1** (test isolation): add `/__e2e/reset-fx-rates` endpoint + per-test reset hook. Re-run suite 8 (HTTP) to confirm freshness file remains green.
2. **M2** (defense in depth): pick option (1) or (2); re-run suite 8 to confirm both 403 paths still fire.
3. **M3** (audit action shape): decide convention; if changing, edit migration + type union + HTTP/AAA spec; re-run suites 4, 5, 8.
4. **M4** (timeout bump scope): split or document. Re-run suite 5.
5. **L1, L2, L3, L4** can be addressed in the same fix pass; Wave 2 (L4) is a writer task.

After each fix: re-run the relevant suite; full `npm run test:all:full` before opening the PR per `full-test-suite.md`.

---

## Out of scope for this review

Per `team-phase-3-triage.md`:
- Documentation updates that fall under Wave 2 (L4) are deferred to the Tech Writer.
- The slowPostgresAssertionTimeoutMs scope-creep flag (M4) is a triage decision for the Architect, not a Phase 3 fix-target unless the branch is scoped to address it.

---

## Reviewer notes

The implementation closely follows the locked scope-todo and architect design. The KZO-163 patterns (registry composition, provider barrel, AAA endpoint+assistant shape) are mirrored cleanly. The Phase 1.5 invariants are honored in code, with the `_resetFxRates` test-utility gap as the only material divergence from the spec.

The single most important fix before PR is **M1** — the test fragility is real and the helper to fix it is already in place; only the wiring is missing.
