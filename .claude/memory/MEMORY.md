# Memory Index

## E2E / testing
- [project_e2e_webserver_gotchas.md](project_e2e_webserver_gotchas.md) — Playwright webServer startup bugs: IPv6 health-check URL fix + .env.local sourcing override fix
- [feedback_sse_app_inject_limitation.md](feedback_sse_app_inject_limitation.md) — Fastify app.inject() hangs on live SSE connections; use listen+fetch+AbortController instead
- [project_preexisting_bypass_failures.md](project_preexisting_bypass_failures.md) — 2 bypass E2E tests (auth-oauth, identity-resolution) failing pre-existing, not regressions
- [feedback_radix_useLayoutEffect_jsdom.md](feedback_radix_useLayoutEffect_jsdom.md) — useLayoutEffect SSR warnings in web unit tests are cosmetic Radix UI + jsdom noise

## Auth / session
- [project_cookie_domain_session.md](project_cookie_domain_session.md) — SESSION_COOKIE_NAME + COOKIE_DOMAIN coupling: why __Host- breaks cross-subdomain OAuth, correct docker defaults, startup guard
- [project_session_cookie_hmac.md](project_session_cookie_hmac.md) — Session cookies are HMAC-signed (userId.hmac format) using SESSION_SECRET; proxy.ts skips HMAC when SESSION_SECRET is falsy (by design); cookie contains internal UUID, not Google sub (KZO-77)
- [project_oauth_e2e_automation.md](project_oauth_e2e_automation.md) — OAuth e2e uses refresh token (local) or hardcoded sub (CI), no manual login; `npm run auth:refresh-token` to renew
- [project_kzo77_identity_resolution_design.md](project_kzo77_identity_resolution_design.md) — KZO-77 design: email-based identity resolution, UUID user IDs, field sync rules, ensureUserSeed split, architecture decisions

## Project context
- [project_validatehostconsistency_singleton_bug.md](project_validatehostconsistency_singleton_bug.md) — validateHostConsistency uses Env.NODE_ENV singleton (not injectable); test failure is pre-existing and intentionally unfixed
- [project_env_setup_cli.md](project_env_setup_cli.md) — env-setup CLI: file layout, 4 targets, CLI flags, integration points
- [project_libs_config_structure.md](project_libs_config_structure.md) — @tw-portfolio/config exports, side-effect constraint, loadDotEnv behavior
- ~~project_ise_fixes.md~~ — **REMOVED** (stale — fixes are in code/git history)
- [project_ci_deployment_stability.md](project_ci_deployment_stability.md) — CI deployment stability: Dockerfile drift detection gap, local Docker validation stack (docker-compose.local.yml), CI Docker build job added
- [project_infrastructure_architecture.md](project_infrastructure_architecture.md) — Deploy target: QNAP 192.168.2.10 via Cloudflare WARP + SSH; three Docker compose environments (dev, prod, local)
- [project_nextjs_proxy_convention.md](project_nextjs_proxy_convention.md) — Next.js 16 (v16.1.6): proxy.ts replaces deprecated middleware.ts, auto-discovered at build time
- [project_i18n_function_serialization.md](project_i18n_function_serialization.md) — i18n dictionary functions can't cross Next.js server→client boundary; use string templates with `.replace("{key}", value)` instead
- [project_ssr_document_cookie.md](project_ssr_document_cookie.md) — `document.cookie` unavailable in server components; use `next/headers` `cookies()` for server-side auth header reading
- ~~project_store_accounting_structure.md~~ — **REMOVED** (stale — derivable from code)

## Agent team workflow
- [feedback_agent_team_pattern.md](feedback_agent_team_pattern.md) — User's multi-agent team workflow formalized as /team skill with 3 tiers, convergence loop, Architect-as-lead, and state file tracking
- [feedback_agent_team_validator_gate.md](feedback_agent_team_validator_gate.md) — Architect must explicitly send "[GO]" to validator; validator must not self-activate on task completion
- ~~feedback_fixer_verification_loop.md~~ — **PROMOTED** to `.claude/rules/fixer-red-green-verification.md`
- [feedback_qa_test_infra_check.md](feedback_qa_test_infra_check.md) — QA must verify test infrastructure (mock servers, playwright configs) exists before writing infra-dependent tests
- ~~feedback_test_coupling_split.md~~ — **PROMOTED** to `.claude/rules/implementer-qa-test-ownership.md`

