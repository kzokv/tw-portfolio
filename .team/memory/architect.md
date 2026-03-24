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

---

---
name: fastify-cors-sse-raw-writeHead
description: "@fastify/cors headers don't reach reply.raw.writeHead() — SSE routes must manually propagate CORS headers"
type: feedback
---

When using raw `reply.raw.writeHead()` for SSE streaming in Fastify, CORS headers set by `@fastify/cors` in the `onRequest` hook are NOT included. They live in Fastify's internal header buffer (`reply.header()`) and only flush on `reply.send()` — which SSE routes skip.

**Why:** Discovered in KZO-113 iteration 1. All 4 SSE E2E tests failed because browsers blocked EventSource connections with CORS errors. Integration tests (using `http.get()` directly) passed because they don't enforce CORS.

**How to apply:** Any Fastify route that bypasses `reply.send()` (SSE, WebSocket upgrade, raw streaming) must call `reply.getHeader()` to extract CORS headers and include them in `writeHead()`. Use the `pickCorsHeaders(reply)` helper pattern from `sseRoute.ts`.
