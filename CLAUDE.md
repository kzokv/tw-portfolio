# CLAUDE.md

## Policy Authority

Before modifying any file, read the nearest `AGENTS.md` (walking up from the touched file's directory to repo root). It is the canonical source for build commands, code style, testing, security, and Context7 sources.

Read all relevant `AGENTS.md` files when a change spans multiple subtrees (root + each touched subtree).

Read `AGENTS.md` before any git commit, PR creation, or branch operation.

## Rule Layering

`AGENTS.md` is the policy authority. `.claude/rules/` supplements it with Claude-specific behavioral rules (incident-learned, scope-guarded). Rules do not override `AGENTS.md` policy.

New rule routing: agent-agnostic → `AGENTS.md` (nearest subtree), Claude-specific → `.claude/rules/`, ephemeral / session-scoped → `.worklog/` or memory, durable reference → `docs/004-notes/`.

## Session Context

`.worklog/` is the cross-agent handoff surface. Read it when resuming work or when prior-session context materially affects the current task.

`.claude/memory/` is Claude-specific durable knowledge. Do not duplicate `.worklog/` content into memory — they serve different lifecycles.

## Test File Placement

Test files for `scripts/env-setup/` must live in `libs/config/test/` (prefixed `env-setup-*`), NOT in `scripts/env-setup/`. `scripts/` is not an npm workspace — `npm run test --workspaces` and vitest never discover tests placed there. When writing tests for any module under `scripts/`, place the test file in `libs/config/test/` with a descriptive prefix (e.g., `env-setup-generator.test.ts`). The import path is `../../scripts/env-setup/module.js`.

## E2E AAA Guardrails

For Playwright E2E in this repo, keep Phase 5d-style parallel execution at 2 workers but avoid same-file `fullyParallel` fan-out. Prefer deterministic route-ready markers, route prewarming, and probe-based waits over fixed sleeps, especially for client-hydrated ticker and auth flows.
