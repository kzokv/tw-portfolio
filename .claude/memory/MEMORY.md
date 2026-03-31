# Memory Index

## E2E / testing
- ~~project_e2e_webserver_gotchas.md~~ — **PROMOTED** to `.claude/rules/playwright-webserver-startup.md`
- ~~feedback_sse_app_inject_limitation.md~~ — **PROMOTED** to `.claude/rules/sse-app-inject-pattern.md`
- ~~project_preexisting_bypass_failures.md~~ — **REMOVED** (stale — tests now pass, identity-resolution moved to specs-oauth/)
- [feedback_radix_useLayoutEffect_jsdom.md](feedback_radix_useLayoutEffect_jsdom.md) — useLayoutEffect SSR warnings in web unit tests are cosmetic Radix UI + jsdom noise
- [project_e2e_aaa.md](project_e2e_aaa.md) — Phase 5d AAA migration lessons, web/API AAA rules, and parallel-execution guardrails

## Auth / session
- ~~project_session_cookie_architecture.md~~ — **PROMOTED** to `.claude/rules/session-cookie-host-prefix.md`
- [project_oauth_e2e_automation.md](project_oauth_e2e_automation.md) — OAuth e2e uses refresh token (local) or hardcoded sub (CI), no manual login; `npm run auth:refresh-token` to renew
- ~~project_kzo77_identity_resolution_design.md~~ — **DEMOTED** to frozen notes at `docs/004-notes/kzo-77-identity-resolution/` (historical, no longer actionable)

## Project context
- ~~project_validatehostconsistency_singleton_bug.md~~ — **REMOVED** (stale — bug fixed, test passes, function renamed to validateEnvConstraints)
- [project_architecture.md](project_architecture.md) — Monorepo layout, tech stack, workspace structure, and core patterns
- [project_conventions.md](project_conventions.md) — Commit format, AGENTS hierarchy, testing commands, migration conventions, and TypeScript rules
- [project_env_setup_cli.md](project_env_setup_cli.md) — env-setup CLI: file layout, 4 targets, CLI flags, integration points
- [project_libs_config_structure.md](project_libs_config_structure.md) — @tw-portfolio/config exports, side-effect constraint, loadDotEnv behavior
- [project_infrastructure.md](project_infrastructure.md) — QNAP deployment via Cloudflare WARP+SSH, 3 Docker compose environments, CI Docker validation, AUTH_MODE constraint
- [project_nextjs_proxy_convention.md](project_nextjs_proxy_convention.md) — Next.js 16 (v16.1.6): proxy.ts replaces deprecated middleware.ts, auto-discovered at build time
- ~~project_i18n_function_serialization.md~~ — **PROMOTED** to `.claude/rules/nextjs-i18n-serialization.md`
- ~~project_ssr_document_cookie.md~~ — **PROMOTED** to `.claude/rules/nextjs-server-cookie-access.md`

## Frontend / product surface
- [project_web_app.md](project_web_app.md) — Next.js App Router pages, frontend feature modules, component organization, and service-layer patterns

## Database / API reference
- [project_db_schema.md](project_db_schema.md) — PostgreSQL table catalog with columns, constraints, indexes, and read/write paths
- [project_api_surface.md](project_api_surface.md) — HTTP API endpoints, auth model, persistence write paths, and web-consumed surface

## Migration process knowledge
- [feedback_phased_migration_dual_pair.md](feedback_phased_migration_dual_pair.md) — Only safe test migration: keep old+new in parallel, validate parity, then delete old
- [feedback_code_review_as_formal_phase.md](feedback_code_review_as_formal_phase.md) — Run structured CR before PR creation; catches architectural drift early
- [feedback_test_framework_is_architecture.md](feedback_test_framework_is_architecture.md) — Test framework migration is 3-5x scope; surfaces readiness, hydration, auth, parallel issues
- [feedback_structured_debate_resolves_forks.md](feedback_structured_debate_resolves_forks.md) — /debate for decisions with >1 viable option and downstream lock-in
- [feedback_category_abc_classification.md](feedback_category_abc_classification.md) — Classify tests A/B/C before migration to prevent mid-implementation scope surprises

