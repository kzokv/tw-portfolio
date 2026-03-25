# Memory Index

## E2E / testing
- ~~project_e2e_webserver_gotchas.md~~ — **PROMOTED** to `.claude/rules/playwright-webserver-startup.md`
- ~~feedback_sse_app_inject_limitation.md~~ — **PROMOTED** to `.claude/rules/sse-app-inject-pattern.md`
- ~~project_preexisting_bypass_failures.md~~ — **REMOVED** (stale — tests now pass, identity-resolution moved to specs-oauth/)
- [feedback_radix_useLayoutEffect_jsdom.md](feedback_radix_useLayoutEffect_jsdom.md) — useLayoutEffect SSR warnings in web unit tests are cosmetic Radix UI + jsdom noise

## Auth / session
- [project_session_cookie_architecture.md](project_session_cookie_architecture.md) — Session cookie architecture: HMAC signing, __Host- prefix trap, COOKIE_DOMAIN coupling, cross-subdomain OAuth
- [project_oauth_e2e_automation.md](project_oauth_e2e_automation.md) — OAuth e2e uses refresh token (local) or hardcoded sub (CI), no manual login; `npm run auth:refresh-token` to renew
- ~~project_kzo77_identity_resolution_design.md~~ — **DEMOTED** to frozen notes at `docs/004-notes/kzo-77-identity-resolution/` (historical, no longer actionable)

## Project context
- [project_validatehostconsistency_singleton_bug.md](project_validatehostconsistency_singleton_bug.md) — validateHostConsistency uses Env.NODE_ENV singleton (not injectable); test failure is pre-existing and intentionally unfixed
- [project_env_setup_cli.md](project_env_setup_cli.md) — env-setup CLI: file layout, 4 targets, CLI flags, integration points
- [project_libs_config_structure.md](project_libs_config_structure.md) — @tw-portfolio/config exports, side-effect constraint, loadDotEnv behavior
- [project_infrastructure.md](project_infrastructure.md) — QNAP deployment via Cloudflare WARP+SSH, 3 Docker compose environments, CI Docker validation, AUTH_MODE constraint
- [project_nextjs_proxy_convention.md](project_nextjs_proxy_convention.md) — Next.js 16 (v16.1.6): proxy.ts replaces deprecated middleware.ts, auto-discovered at build time
- [project_i18n_function_serialization.md](project_i18n_function_serialization.md) — i18n dictionary functions can't cross Next.js server→client boundary; use string templates
- [project_ssr_document_cookie.md](project_ssr_document_cookie.md) — `document.cookie` unavailable in server components; use `next/headers` `cookies()`

## Agent team workflow
- [feedback_agent_team_workflow.md](feedback_agent_team_workflow.md) — /team skill: 3 tiers, convergence loop, Architect-as-lead, validator gating, state file tracking
- ~~feedback_fixer_verification_loop.md~~ — **PROMOTED** to `.claude/rules/fixer-red-green-verification.md`
- [feedback_qa_test_infra_check.md](feedback_qa_test_infra_check.md) — QA must verify test infrastructure exists before writing infra-dependent tests
- ~~feedback_test_coupling_split.md~~ — **PROMOTED** to `.claude/rules/implementer-qa-test-ownership.md`

## Persistence layer
- [project_memory_persistence_gaps.md](project_memory_persistence_gaps.md) — MemoryPersistence gaps vs Postgres: no email uniqueness, null timestamps, O(n) scan
- [project_fk_cascade_alter_pattern.md](project_fk_cascade_alter_pattern.md) — PostgreSQL unnamed FKs require dynamic constraint name lookup via pg_constraint for ON DELETE CASCADE

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
