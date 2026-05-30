# SSE Infrastructure Decisions

Date: 2026-03-23

## Decision

Build a generic SSE (Server-Sent Events) infrastructure now, rather than polling first and upgrading later.

Decided via structured debate (3-of-3 unanimous). Full debate note: `docs/004-notes/sse-infrastructure-debate.md`.

## Architecture

```
Browser (EventSource)  ──►  Fastify GET /events/stream  ◄──  Redis Pub/Sub  ◄──  Background work
```

### API layer

- Generic SSE route: `GET /events/stream`
- Raw `reply.raw` streaming (no Fastify SSE plugin)
- Scoped to authenticated user via session cookie
- Redis pub/sub bridge with dedicated subscriber connection
- Channel per user: `events:{userId}`
- Event type registry as TypeScript discriminated union
- `lastEventId` protocol for reconnection gap recovery

### Frontend layer

- `useEventStream(eventType, onEvent)` React hook
- Native `EventSource` API (no library)
- Connects directly to Fastify API via `NEXT_PUBLIC_API_BASE_URL`
- `withCredentials: true` for cookie auth

### Test mode

- Memory backend provides in-process event emitter fallback (no Redis required)

## Known consumers (current roadmap)

| Consumer | Source ticket | Timeline |
|----------|-------------|----------|
| Cascade recompute status | KZO-114 | Immediate |
| Quote refresh notifications | KZO-87 | Market Data Platform |
| Bar ingestion completion | KZO-85/86 | Market Data Platform |
| Provider health alerts | KZO-91 | Market Data Platform |
| Mismatch flagging | KZO-89 | Market Data Platform |

## Implementation constraints

1. No Fastify SSE plugin — raw streaming
2. No job queue (Bull, pg-boss) — `setImmediate()` to defer, Redis pub/sub to notify
3. Second Redis connection required (pub/sub cannot share with command connection)
4. `EventSource` requires `withCredentials: true`
5. `lastEventId` for reconnection gap recovery

## Related

- Full debate note: `docs/004-notes/sse-infrastructure-debate.md`
- SSE ticket: [KZO-113](https://linear.app/kzokv/issue/KZO-113)
