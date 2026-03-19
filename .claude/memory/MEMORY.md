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
