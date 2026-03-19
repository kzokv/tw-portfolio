---
name: route-protection-test-placement
description: Route protection E2E tests must run in specs-oauth (AUTH_MODE=oauth), not specs (dev_bypass)
type: feedback
---

Route protection tests (clear cookies → visit / → expect redirect to /login) only work when `NEXT_PUBLIC_AUTH_MODE=oauth`. The standard E2E suite (`specs/`) runs in `dev_bypass` mode where `proxy.ts` skips session enforcement by design.

**Why:** The `proxy.ts` guard `if (WebEnv.NEXT_PUBLIC_AUTH_MODE !== "oauth") return NextResponse.next()` makes auth enforcement conditional. Tests that rely on unconditional enforcement will silently pass in CI but fail in dev_bypass mode.

**How to apply:**
- Place route protection tests in `specs-oauth/auth-session.spec.ts` (runs with real `AUTH_MODE=oauth`)
- In those tests, call `page.context().clearCookies()` before each navigation to simulate unauthenticated state
- Do NOT put route protection tests in `specs/` — they will pass locally in oauth mode but fail in standard E2E
