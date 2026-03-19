# Memory Index

## E2E / testing
- [project_e2e_webserver_gotchas.md](project_e2e_webserver_gotchas.md) — Playwright webServer startup bugs: IPv6 health-check URL fix + .env.local sourcing override fix

## Auth / session
- [project_cookie_domain_session.md](project_cookie_domain_session.md) — SESSION_COOKIE_NAME + COOKIE_DOMAIN coupling: why __Host- breaks cross-subdomain OAuth, correct docker defaults, startup guard

## Project context
- [project_env_setup_cli.md](project_env_setup_cli.md) — env-setup CLI: file layout, 8 targets, CLI flags, .env→.env.local rename, integration points
- [project_libs_config_structure.md](project_libs_config_structure.md) — @tw-portfolio/config exports, side-effect constraint, loadDotEnv behavior

## Feedback & preferences
- [feedback_cli_prompt_ux.md](feedback_cli_prompt_ux.md) — @inquirer/prompts: loop:false, dynamic pageSize, no search/filter, "loop navigation" disambiguation
- [feedback_pr_workflow.md](feedback_pr_workflow.md) — PRs target dev, ticket ID from branch name, commit memory files
- [project_ise_fixes.md](project_ise_fixes.md) — Five ISE root-cause fixes implemented on dev-issue: loadStore parallelization, CORS callback, routeError lib, error boundaries, try/catch in symbol page
- [feedback_routeError_pattern.md](feedback_routeError_pattern.md) — Service throws must use routeError() from lib/routeError.ts, not plain Error, to avoid 500s
- [feedback_web_env_utility.md](feedback_web_env_utility.md) — Use WebEnv.SESSION_COOKIE_NAME from @tw-portfolio/config/web, never raw process.env with hardcoded fallbacks
- [feedback_vitest_alias_order.md](feedback_vitest_alias_order.md) — More specific package aliases (config/web, config/test) must precede bare config alias in vitest.config.ts to prevent prefix clobbering
- [feedback_full_test_suite.md](feedback_full_test_suite.md) — "Full tests pass" = all five suites: lint, unit, integration:ci:host, test:e2e, test:e2e:oauth
- [feedback_e2e_cross_port_goto.md](feedback_e2e_cross_port_goto.md) — page.goto() to API port that 302-redirects cross-port must use { waitUntil: "domcontentloaded" } to avoid ERR_ABORTED
- [feedback_e2e_cookie_domain_scope.md](feedback_e2e_cookie_domain_scope.md) — OAuth session cookies live on localhost; logout nav must use TestEnv.host (localhost), not apiUrl() (127.0.0.1)
- [feedback_route_protection_test_placement.md](feedback_route_protection_test_placement.md) — Route protection E2E tests belong in specs-oauth/ (AUTH_MODE=oauth), not specs/ (dev_bypass skips enforcement)
