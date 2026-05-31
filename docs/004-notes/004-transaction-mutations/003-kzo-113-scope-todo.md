# Todo: KZO-113 — Build Generic SSE Infrastructure with Redis Pub/Sub Bridge

Date: 2026-03-23

## Implementation Steps

### EventBus abstraction
- [x] Define `EventBus` interface in `apps/api/src/persistence/` (or new `events/` directory): `publishEvent(userId, type, payload)`, `subscribe(userId, handler)`, `close(): Promise<void>`
- [x] Implement `RedisEventBus` with constructor injection (`{ redisUrl }`), owning 2 Redis connections (publisher + subscriber). Attach `error` handler on subscriber connection.
- [x] Implement `InMemoryEventBus` using Node `EventEmitter` for memory backend
- [x] Create `createEventBus(backend, options)` factory mirroring `createPersistence()`

### App lifecycle wiring
- [x] Add `eventBus: EventBus` property to `AppInstance` type
- [x] Wire `createEventBus()` into `buildApp()` — init on startup, register `onClose` hook for shutdown
- [x] Verify graceful shutdown terminates active SSE connections before closing EventBus

### Event type registry
- [x] Add TypeScript discriminated union to `libs/shared-types/` with domain types (`recompute_complete`) and system types (`error`, `heartbeat`)

### SSE route (`GET /events/stream`)
- [x] Implement SSE route in `registerRoutes.ts` using raw `reply.raw` streaming (no Fastify SSE plugin)
- [x] Auth via `resolveUserId()` — add `tw_e2e_user` cookie fallback in dev_bypass mode for E2E test isolation
- [x] Set headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`
- [x] Subscribe to EventBus for authenticated userId
- [x] Per-connection monotonic integer ID counter; include `id:` field on every event (including heartbeats)
- [x] Parse `Last-Event-ID` header on connection open; log gap telemetry (userId, lastEventId, currentSeq, gapSize); do NOT replay
- [x] Configurable heartbeat interval (default 30s); heartbeat events carry `id:` fields
- [x] Per-user connection limit: max 5 concurrent SSE connections. On 6th: accept connection, send `event: error` with `{"code":"connection_limit_exceeded"}`, close.
- [x] Clean up on connection close (`req.raw.on("close", ...)`): unsubscribe from EventBus, clear heartbeat interval, decrement connection counter

### Synthetic test endpoint
- [x] Implement `POST /__test/publish-event` guarded by `NODE_ENV !== "production"`
- [x] Require auth (`resolveUserId`); accept JSON body matching event type registry
- [x] Publish to authenticated user's channel via EventBus; return 200 with published event

### Frontend
- [x] Extract `getApiBaseUrl()` from `apps/web/lib/api.ts` into shared utility; update `api.ts` to import it
- [x] Implement `useEventStream(eventType, onEvent)` React hook using native `EventSource` API
  - Connect to `getApiBaseUrl() + "/events/stream"` with `withCredentials: true`
  - Track `lastEventId` internally
  - `onReconnect({ lastReceivedId, currentId })` callback for gap-aware refetch
  - `onError` callback; stop reconnecting on `connection_limit_exceeded` error event
  - Retry budget for persistent errors (suggested: 5 retries with exponential backoff)
  - Cleanup `eventSource.close()` on unmount

### Testing
- [x] Integration tests (memory backend): EventBus pub/sub delivery, connection limit (6th rejected with error event), SSE wire format (id, event, data), heartbeat delivery
- [x] Integration tests (postgres backend): RedisEventBus pub/sub round-trip
- [x] E2E bypass tests: synthetic endpoint → hook receives event
- [x] E2E oauth tests: SSE with cookie auth (EventSource + withCredentials)

## Open Items
- [x] Decide hook retry budget — **decided: 5 retries (implemented in useEventStream.ts)**
- [x] Decide SSE request logging strategy — **deferred to future ticket**
- [x] Decide heartbeat sequence interaction with gap detection — **deferred (acceptable for phase 1)**

## References
- Scope debate notes: `.worklog/kzo-113-lasteventid-debate-result.md`, `.worklog/kzo-113-scope-review-debate-result.md`
- Design notes: `docs/004-notes/004-transaction-mutations/001-design-change-mutable-transactions.md`, `002-sse-infrastructure-decisions.md`
- SSE infrastructure debate: `docs/004-notes/004-transaction-mutations/sse-infrastructure-debate.md`
- Linear ticket: [KZO-113](https://linear.app/kzokv/issue/KZO-113/build-generic-sse-infrastructure-with-redis-pubsub-bridge)
