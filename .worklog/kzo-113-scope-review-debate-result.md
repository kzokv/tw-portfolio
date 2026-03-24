# Debate Result: KZO-113 Scope Review

Date: 2026-03-23

## Contested Question

Is the agreed scope for KZO-113 (10 decisions listed in the brief) correctly sized -- not missing anything critical, not over-scoped for phase 1?

## Team

| Role | Perspective |
|------|------------|
| **Architect** | System design, abstraction boundaries, KZO-113/114 boundary cleanliness |
| **Backend Engineer** | Implementation feasibility, operational concerns, failure modes, Redis specifics |
| **Frontend Engineer** | Hook design, client behavior, EventSource edge cases, testing |
| **QA Engineer** | Testing gaps, E2E coverage, memory backend fallback validity, regression risk |

## Round 1: Scope Audit

### Architect

**Missing:**

1. **EventBus lifecycle in `buildApp` / `AppInstance`.** The scope defines the EventBus interface and two implementations but does not specify how the EventBus is instantiated, attached to the app, or shut down. Currently `AppInstance` exposes `persistence: Persistence` and `buildApp` calls `createPersistence()`. There needs to be a parallel `createEventBus()` factory, an `eventBus` property on `AppInstance`, and an `onClose` hook that calls `eventBus.close()`. The `onClose` hook at `app.ts:68` currently only closes `persistence` -- the EventBus needs the same treatment. This is not a decision item; it is wiring that falls out of Decision 3 but is easy to overlook.

2. **`onSend` security headers interact with SSE.** The `onSend` hook at `app.ts:118-126` sets `content-security-policy: default-src 'none'` and `x-content-type-options: nosniff` on every response. For an SSE endpoint returning `text/event-stream`, the CSP header is irrelevant (it governs HTML document behavior) but harmless. However, the `onSend` hook fires once per response -- on a long-lived SSE stream the headers are set on the initial 200 and never change, which is fine. This does NOT need a scope change, but the implementer should be aware that these hooks fire normally for SSE routes.

3. **EventBus `close()` method in the interface.** Decision 3 lists `publishEvent` and `subscribe` but does not mention `close()` / `destroy()`. The `RedisEventBus` will own a dedicated subscriber Redis connection that must be cleaned up. The interface needs `close(): Promise<void>` to parallel `Persistence.close()`.

**Over-scoped:**

Nothing. The 10 decisions are tightly drawn. The synthetic test endpoint is the only "extra" piece, and it is necessary for E2E validation without wiring up real publishers.

**Boundary concerns:**

1. **KZO-114 publisher wiring.** KZO-114 needs to call `eventBus.publishEvent(userId, "recompute_complete", payload)` from the async recompute path. This requires the EventBus to be accessible from services -- either injected into the service or available on the app instance. The scope does not specify how services access the EventBus. If it is only on `AppInstance`, route handlers can call it, but the recompute service (`services/recompute.ts`) cannot access it without dependency injection. Recommendation: scope should clarify that `eventBus` is on `AppInstance` and that KZO-114 will pass it into service calls, but KZO-113 does NOT need to refactor service signatures.

2. **Event type extensibility.** Decision 6 says the initial type is `recompute_complete`. KZO-114 will use this type. Future consumers (quote refresh, bar ingestion) will add types. The discriminated union in `libs/shared-types/` is the right place. The boundary is clean -- adding a new event type is additive (new union member), not a breaking change.

### Backend Engineer

**Missing:**

1. **Graceful shutdown of SSE connections.** When the server shuts down (SIGTERM in production, `app.close()` in tests), active SSE connections must be terminated. Currently `server.ts` does not handle SIGTERM at all -- there is no signal handler. The SSE route will hold open connections that prevent Fastify from closing cleanly. The scope should include: (a) an `onClose` hook for the EventBus, and (b) the SSE route handler must listen for connection close and clean up (unsubscribe from Redis, decrement connection counter). This is operational infrastructure, not a feature.

