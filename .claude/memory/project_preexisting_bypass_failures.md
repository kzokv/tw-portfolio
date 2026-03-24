---
name: kzo-109-preexisting-bypass-failures
description: "2 bypass E2E tests (auth-oauth, identity-resolution) failing pre-existing — confirmed not regressions"
type: project
---

Two bypass E2E tests are failing as of KZO-109/KZO-113 validation. Confirmed pre-existing — files not modified by either ticket:

1. `tests/e2e/specs/auth-oauth.spec.ts:221` — session cookie undefined after OAuth callback
2. `tests/e2e/specs/identity-resolution.spec.ts:75` — returns `"user-1"` (dev_bypass fallback) instead of expected UUID

**Why:** These tests exercise OAuth session behavior in dev_bypass mode. The session cookie isn't being set/recognized, causing fallthrough to the dev_bypass identity default. Likely a test setup issue (wrong auth mode for the assertion), not a production bug.

**How to apply:** Do not treat these as regressions when validating other PRs. They need their own fix ticket. Per the `fixer-scope-guardrail` rule, the fix should be at the test-setup level (e.g., `vi.mock("@tw-portfolio/config")` or moving to `specs-oauth/`), not in production auth plumbing.
