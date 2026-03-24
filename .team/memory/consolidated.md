<!-- Consolidated by Memory Curator — KZO-113 (SSE Infrastructure), 2026-03-24 -->
<!-- Sources: architect.md, code-reviewer.md, fixer.md, senior-qa.md, validator.md -->

---
name: fastify-cors-sse-raw-writeHead
description: "@fastify/cors headers don't reach reply.raw.writeHead() — SSE routes must manually propagate CORS headers"
type: feedback
---

When using raw `reply.raw.writeHead()` for SSE streaming in Fastify, CORS headers set by `@fastify/cors` in the `onRequest` hook are NOT included. They live in Fastify's internal header buffer (`reply.header()` / `kReplyHeaders`) and only flush to the raw response on `reply.send()` — which SSE routes deliberately skip.

**Why:** Discovered in KZO-113 iteration 1. All 4 SSE E2E tests failed because browsers blocked EventSource connections with CORS errors. API integration tests (using `http.get()` directly) passed because they don't enforce CORS — masking the issue. Root cause: Fastify's header buffer never flushed.

**How to apply:** Any Fastify route that bypasses `reply.send()` (SSE, WebSocket upgrade, raw streaming) must call `reply.getHeader()` to extract CORS headers and include them manually in `writeHead()`. Use the `pickCorsHeaders(reply)` helper pattern from `apps/api/src/routes/sseRoute.ts` as the canonical reference.

---

---
name: sse-app-inject-limitation
description: "Fastify app.inject() hangs indefinitely on live SSE connections — use listen+fetch+AbortController instead"
type: feedback
---

`app.inject()` is not usable for testing SSE streams that stay open. Fastify's inject waits for the response to complete; SSE connections never complete under normal operation.

**Exception:** The connection-limit rejection path calls `reply.raw.end()` immediately, so `app.inject()` works only for testing the rejection case (e.g., 6th concurrent connection attempt).

**Why:** Identified by QA during KZO-113 test plan design. If you naively use `app.inject()` for SSE, the test hangs indefinitely.

**How to apply:** For SSE integration tests that exercise live streaming, use `app.listen({ port: 0 })` + `fetch()` with an `AbortController` for teardown. See `apps/api/test/integration/sse.integration.test.ts` for the established pattern.

---

---
name: kzo-109-preexisting-bypass-failures
description: "2 bypass E2E tests (auth-oauth, identity-resolution) failing pre-KZO-109 — confirmed pre-existing, not regressions"
type: project
---

Two bypass E2E tests are failing as of KZO-109/KZO-113 validation. Confirmed pre-existing — files not modified by either ticket:

1. `tests/e2e/specs/auth-oauth.spec.ts:221` — session cookie undefined after OAuth callback
2. `tests/e2e/specs/identity-resolution.spec.ts:75` — returns `"user-1"` (dev_bypass fallback) instead of expected UUID

**Why:** These tests exercise OAuth session behavior in dev_bypass mode. The session cookie isn't being set/recognized, causing fallthrough to the dev_bypass identity default. Likely a test setup issue (wrong auth mode for the assertion), not a production bug.

**How to apply:** Do not treat these as regressions when validating other PRs. They need their own fix ticket. Per the `fixer-scope-guardrail` rule, the fix should be at the test-setup level (e.g., `vi.mock("@tw-portfolio/config")` or moving to `specs-oauth/`), not in production auth plumbing.

---

---
name: full-test-suite-script-discrepancy
description: "full-test-suite.md rule references test:integration:full:host which doesn't exist in apps/api/package.json"
type: project
---

The `.claude/rules/full-test-suite.md` rule specifies `npm run test:integration:full:host` as the integration test command. This script does **not** exist in `apps/api/package.json`. The actual working script is `npm run test:integration:full --prefix apps/api`.

Similarly, `npm run test:unit --prefix apps/web` does not exist — the actual script is `npm run test --prefix apps/web`.

**Why:** Discovered during KZO-109 and KZO-113 validation. The Validator couldn't run the commands verbatim and had to fall back to alternatives.

**How to apply:** When running tests, use the actual package.json scripts. The rule file should be updated to match. Until corrected, treat `test:integration:full:host` as an alias intent for `test:integration:full`.

---
