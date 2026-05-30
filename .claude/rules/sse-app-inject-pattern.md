# SSE Testing with app.inject()

`app.inject()` cannot test live SSE streams — it hangs indefinitely waiting for the response to complete. SSE connections never complete under normal operation.

**When app.inject() does work:**
Only for rejection paths (e.g., rate limit rejection) that call `reply.raw.end()` immediately. For testing the rejection case, use `app.inject()`.

**Correct pattern for live SSE streams:**
Use `app.listen({ port: 0 })` + `fetch()` with `AbortController` for teardown.

```ts
const app = buildApp();
const server = await app.listen({ port: 0 });
const port = server.address().port;

const controller = new AbortController();
const response = await fetch(`http://localhost:${port}/stream`, {
  signal: controller.signal,
});
// ... read stream ...
controller.abort(); // cleanup
await app.close();
```

**Why:** Identified during KZO-113. Live SSE requires an open connection; `app.inject()` cannot maintain this for testing purposes.

**How to apply:** When writing SSE integration tests that exercise live streaming, use the listen+fetch pattern. See `apps/api/test/integration/sse.integration.test.ts` for the established pattern.