2. **Rate limiting interaction.** The `onRequest` hook at `app.ts:96-116` rate-limits mutation methods (`POST`, `PATCH`, `PUT`, `DELETE`). The SSE endpoint is `GET /events/stream`, so it bypasses mutation rate limiting. The per-user connection limit (Decision 8, max 5) covers the DoS vector for SSE specifically. However, the `POST /__test/publish-event` synthetic endpoint IS a mutation and WILL be rate-limited by the existing hook. This is probably fine (it is test-only), but the implementer should be aware that rapid test publishing could hit the rate limit. Not a scope change, but an implementation note.

3. **Redis pub/sub connection error handling.** The `RedisEventBus` will own a dedicated subscriber connection. Redis pub/sub connections have specific failure modes: if the connection drops, all subscriptions are lost and must be re-established. The `redis` npm client (`createClient`) emits `error` events that crash the process if unhandled. The scope should note that the `RedisEventBus` must attach an `error` handler to the subscriber client and implement reconnection logic (the `redis` library does this automatically if `socket.reconnectStrategy` is configured, which is the default). The existing command connection in `PostgresPersistence` does not handle this either (line 56: `createClient({ url })` with no error handler), but command connections are stateless on reconnect -- pub/sub connections are not.

4. **EventBus needs two Redis connections, not one.** Decision 9 says "EventBus owns its own Redis client(s)." This is correct but should be explicit: `RedisEventBus` needs a publisher client AND a subscriber client. Redis pub/sub puts a connection into subscriber mode, which blocks all non-pub/sub commands. Publishing uses `PUBLISH` on a command connection. The publisher client could potentially share with the existing `PostgresPersistence` Redis client, but the scope says "EventBus owns its own" -- so it will create two new connections (total Redis connections: 3). This should be documented.

**Over-scoped:**

Nothing. Every decision maps to a concrete implementation need.

**Boundary concerns:**

1. **Redis URL sharing.** `PostgresPersistence` reads `redisUrl` via constructor injection. `RedisEventBus` will also need `redisUrl`. Both get it from `Env.getRedisUrl()`. The `createPersistence()` factory at `persistence/index.ts:11` passes `Env.getRedisUrl()`. A `createEventBus()` factory would do the same. No boundary issue, but the two factories must not create coupling between `Persistence` and `EventBus` -- they are parallel, not nested.

### Frontend Engineer

**Missing:**

1. **`EventSource` does not support custom headers.** The browser `EventSource` API does not allow setting custom headers (no `x-user-id` for dev_bypass mode). In `api.ts`, every fetch call includes `getAuthHeaders()` which may set `x-user-id` for E2E test isolation. `EventSource` cannot do this. In `oauth` mode this is fine -- the session cookie is sent with `withCredentials: true`. In `dev_bypass` mode, the default user is `"user-1"` (line 205 of `registerRoutes.ts`), which works for local development. BUT for E2E tests that use per-test user isolation via the `tw_e2e_user` cookie -> `x-user-id` header pattern, SSE connections will always resolve to `"user-1"` because EventSource cannot send the header. The scope should address how the SSE route resolves the user in dev_bypass mode. Options: (a) pass user ID as a query parameter on the EventSource URL, (b) read the `tw_e2e_user` cookie server-side in the SSE route (the cookie is present; `api.ts` reads it client-side and converts to a header, but the SSE route could read it directly), (c) accept that E2E SSE tests always use the default user. This is a real gap.

2. **`useEventStream` cleanup on component unmount.** The hook must call `eventSource.close()` on unmount. This is standard React cleanup, but it has an interaction with the connection counter (Decision 8). The server must decrement the counter when the connection closes. If the client does not close cleanly (browser tab closed, network drop), the server detects this via the `close` event on the underlying TCP socket. The scope should confirm that the connection counter is decremented on both clean close (client calls `eventSource.close()`) and dirty close (TCP reset/timeout).

