# Fastify Raw Streaming: Propagate Buffered Headers Manually

Any Fastify route that bypasses `reply.send()` (SSE, WebSocket upgrade, raw streaming via `reply.raw.writeHead()`) must manually propagate **every** header queued by earlier hooks from Fastify's internal buffer. This is not a CORS-specific rule — it applies to any header set via `reply.header()` by any hook or plugin.

Fastify queues `reply.header()` calls in an internal buffer and only flushes them to the raw socket on `reply.send()`. Routes that write directly to `reply.raw.writeHead()` skip that flush — any header set by `onRequest`, `preHandler`, or `onSend` hooks is silently dropped. The `onSend` hook in particular does not fire at all when the route never calls `send()`, so hooks that *stamp* headers at send-time (rather than `onRequest`-time) need extra care.

**Canonical references:**
- `pickCorsHeaders(reply)` — `apps/api/src/routes/sseRoute.ts` — propagates `@fastify/cors` headers.
- `pickContextFallbackHeaders(req, reply)` — same file — propagates KZO-146's `x-context-fallback` + clear-cookie signal by reading the per-request `__contextFallback` flag directly (since the `onSend` hook never fires for SSE).

**Pattern (onRequest-sourced headers — e.g. @fastify/cors):**

```ts
// Extract headers queued by an onRequest hook before calling writeHead()
const corsHeaders = ["access-control-allow-origin", "access-control-allow-credentials", "vary"]
  .reduce((acc, key) => {
    const val = reply.getHeader(key);
    if (val !== undefined) acc[key] = val;
    return acc;
  }, {} as Record<string, unknown>);

reply.raw.writeHead(200, {
  "content-type": "text/event-stream",
  ...corsHeaders,
});
```

**Pattern (onSend-sourced headers — e.g. x-context-fallback):**

```ts
// onSend never fires for SSE. Read the per-request flag set in preHandler
// and build the headers inline for writeHead().
function pickContextFallbackHeaders(req: FastifyRequest, reply: FastifyReply) {
  if (!shouldStampContextFallback(req)) return { headers: {}, setCookie: [] };
  const existing = reply.getHeader("set-cookie");
  const cookies: string[] = Array.isArray(existing)
    ? existing.map((v) => String(v))
    : existing !== undefined ? [String(existing)] : [];
  cookies.push(contextClearCookieString());
  return {
    headers: { [CONTEXT_FALLBACK_HEADER]: "revoked" },
    setCookie: cookies,
  };
}
```

**Why:**
- KZO-113 — All SSE E2E tests failed with CORS errors while integration tests (no browser CORS enforcement) passed, masking the issue until Playwright ran.
- KZO-146 — `x-context-fallback` + clear-cookie stamped by the `onSend` hook worked for `reply.send()` paths but silently dropped for the SSE handshake. Client never received the fallback signal until the next `fetch()` response. Caught in pre-PR code review, not in tests.

**How to apply:** When creating or modifying any route that uses `reply.raw.writeHead()` / `reply.raw.write()` instead of `reply.send()`:

1. Enumerate every hook (`onRequest`, `preHandler`, `onSend`) that sets response headers.
2. For `onRequest` / `preHandler` sources — read them via `reply.getHeader()` before `writeHead()`.
3. For `onSend`-sourced headers — the hook does NOT fire for `raw.writeHead` paths. Read the per-request flag (`req.__*`) directly and build the headers inline.
4. Don't forget multi-value headers like `set-cookie`, which may be a string or an array.

Also applies to WebSocket upgrade handlers if added in the future.
