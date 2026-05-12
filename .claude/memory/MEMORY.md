# Memory Index

## User
- [user_profile.md](user_profile.md) — Senior engineer, TWSE portfolio tracker, worktrees + scope-grill + /team + code-review-then-fix workflow, expects terse responses

## E2E / testing
- [project_e2e_aaa.md](project_e2e_aaa.md) — Durable AAA conventions — fixture roles, declarative spec shape, Vitest split criteria

## Auth / session
- [project_oauth_e2e_automation.md](project_oauth_e2e_automation.md) — OAuth e2e uses refresh token (local) or hardcoded sub (CI), no manual login; `npm run auth:refresh-token` to renew

## Project context
- [project_architecture.md](project_architecture.md) — Monorepo layout, tech stack, workspace structure, and core patterns
- [project_env_setup_cli.md](project_env_setup_cli.md) — env-setup CLI: file layout, 4 targets, CLI flags, integration points
- [project_libs_config_structure.md](project_libs_config_structure.md) — @tw-portfolio/config exports, side-effect constraint, loadDotEnv behavior
- [project_infrastructure.md](project_infrastructure.md) — QNAP deployment via Cloudflare WARP+SSH, 3 Docker compose environments, CI Docker validation, AUTH_MODE constraint
- [project_nextjs_proxy_convention.md](project_nextjs_proxy_convention.md) — Next.js 16 (v16.1.6): proxy.ts replaces deprecated middleware.ts, auto-discovered at build time

## Frontend / product surface
- [project_web_app.md](project_web_app.md) — Next.js App Router pages, frontend feature modules, component organization, and service-layer patterns

## Database / API reference
- [project_db_schema.md](project_db_schema.md) — Pointer: read `docs/001-architecture/backend-db-api.md` + migrations; schema moves faster than memory snapshots
- [project_api_surface.md](project_api_surface.md) — Pointer: read `docs/001-architecture/backend-db-api.md` + `registerRoutes.ts`; route sets are authoritative
- [project_account_shape.md](project_account_shape.md) — Account-shape extension 4-file checklist (`services/store.ts:67` is the canonical seed, NOT MemoryPersistence) + deterministic `cash-${tx.id}` cash-entry IDs by design

## Market data platform
- [project_market_data_progress.md](project_market_data_progress.md) — Pointer: Linear is authoritative for ticket state; this entry tracks only durable known-gaps (backup/restore, notification i18n sweep, legacy test drift)
- [project_market_data_architecture.md](project_market_data_architecture.md) — market_data schema, FinMind (TW/US) + Yahoo Finance AU, InstrumentCatalogProvider interface, search route, upsert strategy
- [project_instrument_type_nullability.md](project_instrument_type_nullability.md) — InstrumentType | null widening: each consumer needs its own guard; MemoryInstrument is separate type

## Team / docs patterns
- [project_team_doc_patterns.md](project_team_doc_patterns.md) — Transition note process-notes section + runbook numbered section for new market data providers

## Promoted to .claude/rules/ (KZO-198)
- `fastify-app-config-bootstrap.md` — onReady hook + eager pre-warm + resolver gates for TTL caches consumed during buildApp()
- `app-config-cache-coherency.md` — generation counter + PATCH-response bypass for TTL caches that back PATCH endpoints
- `env-setup-autogen-required-secrets.md` — register new required Env entries in autoGenerateKeys + shell-quote env values containing spaces
- `fastify-eviction-lifecycle-pattern.md` (addendum) — sweep parameter is admin-tunable; cadence stays env-default
- `vitest-config-patterns.md` (addendum) — Env-Proxy pattern for per-test mutation of frozen Env fields
- `cash-ledger-act-warnings-cosmetic.md` — pre-existing CashLedgerClient act() stderr is known-noisy; skip in PR review

## Promoted to .claude/rules/ (KZO-195)
- `capability-flag-polarity.md` — prefer positive capability flags over negation when gating provider/market behavior; two booleans, not tri-valued enums
- `test-placement-persistence-backend.md` (addendum) — MemoryPersistence dual-store mirror must be unconditional; admin-row stores are catalog-global by design
- `exit-check-non-regression-checklist.md` (addendum) — empirical validation: 5-point checklist held under cumulative pressure (4 distinct flakes); ≥2 data points is non-waivable except infrastructure-class
- `pr-bound-docs-review-compliance.md` (addendum) — structural-compliance brief to Technical Writer is mandatory regardless of CR plan; CR is defense-in-depth not the gate