3. **No mention of error handling in the hook.** `EventSource` fires an `error` event on connection failure. The `useEventStream` hook needs to handle this -- at minimum, expose an `error` state and an `onError` callback. The 429 response for connection limit (Decision 8) will arrive as an EventSource `error` event (the browser receives a non-200 response). The hook must differentiate "rate limited, stop retrying" from "temporary network error, let EventSource auto-reconnect." EventSource auto-reconnects on errors, which means a 429 will cause infinite reconnect loops. The scope should specify that the 429 case requires the hook to call `eventSource.close()` and NOT auto-reconnect.

**Over-scoped:**

Nothing.

**Boundary concerns:**

1. **`getApiBaseUrl()` extraction (Decision 10) is well-scoped.** The existing `resolveApiBase()` in `api.ts` (lines 16-28) is a pure function that reads `NEXT_PUBLIC_API_BASE_URL` and applies hostname substitution. Extracting it to a shared utility is low-risk and correctly enables the `useEventStream` hook to construct the EventSource URL. No concern here.

### QA Engineer

**Missing:**

1. **InMemoryEventBus must be testable without Redis.** Decision 3 specifies `InMemoryEventBus` using Node `EventEmitter`. This must work in the `memory` persistence backend mode, which is used by E2E tests (`test:e2e:bypass:mem` and `test:e2e:oauth:mem`). The scope correctly identifies two implementations, but does not specify the factory logic: how does the system choose `RedisEventBus` vs `InMemoryEventBus`? Presumably it follows the same pattern as `createPersistence()` -- keyed on `PERSISTENCE_BACKEND`. If `memory`, use `InMemoryEventBus`; if `postgres`, use `RedisEventBus`. This factory logic needs to be explicit.

2. **Integration test strategy is unclear.** The full test suite (per `.claude/rules/full-test-suite.md`) has five suites. The SSE infrastructure touches three of them: (a) API integration tests (`test:integration:full:host`) -- need to test the EventBus publish/subscribe cycle, (b) E2E bypass tests -- need to test the synthetic endpoint and SSE route, (c) E2E oauth tests -- need to test SSE with cookie auth. The scope does not specify which suites get SSE tests or what the test scenarios are. At minimum: integration test for EventBus publish -> subscribe delivery, integration test for connection limit (429 on 6th), E2E test for synthetic endpoint -> hook receives event.

3. **Memory backend SSE route behavior.** When running with `InMemoryEventBus`, the SSE route works within a single process. `publishEvent` on the in-memory bus goes directly to subscribers in the same process. This is simpler than Redis pub/sub and should work correctly. However, the synthetic test endpoint (`POST /__test/publish-event`) must work with BOTH backends for E2E tests to pass in `:mem` mode. The scope assumes this but does not state it explicitly.

4. **429 on 6th connection -- how to test?** Decision 8 says max 5 connections, 429 on 6th. In E2E tests (Playwright), opening 6 simultaneous EventSource connections to verify the 429 is tricky. Playwright's `page.evaluate()` can open EventSource instances, but verifying the 6th gets a 429 requires inspecting the response status, which EventSource does not expose (it just fires `error`). This is more naturally an integration test (direct HTTP request to the SSE endpoint, check response code). The scope should note that the connection limit is tested at the integration level, not E2E.

**Over-scoped:**

1. **Heartbeat ID incrementing (Decision 5 + lastEventId debate constraint).** The lastEventId debate concluded that heartbeats carry `id:` fields to keep `Last-Event-ID` current. This is fine, but it means the per-connection sequence counter increments on heartbeats too. For a 30s heartbeat, a connection open for 1 hour accumulates 120 heartbeat IDs. If a real event arrives at ID 121 and the client reconnects, the gap of 120 is all heartbeats, not missed data events. The `onReconnect` callback fires with `gap: 120`, and the consumer refetches state -- which is correct but wasteful. This is a minor concern and does NOT require a scope change, but the implementation should consider whether heartbeats should increment the sequence or use a separate counter/sentinel. The lastEventId debate explicitly decided heartbeats carry IDs, so this stands.

**Boundary concerns:**

1. **Synthetic test endpoint removal in KZO-114.** The brief says KZO-114 removes the synthetic endpoint. This is a clean boundary -- the endpoint is guarded by `NODE_ENV !== "production"`, so it is never exposed in production. KZO-114 can remove it without affecting production behavior.

