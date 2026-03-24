# Fixer Memory — KZO-113

## Status
Task #7 COMPLETED — iteration 1 fixes applied and verified.

## Iteration 1 — Fixed (all 12 items)

### Root cause of E2E SSE failures
`@fastify/cors` adds CORS headers via `reply.header()` in its `onRequest` hook. Fastify stores these in an internal buffer (`kReplyHeaders`) — they are NOT flushed to `reply.raw` until `reply.send()`. The SSE route calls `reply.raw.writeHead()` directly, bypassing this flush. Browser blocks EventSource with CORS error → all 4 SSE E2E failures.

Fix: `pickCorsHeaders(reply)` helper that reads specific CORS keys via `reply.getHeader()` and spreads them into `writeHead()`.

### Fixes applied

| # | File | Fix |
|---|------|-----|
| E1 | `sse-auth.spec.ts` | Removed unused `TestEnv` import (lint fix) |
| E2 | `sse-events.spec.ts` | Removed unused `userId` from `page.evaluate()` args (lint fix) |
| E3-4 | `sseRoute.ts` | Added `pickCorsHeaders()` helper, called in both `writeHead()` paths |
| E5 | (pre-existing) | `shell-navigation.spec.ts` flake — SKIPPED per Architect |
| E6-7 | `sseRoute.ts` (CORS fix) | Same fix as E3-4 fixes OAuth E2E too |
| M1 | `redis.ts:47` | try/catch around `JSON.parse(message)`, log + return on error |
| M2 | `sseRoute.ts:142` | `z.object({ type: z.string().min(1), data: z.unknown().optional() }).parse(req.body)` |
| L3 | `redis.ts:46` | `void this.subscriber.subscribe(...)` (fire-and-forget with error surface via error event) |
| L4 | `redis.ts:57` | `void this.subscriber.unsubscribe(...).catch((err) => console.error(...))` |
| L5 | `sseRoute.ts:47` | `decodeURIComponent` wrapped in try/catch, return null on URIError |
| L6 | `events.ts:6` | `ErrorEvent` → `SSEErrorEvent`, union updated |

### Suite results post-fix
1. ESLint: 0 errors, 5 warnings (all pre-existing) ✅
2. Web unit tests: 10/10 files, 66/66 tests ✅
3. API integration: 18/18 files, 151 passed, 2 skipped ✅
4. Bypass E2E: NOT RUN (requires Playwright infra — sent to Validator)
5. OAuth E2E: NOT RUN (requires Playwright infra — sent to Validator)

### Key pattern learned
When a Fastify route calls `reply.raw.writeHead()` directly (required for SSE/streaming), it MUST manually propagate CORS headers via `reply.getHeader()` because Fastify's `reply.header()` buffers to internal state, not `reply.raw`. The `pickCorsHeaders(reply)` pattern is the canonical fix.