## Promoted to .claude/rules/ (KZO-196)
- `i18n-flat-record-dict-settings.md` — `dict.settings` stays flat `Record<string, string>`; nested objects break indexed-access JSX narrowing
- `code-review-before-pr.md` (addendum) — type-augmentation `.d.ts` files must be explicitly included alongside new test files (`fastify.d.ts` 414-error cascade)
- `agent-team-workflow.md` (addendum) — lock testid strings in `architect-design.md` at Phase 0; original-agent-revival-during-respawn — park, don't kill; Architect ratification quotes rule strict-scope verbatim; Dispatcher state-rollback prevention on context expiry
- `team-respawn-verify-not-regenerate.md` (addendum) — park, don't kill SOP; KZO-196 validated convergence between revived original + respawn VERIFY pass
- `full-test-suite.md` (addendum) — stale `dist/` drift first-triage step before assuming a typecheck regression
- `shared-types-barrel-turbopack.md` (companion section, by Wave 2) — relative runtime-submodule re-export resolution failure under direct-source path alias
- `e2e-shared-memory-bars-ticker-hygiene.md` (addendum, by Wave 2) — `AUGICS*` ticker prefix reservation

## Promoted to .claude/rules/ (KZO-199)
- `playwright-navigation-patterns.md` (addendum) — Next.js `router.replace` is fire-and-forget; pair with `window.history.replaceState` for synchronous URL state in E2E `page.url()` assertions
- `fastify-eviction-lifecycle-pattern.md` (addendum) — client-facing values derived from live-tunable knobs (Retry-After header, error-envelope retryAfterMs) must use the live resolver, not Env.* — extends "schedule static, parameter live" to client-visible surface
- `validator-activation-gate.md` (occurrence 4 + new failure class) — Architect-side envelope drop: gate held correctly but upstream `[ARCHITECT:GO]` was never sent; mitigation = per-recipient SendMessage + Dispatcher gate-status surfacing

## KZO-192 — ECB/TARGET2 holiday awareness for synthetic FX market (2026-05-12)

- **FX calendar shape:** `tradingCalendar.ts` now has 6 private helpers (no exports): `computeEasterSunday` (Meeus/Jones/Butcher Computus), `ECB_HOLIDAY_YEAR_CACHE` (lazy `Map<number, ReadonlySet<string>>`), `ecbHolidaysForYear`, `isEcbHoliday`, `isFxTradingDay`, `previousFxTradingDayOnOrBefore`. Inserted between `previousWeekdayOnOrBefore` and `latestTradingDateOnOrBefore`. All `function`-keyword, all private.
- **FX-branch split is intentional:** `isTradingDayPure` and `tradingDaysBetweenPure` originally collapsed FX and equity-bootstrap (`tradingDates.size === 0`) into the same branch. They are now split so ECB-holiday semantics do NOT propagate to TW/US/AU equity bootstrap. Do NOT "clean up" this split.
- **v1 limitation:** ECB one-off emergency closures (system migrations) NOT covered. If such an event occurs, mint a follow-on ticket; do NOT silently patch `ecbHolidaysForYear`.
- **`dashboardFreshness.ts` not in FX scope:** that file does not traverse the FX calendar path. Stock stale-amber badges are unaffected by KZO-192. Only `/admin/providers` `frankfurter` row is affected.
- **Timestamp sensitivity for FX rollback tests (rule candidate — needs 2nd data point):** `latestSettledTradingDayPure` tests that expect rollback must trace `resolveFxSettlementCandidate(input)` first. Post-publish (`T18:00Z`) input → candidate = same day; rollback fires only if the CANDIDATE itself is an ECB holiday (AC #1 Good Friday is correct). Pre-cluster tests → use `T15:00Z` so candidate = prior Sunday → rolls back through the cluster. QA caught this in KZO-192 when scope-todo listed `T18:00Z` inputs for Christmas and NYD but the expected values required pre-publish timestamps.

## Feedback & preferences
- [feedback_cache_api_responses.md](feedback_cache_api_responses.md) — Always save external API responses to local files before analysis
- [feedback_team_response_time_slas.md](feedback_team_response_time_slas.md) — `/team` Architect [TRIAGE] 5-min SLA + Validator [HEARTBEAT] during long suites — process refinements from KZO-185