## Round 2: Cross-examination

### Architect responds

**To Backend Engineer's #1 (graceful shutdown):** Agreed. This is a real gap. The `onClose` hook for EventBus cleanup is infrastructure wiring that belongs in KZO-113. If SSE connections are not terminated on shutdown, the Fastify close timeout will hang. I will add this to my final verdict.

**To Backend Engineer's #3 (Redis pub/sub reconnection):** Agreed but the `redis` npm client's default reconnect strategy handles this automatically. The scope should note "attach error handler to subscriber client" as an implementation constraint, but this is not a decision-level item. It is an implementation detail within `RedisEventBus`.

**To Backend Engineer's #4 (two Redis connections):** This should be explicit in the scope. Three total Redis connections (1 command for persistence, 1 publisher for EventBus, 1 subscriber for EventBus) is the correct count. However -- the publisher could potentially use the persistence command connection to avoid a third connection. The scope says "EventBus owns its own," which is cleaner for separation of concerns. I support keeping them separate. But wait: the `PUBLISH` command can be sent on any non-subscriber connection. The EventBus publisher connection only sends `PUBLISH`. If we are concerned about connection count, the EventBus could accept an optional external command client for publishing. This is over-optimization for phase 1. Keep it simple: EventBus owns two connections.

**To Frontend Engineer's #1 (EventSource no custom headers):** This is a real gap that I missed. In `dev_bypass` mode, the SSE route falls through to `userId: "user-1"` because `EventSource` cannot send the `x-user-id` header. For E2E tests with per-test user isolation, this breaks SSE user scoping. The cleanest fix: the SSE route should read `resolveUserId()` which already handles the full auth flow including cookie-based resolution. In `dev_bypass` mode, the `tw_e2e_user` cookie is set by E2E tests, but `resolveUserId` reads the `x-user-id` header, not the cookie. Two solutions: (a) the SSE route reads the `tw_e2e_user` cookie directly (duplicating the client-side logic from `api.ts`), or (b) accept a `userId` query parameter on the SSE URL in dev_bypass mode. Option (b) is simpler but introduces a URL-based auth vector. Option (a) keeps auth in cookies/headers. I lean toward documenting this as an implementation constraint: the SSE route must support the same user resolution as other routes, including E2E cookie fallback.

**To Frontend Engineer's #3 (429 infinite reconnect):** This is a critical gap. EventSource auto-reconnects on ALL errors, including 429. The hook must detect "connection limit exceeded" and stop. Since EventSource does not expose response status codes, the hook cannot distinguish 429 from a network error via the `error` event alone. The standard workaround: use a retry counter. If EventSource fires `error` N times without a successful `open`, give up. Alternatively, the server could return a specific SSE comment/field before closing, but 429 responses do not deliver SSE content. Another approach: instead of returning 429, the server could accept the 6th connection and immediately send an SSE event like `event: error\ndata: {"code":"connection_limit"}\n\n` before closing -- this lets the hook receive the reason. This is a real design decision that the scope should address.

**To QA Engineer's #1 (EventBus factory):** Agreed. The scope should specify a `createEventBus(backend, options)` factory that mirrors `createPersistence()`. This is not a new decision but a clarification of Decision 3.

### Backend Engineer responds

**To Architect's #1 (EventBus lifecycle in buildApp):** Agreed completely. The wiring pattern already exists -- `buildApp` creates persistence, attaches it to `app`, and registers an `onClose` hook. The EventBus follows the same pattern. Not a scope change, but should be noted as an implementation constraint.

**To Architect's #3 (close() in interface):** Agreed. The `EventBus` interface must include `close(): Promise<void>`. Without it, `InMemoryEventBus` might leak event listeners and `RedisEventBus` will leak connections.

