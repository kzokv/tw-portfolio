# Fastify Raw Streaming CORS Headers

Any Fastify route that bypasses `reply.send()` (SSE, WebSocket upgrade, raw streaming via `reply.raw.writeHead()`) must manually propagate CORS headers from Fastify's internal buffer.

`@fastify/cors` sets headers via `reply.header()` in the `onRequest` hook, but these only flush to the raw response on `reply.send()`. Routes that write directly to `reply.raw` skip this flush — browsers block the connection with CORS errors.

**Pattern:**

```ts
// Extract CORS headers set by @fastify/cors before calling writeHead()
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

**Canonical reference:** `pickCorsHeaders(reply)` helper in `apps/api/src/routes/sseRoute.ts`.

**Why:** Discovered in KZO-113. All SSE E2E tests failed with CORS errors while integration tests (no browser CORS enforcement) passed — masking the issue until Playwright ran.

**How to apply:** When creating any new route that uses `reply.raw.writeHead()` or `reply.raw.write()` instead of `reply.send()`. Also applies to WebSocket upgrade handlers if added in the future.
