---
slug: kzo-116
source: scope-grill
created: 2026-04-09
tickets: [KZO-116]
required_reading: []
superseded_by: null
---

# Todo: KZO-116 — Close as already fixed

> **For agents starting a fresh session:** this ticket has no implementation work. The
> failure described in KZO-116 was structurally fixed by an unrelated commit before
> the ticket was ever picked up. This document captures the verification trail.

## Background

KZO-116 was filed 2026-03-24 during KZO-114, citing a consistent failure of
`apps/web/tests/e2e/specs-oauth/profile-tab.spec.ts:223` (`avatar identity display ›
avatar button shows picture when user has providerPictureUrl`).

Three days later, commit `3c79123` (Phase 5d AAA migration, 2026-03-27) deleted the
cited spec and recreated it as `apps/web/tests/e2e/specs-oauth/profile-tab-aaa.spec.ts`.
The avatar test moved from line 223 of the old file to lines 86–92 of the new file.

The most likely root cause of the original failure: the pre-AAA `seedProfileUser`
helper used `apiUrl()` (which resolves to `127.0.0.1`) to plant cookies, while the
session cookie was scoped to `localhost` via `TestEnv.host`. This is the cookie-domain
trap captured in `.claude/rules/playwright-oauth-cookie-patterns.md`. The AAA per-test
user-isolation fixture chain (`oauthBase` / `oauthPages`, introduced in Phase 5c
commit `6b3140f`) and the `SessionActions.seedOAuthSession` flow eliminated this
failure mode structurally.

## Verification

Performed against `dev` HEAD `26aa661` in worktree `.claude/worktrees/kzo-116` on
2026-04-09:

- [x] Single failing test passes:
      `npm run test:e2e:oauth:mem -- --grep "avatar button shows picture when user has providerPictureUrl"`
      → `1 passed (27.2s)`
- [x] All avatar tests pass:
      `npm run test:e2e:oauth:mem -- --grep "avatar"`
      → `6 passed (22.4s)` (6 tests across `profile-tab-aaa.spec.ts` + `routing-aaa.spec.ts`)

## Implementation Steps

- [x] Confirm the cited test no longer exists at the original path
- [x] Locate the migrated equivalent in `profile-tab-aaa.spec.ts`
- [x] Run the migrated test in isolation against `dev` HEAD
- [x] Run the full `--grep "avatar"` set to rule out cross-test pollution
- [x] Append `## Locked Scope` block to KZO-116 description in Linear
- [x] Add scope-grill outcome comment on KZO-116
- [x] Move KZO-116 to **Done**

## Open Items

None. The existing AAA test serves as the regression guard. No production code
needs to change. No new tests are needed.

## References

- Linear ticket: KZO-116
- Migration commit: `3c79123` (Phase 5d AAA migration, 2026-03-27)
- Per-test isolation commit: `6b3140f` (Phase 5c, OAuth parallelization)
- Current test: `apps/web/tests/e2e/specs-oauth/profile-tab-aaa.spec.ts:86`
- Test infrastructure: `libs/test-e2e/src/assistants/layout/AppShellArrange.ts:7-15`
- Mock JWT helper: `libs/test-e2e/src/utils/jwt.ts`
- Related rule: `.claude/rules/playwright-oauth-cookie-patterns.md`
- Related rule: `.claude/rules/provider-url-sanitization.md`