**To Frontend Engineer's #1 (EventSource no custom headers):** This is a real problem. I want to add a nuance: in the existing codebase, `resolveUserId` at `registerRoutes.ts:183` reads the `x-user-id` header for dev_bypass. The SSE route will use the same `resolveUserId` function. The problem is specifically E2E test isolation -- when Playwright sets a `tw_e2e_user` cookie, the frontend `api.ts` reads it and converts to an `x-user-id` header on fetch calls. But EventSource cannot do this. The simplest solution that does not require protocol changes: in the SSE route handler, if `AUTH_MODE=dev_bypass`, check for the `tw_e2e_user` cookie in `req.headers.cookie` and use it as the user ID. This is a small addition to the auth resolution path, scoped only to the SSE route. It does not require changing `resolveUserId` globally.

**To Frontend Engineer's #3 (429 reconnect loop):** I agree this is critical. My recommendation: instead of returning a raw 429 HTTP status, the SSE route should return `200 text/event-stream` and immediately send an error event: `event: error\ndata: {"code":"connection_limit_exceeded"}\n\n`, then close the connection. This way: (a) EventSource receives the message, (b) the hook can parse the error code, (c) the hook calls `eventSource.close()` to prevent reconnection. A raw 429 is invisible to EventSource (it just sees "error"). This is a design decision that should be added to the scope.

**To QA Engineer's #4 (testing 429):** At the integration level, this is straightforward -- open 6 HTTP connections with `GET /events/stream` and check the 6th response. If we go with the "200 + error event" approach from my response to Frontend #3, the integration test opens 6 connections and asserts the 6th receives the `error` event with `connection_limit_exceeded`.

### Frontend Engineer responds

**To Architect's boundary concern #1 (EventBus access from services):** Agreed that KZO-113 should NOT refactor service signatures. The EventBus lives on `AppInstance`. Route handlers access it via `app.eventBus`. KZO-114 will pass `app.eventBus` into the async recompute call. This is a clean boundary.

**To Backend Engineer's #1 (graceful shutdown):** Agreed. The hook should also handle `eventSource.close()` being called by the server side -- when the server closes the connection, EventSource fires an `error` event and tries to reconnect. The hook must distinguish "server initiated shutdown" from "temporary error." This can be done with a flag: if the component is unmounting (React cleanup), set `shouldReconnect = false` before calling `eventSource.close()`. If the `error` event fires with `shouldReconnect = false`, do nothing. If it fires with `shouldReconnect = true`, let EventSource auto-reconnect (for temporary errors) or give up after N retries (for persistent errors like 429).

**To Backend Engineer's response on 429 (200 + error event):** This is elegant. I support this approach. It means the SSE route always returns 200 with `text/event-stream`, even when rejecting the connection. The hook's `onmessage` handler checks for `event: error` and calls `eventSource.close()`. This is testable in both integration and E2E contexts. The error event should be typed in the event registry (Decision 6) as a system event type.

**To QA Engineer's #2 (integration test strategy):** Agreed that the scope should note which suites cover SSE. My recommendation:
- Integration tests: EventBus pub/sub, connection limit, SSE wire format, heartbeat
- E2E bypass tests: synthetic endpoint -> hook receives event, hook reconnection behavior
- E2E oauth tests: SSE with cookie auth (confirm EventSource + withCredentials works)

**On my own #1 (EventSource no custom headers):** After the Backend Engineer's response, I agree that the cleanest solution is a small addition to the SSE route's user resolution: in dev_bypass mode, fall back to reading the `tw_e2e_user` cookie from `req.headers.cookie`. This is contained to the SSE route and does not change the global auth flow.

### QA Engineer responds

**To Architect's #1 (EventBus lifecycle):** Agreed. I want to add a testing angle: in integration tests, `buildApp({ persistenceBackend: "memory" })` should also create an `InMemoryEventBus`. The test setup must not require Redis for memory-backend tests. This means the `createEventBus` factory must accept the same `backend` parameter as `createPersistence`.

**To Frontend Engineer's #1 (EventSource no custom headers):** This is a testing gap I should have caught. The E2E suites use per-test user isolation (`tw_e2e_user` cookie) extensively. If the SSE route cannot resolve the correct user in dev_bypass mode, SSE E2E tests will all share `user-1` and cross-contaminate. The cookie-based fallback in the SSE route is necessary for test correctness.

