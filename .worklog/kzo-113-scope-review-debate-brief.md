# Debate Brief: KZO-113 Full Scope Review

Date: 2026-03-23

## Contested Question

Is the agreed scope for KZO-113 (generic SSE infrastructure with Redis pub/sub bridge) correctly sized — not missing anything critical, not over-scoped for phase 1?

The team should stress-test each decision for gaps, contradictions, and over-engineering.

## Context

KZO-113 builds generic SSE infrastructure for a personal finance/bookkeeping monorepo (Fastify API + Next.js frontend). It blocks KZO-114 (transaction edit/delete with async cascade recompute). Five additional consumers are on the roadmap (quote refresh, bar ingestion, provider health, mismatch flagging).

### Codebase state
- **Redis**: Single command connection for quote cache (30s TTL) + idempotency keys (24h TTL). No pub/sub.
- **Fastify**: ~40 route handlers in single `registerRoutes.ts`. CORS configured with `credentials: true` and dynamic origin check (not wildcard). Rate limiting on mutations only.
- **Auth**: `resolveUserId()` — dual-mode (dev_bypass / oauth). HMAC-signed session cookie in oauth mode.
- **Frontend**: Plain `fetch()` via `api.ts` with `getJson()`/`postJson()`. Direct Fastify API connection (not proxied through Next.js). Hostname substitution logic for cookie scoping.
- **Persistence**: Clean `Persistence` interface with `PostgresPersistence` and `MemoryPersistence` implementations.
- **Recompute**: Fully synchronous in route handler today.

### Prior debate
A `lastEventId` depth debate concluded unanimously for Option 2 (protocol-compliant but shallow — IDs, no replay). Full result: `.worklog/kzo-113-lasteventid-debate-result.md`.

## Agreed Scope (10 Decisions)

### 1. KZO-113 / KZO-114 boundary
KZO-113 ships infrastructure + synthetic test endpoint. KZO-114 wires up real publishers (async cascade recompute). No combining.

### 2. lastEventId — Option 2 (IDs, no replay)
Per-connection monotonic integer IDs. Parse `Last-Event-ID` on reconnect, log gap telemetry, do NOT replay. Client handles gaps via state refetch. No Redis buffer infrastructure.

### 3. EventBus — separate interface
New `EventBus` interface, NOT bolted onto `Persistence`. Two implementations:
- `RedisEventBus` — pub/sub via dedicated subscriber connection
- `InMemoryEventBus` — Node `EventEmitter` for test/memory backend

### 4. CORS — no changes needed
Already configured: `credentials: true`, dynamic origin check, not wildcard. EventSource with `withCredentials: true` works out of the box.

### 5. Heartbeat — configurable, 30s default
Periodic heartbeat events to keep connections alive through proxies. Configurable interval (e.g., via environment variable or constructor parameter). Heartbeats carry `id:` fields.

### 6. Event type registry — in `libs/shared-types/`
TypeScript discriminated union. Initial type: `recompute_complete`. Shared between API and frontend. No new workspace.

### 7. Synthetic test endpoint
`POST /__test/publish-event`. Requires auth (`resolveUserId`). Guarded by `NODE_ENV !== "production"`. Accepts JSON body matching event type registry. Publishes to authenticated user's channel.

### 8. Per-user connection limit — max 5, reject with 429
Counter per userId, decrement on close. 6th connection gets 429 Too Many Requests. No eviction of existing connections.

### 9. Redis connection — constructor injection
`new RedisEventBus({ redisUrl })`. EventBus owns its own Redis client(s). Reads config via constructor parameter, not `Env` directly. Same pattern as PostgresPersistence.

### 10. API base URL — shared utility
Extract `getApiBaseUrl()` from `api.ts` hostname substitution logic. Both `api.ts` and `useEventStream` hook import it. Single source of truth for API base URL resolution.

## What to stress-test

Each debater should challenge the scope from their domain:

1. **Is anything missing?** Are there infrastructure pieces the scope assumes but doesn't list? Error handling? Graceful shutdown? Logging?
2. **Is anything over-scoped?** Are we building things in KZO-113 that should be deferred to KZO-114 or later?
3. **Are the boundaries clean?** Will KZO-114 be able to wire up the real publisher without modifying KZO-113's code?
4. **Are there operational gaps?** Monitoring, debugging, failure modes not addressed?
5. **Are there testing gaps?** Can the full pipe be tested in unit, integration, and E2E suites with the planned abstractions?

## Evidence

Key files:
- Fastify setup & CORS: `apps/api/src/app.ts` (lines 72-94)
- Route handlers: `apps/api/src/routes/registerRoutes.ts`
- Redis client: `apps/api/src/persistence/postgres.ts` (lines 45-57, 794-825)
- Persistence interface: `apps/api/src/persistence/types.ts`
- Memory persistence: `apps/api/src/persistence/memory.ts`
- Persistence factory: `apps/api/src/persistence/index.ts`
- Frontend API client: `apps/web/lib/api.ts`
- Recompute service: `apps/api/src/services/recompute.ts`
- Auth resolver: `apps/api/src/routes/registerRoutes.ts` (lines 183-208)
- Design notes: `docs/004-notes/004-transaction-mutations/`
- lastEventId debate: `.worklog/kzo-113-lasteventid-debate-result.md`

## Visual Diagram

```
┌─────────────────────────────────────────────────────────┐
│ KZO-113 Scope                                           │
│                                                         │
│  API Layer:                                             │
│  ┌─────────────────┐  ┌──────────────────┐              │
│  │ GET /events/     │  │ POST /__test/    │              │
│  │   stream         │  │   publish-event  │              │
│  │ (SSE route)      │  │ (synthetic test) │              │
│  └────────┬─────────┘  └────────┬─────────┘              │
│           │                     │                        │
│  ┌────────▼─────────────────────▼─────────┐              │
│  │ EventBus interface                     │              │
│  │  publishEvent(userId, type, payload)   │              │
│  │  subscribe(userId, handler)            │              │
│  ├────────────────────┬───────────────────┤              │
│  │ RedisEventBus      │ InMemoryEventBus  │              │
│  │ (pub/sub)          │ (EventEmitter)    │              │
│  └────────────────────┴───────────────────┘              │
│                                                         │
│  Shared Types:                                          │
│  ┌─────────────────────────────────────────┐             │
│  │ Event type registry (discriminated      │             │
│  │ union in libs/shared-types/)            │             │
│  └─────────────────────────────────────────┘             │
│                                                         │
│  Frontend:                                              │
│  ┌─────────────────┐  ┌──────────────────┐              │
│  │ useEventStream() │  │ getApiBaseUrl()  │              │
│  │ React hook       │  │ shared utility   │              │
│  └─────────────────┘  └──────────────────┘              │
│                                                         │
│  Config: heartbeat interval (30s default, configurable) │
│  Limits: max 5 SSE connections per user (429 on 6th)    │
│  IDs: per-connection monotonic, gap telemetry on reconnect│
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ KZO-114 Scope (NOT in KZO-113)                          │
│  - Wire up real publisher (cascade recompute)           │
│  - Async recompute refactor (setImmediate + publish)    │
│  - DELETE / PATCH transaction routes                     │
│  - Frontend mutation UI (dialogs, inline edit, toasts)  │
│  - Remove synthetic test endpoint                        │
└─────────────────────────────────────────────────────────┘
```
