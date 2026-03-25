---
slug: kzo-117-118
source: scope-grill
created: 2026-03-25
tickets: [KZO-117, KZO-118]
required_reading:
  - .worklog/debate/sse-fix-debate.md
  - docs/004-notes/kzo-114/scope-todo-202603251700-sse-reliability.md
superseded_by: null
---

# Todo: KZO-117 + KZO-118 — SSE Replay Buffer & Write Backpressure

> **For agents starting a fresh session:** read all files listed in `required_reading` above before starting implementation.

## Design Decisions

### KZO-117 — Last-Event-ID Replay with Bounded Event Buffer

**In-memory ring buffer per user, accessed via a BufferedEventBus wrapper.**

- `BufferedEventBus` wraps the existing `EventBus` and captures every published event per user into an in-memory ring buffer — regardless of whether any SSE connection is currently listening
- Buffer is time-bounded: 60-second TTL per event (not count-bounded)
- Per-user monotonic sequence counter that survives across connections but resets on server restart
- On reconnect with `Last-Event-ID` header, `sseRoute.ts` replays buffered events with IDs > `lastEventId` before subscribing to live events
- If buffer doesn't cover the gap (events older than 60s or server restarted), skip replay — the existing 10-second safety net handles this case
- Client-side: browser natively sends `Last-Event-ID` on EventSource reconnect (WHATWG spec). `useEventStream.ts` already parses event IDs. Minimal client changes expected.

**Why in-memory, not Redis Streams:**
- Primary failure mode is tunnel jitter / Cloudflare edge failover (server stays running, buffer intact)
- Server restart = buffer lost, but 10s safety net already covers that case
- Single-instance deployment — no cross-instance buffer sharing needed
- Redis Streams can be added later alongside KZO-121 (distributed connection counting) when horizontal scaling arrives

### KZO-118 — Write Backpressure: Drop and Warn

**When `write()` returns `false`, drop the event and log a warning. Do not queue.**

- Check `reply.raw.write()` return value in `writeEvent()`
- If `false` (TCP send buffer full), skip the event and `console.warn` with event type, user ID, and seq
- ~5 lines of code change in `writeEvent()`
- Dropped events are recoverable via KZO-117's replay buffer on reconnect, or via the 10s safety net

**Why not queue-and-drain:**
- Two safety nets already cover dropped events (replay buffer + 10s polling fallback)
- Queue-and-drain adds stateful complexity for a scenario the ticket itself calls "not a realistic risk at current scale"
- A slow client that can't drain ~200-byte events has bigger problems than a missed SSE frame

## Implementation Steps

### P0 — BufferedEventBus (KZO-117 core)

- [ ] **Create `BufferedEventBus` class** — new file in `apps/api/src/services/eventBus/`. Wraps existing `EventBus` interface. On `publishEvent()`, stores `{ seq, eventType, data, timestamp }` in a per-user ring buffer. Evicts entries older than 60 seconds. Exposes `getEventsSince(userId, lastEventId): BufferedEvent[]` for replay.
- [ ] **Per-user sequence counter** — maintained inside `BufferedEventBus`. Monotonically incrementing per user. Returned as part of the event metadata so `sseRoute` can use it as the SSE `id:` field.
- [ ] **Wire `BufferedEventBus` into app initialization** — replace or wrap the existing `EventBus` instance on `app.eventBus` so all publishers automatically buffer. Existing `publishEvent()` callers should not need changes.

### P1 — SSE Replay on Reconnect (KZO-117 server-side)

- [ ] **Replay logic in `sseRoute.ts`** — when `Last-Event-ID` header is present and parseable:
  1. Call `bufferedEventBus.getEventsSince(userId, lastEventId)`
  2. If events found, write each as an SSE frame (with original `id:`) before subscribing to live events
  3. If no events found (buffer empty or gap too old), skip replay silently — safety net covers it
  4. Log telemetry: `sse_replay` with `userId`, `lastEventId`, `replayedCount`, `gapSize`
- [ ] **Sequence continuity** — `writeEvent()` must use the `BufferedEventBus` sequence counter for the SSE `id:` field instead of the current per-connection `seq`. This ensures IDs are monotonic across reconnections.
- [ ] **Update existing `Last-Event-ID` telemetry** — current code at `sseRoute.ts:101-115` logs `sse_reconnect` with `gapSize: "unknown_new_connection"`. Update to use actual gap size from buffer.

### P1 — Write Backpressure (KZO-118)

- [ ] **Drop-and-warn in `writeEvent()`** — `apps/api/src/routes/sseRoute.ts`. Check `reply.raw.write()` return value. If `false`, log `console.warn("[sseRoute] backpressure: dropped event", { eventType, userId, seq })` and return without writing. The existing try/catch for `ERR_STREAM_DESTROYED` remains.

### P2 — Tests

- [ ] **Integration test: replay on reconnect** — connect, receive events, disconnect, trigger events while disconnected, reconnect with `Last-Event-ID`, verify replayed events arrive with correct IDs. Use the established listen+fetch pattern from `sse.integration.test.ts`.
- [ ] **Integration test: buffer TTL eviction** — publish event, wait >60s (or mock timer), reconnect — verify no replay (buffer expired).
- [ ] **Integration test: buffer empty on fresh connection** — connect without `Last-Event-ID`, verify normal event flow (no replay attempt).
- [ ] **Unit test: BufferedEventBus** — `publishEvent` stores in buffer, `getEventsSince` returns correct range, TTL eviction works, sequence counter increments monotonically.
- [ ] **Integration test: backpressure drop** — simulate slow client (pause socket read), send events, verify warning logged and connection survives.

## Out of Scope

- **KZO-119** — Reconnect detection heuristic (obsolete once Last-Event-ID replay lands)
- **KZO-120** — Remove `connection: keep-alive` header (trivial, separate cleanup)
- **KZO-121** — Distributed connection counting (single-instance, not needed yet)
- **Redis Streams** — future work when horizontal scaling arrives
- **Client-side replay awareness** — browser handles `Last-Event-ID` natively; no new client logic unless testing reveals a need

## References

- SSE debate note: `.worklog/debate/sse-fix-debate.md`
- KZO-114 SSE reliability scope: `docs/004-notes/kzo-114/scope-todo-202603251700-sse-reliability.md`
- SSE route: `apps/api/src/routes/sseRoute.ts`
- EventBus (memory): `apps/api/src/services/eventBus/memory.ts`
- EventBus (redis): `apps/api/src/services/eventBus/redis.ts`
- Event stream hook: `apps/web/hooks/useEventStream.ts`
- Transaction mutations hook: `apps/web/features/portfolio/hooks/useTransactionMutations.ts`