**To Frontend Engineer's #3 and Backend Engineer's response (429 -> 200 + error event):** I support the 200 + error event approach. From a testing perspective, it is much easier to assert on an SSE event payload than on a raw HTTP status from EventSource. The integration test opens 6 SSE connections, reads the 6th connection's first event, and asserts `event: error, data.code: "connection_limit_exceeded"`. Clean and deterministic.

**To my own #2 (integration test strategy):** I want to formalize this. The scope should include a testing matrix:

| Scenario | Suite | Backend |
|----------|-------|---------|
| EventBus pub/sub delivery | Integration | memory |
| Connection limit (6th rejected) | Integration | memory |
| SSE wire format (id, event, data) | Integration | memory |
| Heartbeat delivery | Integration | memory |
| Synthetic endpoint -> hook event | E2E bypass | memory |
| SSE with cookie auth | E2E oauth | memory |
| RedisEventBus pub/sub | Integration | postgres |

The Redis-backed integration test is important but requires a running Redis instance, which `test:integration:full:host` provides (it uses the real Postgres + Redis stack).

## Round 3: Final Verdicts

### Architect

**Verdict: Scope needs specific additions.**

The 10 decisions are fundamentally sound. No items should be removed. Three items should be added:

1. **Add: EventBus `close()` in the interface and `onClose` hook wiring in `buildApp`.** This is infrastructure plumbing required for graceful shutdown and test cleanup.

2. **Add: `createEventBus()` factory mirroring `createPersistence()`.** Selects `InMemoryEventBus` for memory backend, `RedisEventBus` for postgres backend. Accepts constructor options (redisUrl for Redis, nothing for memory).

3. **Add: Connection limit response strategy -- 200 + error event, not raw 429.** The 429 causes EventSource infinite reconnect. Accepting the connection, sending an `event: error` with `connection_limit_exceeded` code, and closing is the correct approach. This changes Decision 8 from "reject with 429" to "accept, send error event, close."

### Backend Engineer

**Verdict: Scope needs specific additions.**

Additions:

1. **Add: Explicit Redis connection count -- RedisEventBus owns 2 connections (publisher + subscriber).** Total system Redis connections: 3 (1 persistence command, 1 EventBus publisher, 1 EventBus subscriber). This should be documented so operators know the connection budget.

2. **Add: Redis subscriber error handling as implementation constraint.** The subscriber connection must have an `error` event handler. The `redis` library's default reconnect handles re-subscription, but the error handler prevents uncaught exceptions from crashing the process.

3. **Agree with Architect on: `close()` in interface, factory function, and 200 + error event for connection limit.**

4. **Add: Graceful shutdown note.** The SSE route handler must clean up on connection close (decrement counter, unsubscribe from EventBus). The `onClose` hook must close all active SSE connections before closing the EventBus.

### Frontend Engineer

**Verdict: Scope needs specific additions.**

Additions:

1. **Add: SSE route user resolution in dev_bypass mode -- read `tw_e2e_user` cookie as fallback.** Without this, E2E test isolation is broken for SSE. This is a small, contained addition to the SSE route's auth resolution.

2. **Add: `useEventStream` hook error handling -- `onError` callback and retry budget.** The hook must stop reconnecting after receiving a `connection_limit_exceeded` error event. It should also expose an `error` state for UI rendering ("Connection lost", "Too many connections", etc.).

3. **Agree with Architect and Backend on: 200 + error event for connection limit.** The hook design depends on this -- without it, the 429 case is invisible to the client.

4. **Add: `error` as a system event type in the registry (Decision 6).** The event type registry should include system event types (`error`, `heartbeat`) alongside domain event types (`recompute_complete`). This keeps the wire format fully typed.

### QA Engineer

**Verdict: Scope needs specific additions.**

Additions:

1. **Add: EventBus factory logic (Decision 3 clarification) -- `createEventBus(backend)` that selects `InMemoryEventBus` or `RedisEventBus` based on persistence backend.**

2. **Add: Testing matrix as implementation guidance.** Which scenarios are tested in which suites. This prevents the common failure mode of "we built it but never tested the full pipe."