## Persistence layer
- [project_memory_persistence_gaps.md](project_memory_persistence_gaps.md) — MemoryPersistence gaps vs Postgres: no email uniqueness, null timestamps, O(n) scan; 409 conflict tests belong in Postgres integration layer

## SSE / streaming
- ~~feedback_fastify_cors_sse_raw.md~~ — **PROMOTED** to `.claude/rules/fastify-raw-streaming-cors.md`
- ~~playwright_sse_networkidle~~ — **PROMOTED** to `.claude/rules/playwright-sse-networkidle.md` — `networkidle` can never resolve with open SSE connection; use `load` or element assertions
- [project_sse_preconnect_race.md](project_sse_preconnect_race.md) — `useEventStream` with `enabled:condition` loses events if backend fires via setImmediate; pre-connect with `enabled:true` instead

## Persistence layer (continued)
- [project_fk_cascade_alter_pattern.md](project_fk_cascade_alter_pattern.md) — PostgreSQL unnamed FKs require dynamic constraint name lookup via pg_constraint to add ON DELETE CASCADE

## Feedback & preferences
- [feedback_rename_caller_grep.md](feedback_rename_caller_grep.md) — When renaming exported functions, grep all callers across entire repo before marking implementation complete
- [feedback_npm_script_wrapping.md](feedback_npm_script_wrapping.md) — CLI scripts with positional args should NOT be wrapped as npm scripts; direct invocation is preferred
- [feedback_cli_prompt_ux.md](feedback_cli_prompt_ux.md) — @inquirer/prompts: loop:false, dynamic pageSize, no search/filter, "loop navigation" disambiguation
- [feedback_web_env_utility.md](feedback_web_env_utility.md) — Use WebEnv.SESSION_COOKIE_NAME from @tw-portfolio/config/web, never raw process.env with hardcoded fallbacks
- [feedback_vitest_alias_order.md](feedback_vitest_alias_order.md) — More specific package aliases (config/web, config/test) must precede bare config alias in vitest.config.ts to prevent prefix clobbering
- [feedback_e2e_cross_port_goto.md](feedback_e2e_cross_port_goto.md) — page.goto() to API port that 302-redirects cross-port must use { waitUntil: "domcontentloaded" } to avoid ERR_ABORTED
- [feedback_e2e_cookie_domain_scope.md](feedback_e2e_cookie_domain_scope.md) — OAuth session cookies live on localhost; logout nav must use TestEnv.host (localhost), not apiUrl() (127.0.0.1)
- [project_demo_rate_bucket_isolation.md](project_demo_rate_bucket_isolation.md) — Module-level demoRateBuckets Map persists across buildApp() calls in same test worker — needs _resetDemoRateBuckets() in beforeEach

## Accounting / replay (KZO-114)
- [project_savestore_full_replace.md](project_savestore_full_replace.md) — saveStore deletes ALL user trade events — replay functions must use scoped persistence methods, never saveStore
- [project_replay_order_invariant.md](project_replay_order_invariant.md) — replayPositionHistory must ORDER BY trade_date ASC, booking_sequence ASC — not booked_at or trade_timestamp
- [project_allocate_sell_lots_error.md](project_allocate_sell_lots_error.md) — allocateSellLots throws plain Error with no trade context — replay must catch and enrich for recompute_failed payload
- [project_cash_ledger_zero_amount.md](project_cash_ledger_zero_amount.md) — cash_ledger_entries CHECK (amount <> 0) — replay must filter out zero-amount settlement entries
- [feedback_interface_dead_code.md](feedback_interface_dead_code.md) — When designing persistence interfaces with many methods, verify all methods have callers before shipping
