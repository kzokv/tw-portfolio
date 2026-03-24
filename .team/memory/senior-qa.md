# Senior QA Memory — KZO-113

## Phase 1 Test Plan

Date: 2026-03-23

### Critical Testing Challenges

#### 1. `app.inject()` Cannot Test Live SSE Streams

Fastify's `app.inject()` waits for response completion. SSE connections never complete. `app.inject()` will hang indefinitely for normal SSE connections.

**Exception:** Connection-limit rejection (6th connection) calls `reply.raw.end()` immediately, so `app.inject()` works for that case.

**Approach:** Use `app.listen({ port: 0 })` + `fetch()` with `AbortController` for streaming tests.

#### 2. Heartbeat Interval Must Be Configurable

`HEARTBEAT_INTERVAL_MS = 30_000` is a module constant. Tests need ~100ms. Request Implementer make it configurable via `buildApp()` options.

#### 3. Module-Scoped Connection Counter

`connectionCounts` is module-level. Could leak between tests. Need to verify reset on `app.close()`.

#### 4. Cookie Domain for E2E EventSource

E2E fixture sets `tw_e2e_user` on web domain. EventSource connects to API domain. Cross-origin cookie may not be sent. Need confirmation from Architect on proxy config.