## Agent team workflow
- [feedback_agent_team_workflow.md](feedback_agent_team_workflow.md) — /team skill: 3 tiers, convergence loop, Architect-as-lead, validator gating, state file tracking
- ~~feedback_fixer_verification_loop.md~~ — **PROMOTED** to `.claude/rules/fixer-red-green-verification.md`
- [feedback_qa_test_infra_check.md](feedback_qa_test_infra_check.md) — QA must verify test infrastructure exists before writing infra-dependent tests
- ~~feedback_test_coupling_split.md~~ — **PROMOTED** to `.claude/rules/implementer-qa-test-ownership.md`

## Market data platform
- [project_market_data_progress.md](project_market_data_progress.md) — 6 tickets done, KZO-83 next (before KZO-130), backup/restore gap identified
- [project_market_data_architecture.md](project_market_data_architecture.md) — market_data schema boundary, FinMind client+backfill implemented, environment policy (ADR 2026-03-25)

## Persistence layer
- ~~project_memory_persistence_gaps.md~~ — **PROMOTED** to `.claude/rules/test-placement-persistence-backend.md`
- ~~project_fk_cascade_alter_pattern.md~~ — **PROMOTED** to `docs/004-notes/005-market-data/note-202603261200-fk-cascade-alter-pattern.md`

## SSE / streaming
- ~~feedback_fastify_cors_sse_raw.md~~ — **PROMOTED** to `.claude/rules/fastify-raw-streaming-cors.md`
- ~~playwright_sse_networkidle~~ — **PROMOTED** to `.claude/rules/playwright-sse-networkidle.md`
- ~~project_sse_preconnect_race.md~~ — **PROMOTED** to `.claude/rules/react-useEventStream-preconnect-pattern.md`
- ~~feedback_sse_fast_recompute_e2e_timing.md~~ — **PROMOTED** to `.claude/rules/playwright-fast-sse-assertions.md` (now includes SSE seq ID assertions)
- ~~feedback_duplicate_mutation_status_testid.md~~ — **PROMOTED** to `.claude/rules/playwright-duplicate-testid-pattern.md`
- ~~feedback_sse_seq_e2e_assertions.md~~ — **PROMOTED** (merged into `playwright-fast-sse-assertions.md`)
- [project_buffered_eventbus_scaling.md](project_buffered_eventbus_scaling.md) — BufferedEventBus uses local EventEmitter; extend inner bus for horizontal scaling (KZO-121)

## Accounting / replay (KZO-114)
- [project_replay_invariants.md](project_replay_invariants.md) — 4 replay invariants: scoped methods (not saveStore), ORDER BY trade_date+booking_sequence, catch allocateSellLots, filter zero-amount cash entries
- ~~feedback_interface_dead_code.md~~ — **PROMOTED** to `.claude/rules/interface-caller-verification.md`

## Feedback & preferences
- ~~feedback_rename_caller_grep.md~~ — **PROMOTED** to `.claude/rules/process-refactor-rename-verification.md`
- ~~feedback_npm_script_wrapping.md~~ — **PROMOTED** to `.claude/rules/npm-script-wrapping.md`
- ~~feedback_cli_prompt_ux.md~~ — **PROMOTED** to `.claude/rules/cli-inquirer-preferences.md`
- ~~feedback_web_env_utility.md~~ — **PROMOTED** to `.claude/rules/config-web-env-pattern.md`
- ~~feedback_vitest_alias_order.md~~ — **PROMOTED** to `.claude/rules/vitest-alias-precedence.md`
- ~~feedback_e2e_cross_port_goto.md~~ — **PROMOTED** to `.claude/rules/playwright-cross-port-navigation.md`
- ~~feedback_e2e_cookie_domain_scope.md~~ — **PROMOTED** to `.claude/rules/playwright-oauth-cookie-domain.md`
- ~~project_demo_rate_bucket_isolation.md~~ — **PROMOTED** to `.claude/rules/vitest-module-state-isolation.md`
