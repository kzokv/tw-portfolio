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

## Feedback & preferences
- [feedback_cache_api_responses.md](feedback_cache_api_responses.md) — Always save external API responses to local files before analysis
- [feedback_team_response_time_slas.md](feedback_team_response_time_slas.md) — `/team` Architect [TRIAGE] 5-min SLA + Validator [HEARTBEAT] during long suites — process refinements from KZO-185
