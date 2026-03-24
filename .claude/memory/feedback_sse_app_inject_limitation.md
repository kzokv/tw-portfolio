---
name: sse-app-inject-limitation
description: "Fastify app.inject() hangs indefinitely on live SSE connections — use listen+fetch+AbortController instead"
type: feedback
---

`app.inject()` is not usable for testing SSE streams that stay open. Fastify's inject waits for the response to complete; SSE connections never complete under normal operation.

**Exception:** The connection-limit rejection path calls `reply.raw.end()` immediately, so `app.inject()` works only for testing the rejection case (e.g., 6th concurrent connection attempt).

**Why:** Identified during KZO-113 test plan design. If you naively use `app.inject()` for SSE, the test hangs indefinitely.

**How to apply:** For SSE integration tests that exercise live streaming, use `app.listen({ port: 0 })` + `fetch()` with an `AbortController` for teardown. See `apps/api/test/integration/sse.integration.test.ts` for the established pattern.
