---
name: kzo-109-script-discrepancies
description: AGENTS.md and CLAUDE.md reference test scripts that don't exist in package.json (test:unit, test:integration:full:host)
type: project
---

AGENTS.md and the full-test-suite rule in `.claude/rules/full-test-suite.md` reference two scripts that don't exist:
- `npm run test:unit --prefix apps/web` — actual script is `npm run test --prefix apps/web` (vitest run)
- `npm run test:integration:full:host --prefix apps/api` — actual script is `npm run test:integration:full --prefix apps/api`

**Why:** Discovered during KZO-109 validation. The Validator couldn't find these scripts and had to fall back to alternatives.

**How to apply:** These docs should be updated to match actual package.json scripts. When referencing test commands, verify against `package.json` scripts, not just rule files.

---

---
name: kzo-109-preexisting-bypass-failures
description: 2 bypass E2E tests (auth-oauth, identity-resolution) failing pre-KZO-109 — not regressions
type: project
---

Two bypass E2E tests are failing as of KZO-109 validation (2026-03-23). Confirmed pre-existing — files not modified by KZO-109:

1. `tests/e2e/specs/auth-oauth.spec.ts:221` — session cookie undefined after OAuth callback
2. `tests/e2e/specs/identity-resolution.spec.ts:75` — returns "user-1" (dev_bypass fallback) instead of expected UUID

**Why:** These tests exercise OAuth session behavior in dev_bypass mode. The session cookie isn't being set/recognized, causing fallthrough to the dev_bypass default identity.

**How to apply:** Don't treat these as regressions when validating other PRs. They need their own fix ticket (likely a test setup issue, not a production bug — per the fixer-scope-guardrail rule).
