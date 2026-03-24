---
name: code-reviewer-kzo-113
description: Code review findings for KZO-113 (SSE infrastructure, EventBus, useEventStream hook) — iteration 1 complete
type: project
---

## Review — Iteration 1 (Complete)

### Files reviewed
All in-scope files:
- `libs/shared-types/src/events.ts`
- `libs/shared-types/src/index.ts`
- `apps/api/src/events/types.ts`
- `apps/api/src/events/memory.ts`
- `apps/api/src/events/redis.ts`
- `apps/api/src/events/index.ts`
- `apps/api/src/app.ts`
- `apps/api/src/types/fastify.d.ts`
- `apps/api/src/routes/sseRoute.ts`
- `apps/api/src/routes/registerRoutes.ts` (SSE additions)
- `apps/web/hooks/useEventStream.ts`
- `apps/web/lib/api.ts`
- `apps/api/test/integration/sse.integration.test.ts`
- `apps/web/tests/e2e/specs/sse-events.spec.ts`
- `apps/web/tests/e2e/specs-oauth/sse-auth.spec.ts`

---

### HIGH
None.

### MEDIUM

1. `apps/api/src/events/redis.ts:47` — `JSON.parse(message)` inside the Redis subscribe callback has no error handling. A malformed JSON message from Redis throws an unhandled exception inside the callback. Depending on redis v4 internals, this may crash the process or corrupt subscriber state. Recommendation: wrap in `try { ... } catch (err) { console.error(...); return; }`.

2. `apps/api/src/routes/sseRoute.ts:142` — Unsafe `req.body` cast in synthetic endpoint. `req.body as { type: string; data?: unknown }` — if the request has no body or no `Content-Type: application/json`, Fastify sets `req.body` to `undefined`/`null`. Accessing `.type` on `undefined` throws a `TypeError` → 500. Inconsistent with rest of codebase (uses Zod). Recommendation: add runtime validation (e.g., `z.object({ type: z.string().min(1), data: z.unknown().optional() }).parse(req.body)`) matching existing route patterns.

### LOW

3. `apps/api/src/events/redis.ts:46` — `this.subscriber.subscribe(channel, callback)` is not awaited. Redis subscription errors are silently swallowed; handler is registered locally but Redis channel subscription may fail without notification.

4. `apps/api/src/events/redis.ts:57-60` — Cleanup closure calls `this.subscriber.unsubscribe(channel)` fire-and-forget. Unsubscribe errors are silently lost.

5. `apps/api/src/routes/sseRoute.ts:47` — `decodeURIComponent(part.slice(eqIdx + 1).trim())` on `tw_e2e_user` cookie can throw `URIError` for malformed percent-encoding (e.g., `%ZZ`). Bubbles up to Fastify error handler as 500. Only affects dev_bypass mode. Recommendation: wrap in `try { ... } catch { return null; }`.

6. `libs/shared-types/src/events.ts:6` — `ErrorEvent` interface name shadows the built-in browser `ErrorEvent` global type by name. Not a runtime issue (module scope), but may cause confusion in frontend code importing from `@tw-portfolio/shared-types`. Consider `SSEErrorEvent`.

7. `apps/web/hooks/useEventStream.ts:50-55` — Gap detection false positive on first reconnect when only heartbeats were received: `lastEventIdRef.current === 1 && currentId === 1` fires `onReconnect` with `{lastReceivedId:1, currentId:1}` — misleading zero-gap trigger. Acceptable for phase 1 per design doc.

### Security Analysis

- **Auth enforcement:** Correct. OAuth mode: `resolveUserId` throws 401 on missing session — SSE inherits auth. `tw_e2e_user` cookie fallback only active in `dev_bypass` mode when resolveUserId returns the "user-1" default. Not exploitable in production. ✅
- **Connection limit bypass:** Not bypassable. Counter is per-user, module-scoped, decremented on `req.raw.on("close")`. Cannot exhaust another user's slots. ✅
- **Synthetic endpoint production guard:** `Env.NODE_ENV === "production"` returns 404. Correct. ✅
- **CORS + credentials:** Existing `app.ts` CORS with `credentials: true` applies to SSE route. Origin whitelist enforced. ✅
- **Cookie injection via `tw_e2e_user`:** Split by `;`, `indexOf("=")` is injection-safe. However, `decodeURIComponent` on value can throw (see LOW #5). ✅ structurally safe.
- **XSS via SSE data:** All data is `JSON.stringify`d before writing to the stream. No raw string interpolation of user content. ✅
- **Redis message injection:** Unhandled JSON.parse (MEDIUM #1). If exploited via Redis compromise, could crash the process.
- **Logging PII:** `req.log.info({ userId, lastEventId, ... })` logs userId. Acceptable for operational telemetry; consistent with existing logging patterns.