3. **Agree with Frontend on: `tw_e2e_user` cookie fallback for SSE user resolution.** Without this, E2E SSE tests are not user-isolated.

4. **Agree with all on: 200 + error event for connection limit.** This is more testable than a raw 429.

## Consensus

The scope is **sound in its 10 decisions** but has **6 gaps** that should be added. No items should be removed or deferred. The additions are all infrastructure plumbing and error-handling details that fall naturally within the SSE infrastructure scope -- they are not feature creep.

The most critical finding is the **connection limit response strategy** (429 -> 200 + error event). The original Decision 8 ("reject with 429") would cause infinite EventSource reconnect loops. This must be changed before implementation begins.

The second most critical finding is the **EventSource auth gap in dev_bypass mode**. Without the cookie fallback, E2E test isolation is broken for SSE.

## Additions

1. **EventBus interface includes `close(): Promise<void>`; `buildApp` registers an `onClose` hook for the EventBus, mirroring the persistence shutdown pattern.** (Architect #3, Backend #4)

2. **`createEventBus(backend, options)` factory function** that selects `InMemoryEventBus` (memory backend) or `RedisEventBus` (postgres backend), mirroring `createPersistence()`. The `AppInstance` type gains an `eventBus: EventBus` property. (Architect boundary #1, QA #1)

3. **Decision 8 amended: connection limit response is 200 + error event, not raw 429.** The SSE route accepts the connection, sends `event: error\ndata: {"code":"connection_limit_exceeded"}\n\n`, and closes. This prevents EventSource infinite reconnect loops and enables the hook to detect and handle the limit gracefully. (Architect final #3, Backend response to FE #3, FE #3)

4. **SSE route user resolution in dev_bypass mode: fall back to `tw_e2e_user` cookie from `req.headers.cookie`.** This maintains E2E test user isolation for SSE connections, since `EventSource` cannot send custom headers. Only applies in dev_bypass mode; oauth mode uses session cookie auth as normal. (FE #1, QA response)

5. **Event type registry (Decision 6) includes system event types: `error` and `heartbeat`.** These are typed alongside domain events (`recompute_complete`) so the hook can discriminate event types without string comparison. (FE final #4)

6. **`RedisEventBus` owns 2 Redis connections (publisher + subscriber); total system Redis connections is 3. Subscriber connection must attach an `error` event handler.** This is an implementation constraint, not a new decision, but should be documented to prevent connection budget surprises. (Backend #3, #4)

## Removals

None.

## Unchanged

Decisions 1 (KZO-113/114 boundary), 2 (lastEventId Option 2), 4 (CORS no changes), 5 (heartbeat 30s configurable), 7 (synthetic test endpoint), 9 (Redis constructor injection), and 10 (API base URL shared utility) stand as written.

Decision 3 (EventBus separate interface) stands but is supplemented by Additions 1 and 2 (close method and factory).

Decision 6 (event type registry) stands but is supplemented by Addition 5 (system event types).

Decision 8 (connection limit) is **amended** per Addition 3 (200 + error event replaces 429).

## Open Items

1. **`useEventStream` retry budget.** How many consecutive `error` events before the hook gives up entirely (not just for connection limit, but for persistent server errors)? Suggested: 5 retries with exponential backoff, then stop and expose `status: "failed"`. This can be decided during implementation.

2. **SSE route request logging.** Fastify's default logger logs request/response for each HTTP exchange. A long-lived SSE connection is one request with a very long response time. The access log will show the request duration as hours/days. Consider whether to suppress the SSE route from default request logging or add custom SSE connection lifecycle logging instead.

3. **Heartbeat sequence interaction with gap detection.** Heartbeats increment the per-connection sequence counter. A client that reconnects after 10 minutes of silence (20 heartbeats) will see a gap of 20 even though no data events were missed. The `onReconnect` callback will report gap=20 and the consumer will refetch unnecessarily. The lastEventId debate decided heartbeats carry IDs. This is acceptable for phase 1 (refetch is cheap for convergent state), but should be revisited if gap-based refetch optimization becomes important.
