---
name: development conventions and rules
description: Commit format, testing commands, migration conventions, AGENTS.md policy hierarchy, and coding standards
type: feedback
---

## Commit Format
`type(scope): KZO-XX: subject` — Linear ticket reference mandatory.

## AGENTS.md Hierarchy
Nearest local `AGENTS.md` wins for touched files. Root at `/AGENTS.md`, plus per-workspace:
- `apps/api/AGENTS.md` — validate route boundaries, thin handlers, tenant isolation, parameterized queries
- `apps/web/AGENTS.md` — no backend concerns in presentational components, API calls in service layers
- `db/AGENTS.md` — append-only migrations, additive evolution, explicit SQL
- `libs/domain/AGENTS.md` — pure functions, no I/O, explicit rounding, test every rule
- `libs/shared-types/AGENTS.md` — explicit ownership fields, no secrets in types, backward-compatible evolution

## Testing
- Unit: `npm test` (Vitest)
- Integration: `npm run test:integration:ci:host` (Darwin) or `:ci:container` (Linux) — requires managed CI stack
- E2E: Playwright in `apps/web/tests/e2e/`
- Integration tests use `describePostgres` gating with `RUN_POSTGRES_INTEGRATION=1` and `TWP_MANAGED_CI_STACK=1`

## Migration Conventions
- Numbered: `NNN_short_description.sql` (next: 021)
- `IF NOT EXISTS` / `IF EXISTS` guards for idempotency
- PL/pgSQL `DO $$` blocks for conditional changes
- Backfill with `UPDATE ... WHERE ... IS NULL`
- CHECK constraints with regex patterns
- snake_case column names
- Baseline absorbs numbered migrations; update `manifest.env` when baseline is refreshed

## TypeScript
- Strict mode enabled everywhere
- Context7 sources: TypeScript, TypeScript ESLint, Playwright

**Why:** Following these conventions prevents CI failures, maintains consistency, and respects the existing codebase standards.
**How to apply:** Always check the nearest AGENTS.md before modifying files in a workspace. Use the correct commit format and test commands.
