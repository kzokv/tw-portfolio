# Memory Index

## E2E / testing
- [project_e2e_webserver_gotchas.md](project_e2e_webserver_gotchas.md) — Playwright webServer startup bugs: IPv6 health-check URL fix + .env.local sourcing override fix

## Auth / session
- [project_cookie_domain_session.md](project_cookie_domain_session.md) — SESSION_COOKIE_NAME + COOKIE_DOMAIN coupling: why __Host- breaks cross-subdomain OAuth, correct docker defaults, startup guard
- [project_session_cookie_hmac.md](project_session_cookie_hmac.md) — Session cookies are HMAC-signed (userId.hmac format) using SESSION_SECRET; proxy.ts skips HMAC when SESSION_SECRET is falsy (by design); cookie contains internal UUID, not Google sub (KZO-77)
- [project_oauth_e2e_automation.md](project_oauth_e2e_automation.md) — OAuth e2e uses refresh token (local) or hardcoded sub (CI), no manual login; `npm run auth:refresh-token` to renew
- [project_kzo77_identity_resolution_design.md](project_kzo77_identity_resolution_design.md) — KZO-77 design: email-based identity resolution, UUID user IDs, field sync rules, ensureUserSeed split, architecture decisions

## Project context
- [project_env_setup_cli.md](project_env_setup_cli.md) — env-setup CLI: file layout, 8 targets, CLI flags, .env→.env.local rename, integration points
- [project_libs_config_structure.md](project_libs_config_structure.md) — @tw-portfolio/config exports, side-effect constraint, loadDotEnv behavior
- [project_ise_fixes.md](project_ise_fixes.md) — Five ISE root-cause fixes implemented on dev-issue: loadStore parallelization, CORS callback, routeError lib, error boundaries, try/catch in symbol page
- [project_ci_deployment_stability.md](project_ci_deployment_stability.md) — CI deployment stability: Dockerfile drift detection gap, local Docker validation stack (docker-compose.local.yml), CI Docker build job added
- [project_infrastructure_architecture.md](project_infrastructure_architecture.md) — Deploy target: QNAP 192.168.2.10 via Cloudflare WARP + SSH; three Docker compose environments (dev, prod, local)
- [project_nextjs_proxy_convention.md](project_nextjs_proxy_convention.md) — Next.js 16 (v16.1.6): proxy.ts replaces deprecated middleware.ts, auto-discovered at build time

## Agent workflow
- [feedback_agent_team_pattern.md](feedback_agent_team_pattern.md) — User's multi-agent team workflow formalized as /team skill with 3 tiers, convergence loop, Architect-as-lead, and state file tracking
- [feedback_agent_team_validator_gate.md](feedback_agent_team_validator_gate.md) — Architect must explicitly send "[GO]" to validator; validator must not self-activate on task completion

## Agent team workflow
- [feedback_fixer_verification_loop.md](feedback_fixer_verification_loop.md) — Fixer uses red-green verification loop (not TDD): reproduce → fix → verify → full suite sweep before DONE
- [feedback_qa_test_infra_check.md](feedback_qa_test_infra_check.md) — QA must verify test infrastructure (mock servers, playwright configs) exists before writing infra-dependent tests
- [feedback_test_coupling_split.md](feedback_test_coupling_split.md) — Implementer owns implementation-coupled test updates; QA owns new behavioral tests — distinguish in task descriptions

## Persistence layer
- [project_memory_persistence_gaps.md](project_memory_persistence_gaps.md) — MemoryPersistence gaps vs Postgres: no email uniqueness, null timestamps, O(n) scan; 409 conflict tests belong in Postgres integration layer

## DB / migrations
- [feedback_migration_update_vs_new.md](feedback_migration_update_vs_new.md) — Update existing migration file for constraint additions; don't create a new file for minor changes to already-migrated tables

## Auth / API patterns
- [feedback_picture_url_sanitization.md](feedback_picture_url_sanitization.md) — providerPictureUrl must be HTTPS-only validated before rendering; use referrerPolicy="no-referrer" on Google avatar imgs

## Feedback & preferences
- [feedback_npm_script_wrapping.md](feedback_npm_script_wrapping.md) — CLI scripts with positional args should NOT be wrapped as npm scripts; direct invocation is preferred
- [feedback_cli_prompt_ux.md](feedback_cli_prompt_ux.md) — @inquirer/prompts: loop:false, dynamic pageSize, no search/filter, "loop navigation" disambiguation
- [feedback_pr_workflow.md](feedback_pr_workflow.md) — PRs target dev, ticket ID from branch name, commit memory files
- [feedback_routeError_pattern.md](feedback_routeError_pattern.md) — Service throws must use routeError() from lib/routeError.ts, not plain Error, to avoid 500s
- [feedback_web_env_utility.md](feedback_web_env_utility.md) — Use WebEnv.SESSION_COOKIE_NAME from @tw-portfolio/config/web, never raw process.env with hardcoded fallbacks
- [feedback_vitest_alias_order.md](feedback_vitest_alias_order.md) — More specific package aliases (config/web, config/test) must precede bare config alias in vitest.config.ts to prevent prefix clobbering
- [feedback_full_test_suite.md](feedback_full_test_suite.md) — "Full tests pass" = all five suites: lint, unit, integration:ci:host, test:e2e, test:e2e:oauth; always use test:integration:ci:host not test:integration
- [feedback_e2e_cross_port_goto.md](feedback_e2e_cross_port_goto.md) — page.goto() to API port that 302-redirects cross-port must use { waitUntil: "domcontentloaded" } to avoid ERR_ABORTED
- [feedback_e2e_cookie_domain_scope.md](feedback_e2e_cookie_domain_scope.md) — OAuth session cookies live on localhost; logout nav must use TestEnv.host (localhost), not apiUrl() (127.0.0.1)
- [feedback_route_protection_test_placement.md](feedback_route_protection_test_placement.md) — Route protection E2E tests belong in specs-oauth/ (AUTH_MODE=oauth), not specs/ (dev_bypass skips enforcement)
