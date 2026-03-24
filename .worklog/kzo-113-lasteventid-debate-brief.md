# Debate Brief: lastEventId Gap Recovery Depth for KZO-113

Date: 2026-03-23

## Contested Question

How deep should the `lastEventId` reconnection gap recovery be implemented in the phase 1 SSE infrastructure (KZO-113)?

## Context

KZO-113 is building generic SSE infrastructure with Redis pub/sub bridge for the Fastify API + Next.js frontend. The first real consumer will be cascade recompute status (KZO-114), but five additional consumers are visible on the roadmap (quote refresh, bar ingestion, provider health, mismatch flagging).

The SSE spec defines `Last-Event-ID` as a reconnection protocol — when EventSource reconnects, it sends the last received event ID so the server can replay missed events. This requires server-side event buffering.

The prior debate (unanimous, 3-of-3) decided to build SSE now rather than poll. That debate listed `lastEventId` as implementation constraint #5: "needed for market data, not critical for recompute."

## Codebase State

- Redis exists but is minimal — single command connection for quote cache + idempotency keys. No pub/sub yet.
- No event buffering infrastructure exists.
- Recompute is currently synchronous and sub-second for typical portfolios.
- `EventSource` natively sends `Last-Event-ID` header on reconnect — this is browser behavior, not optional.
- Five future consumers: quote refresh (KZO-87), bar ingestion (KZO-85/86), provider health (KZO-91), mismatch flagging (KZO-89).

## Positions

### Scope-Grill Interviewer (recommends Option 2):
**Option 2 — Protocol-compliant but shallow:** Assign monotonic event IDs and include them in SSE `id:` field, but on reconnect do NOT replay missed events. Client handles gaps by refetching state. This is cheap, forward-compatible, and avoids buffer complexity. When a market data ticket needs replay, add the buffer without changing the wire protocol.

### User (wants debate):
Undecided — wants the team to argue the three options before committing.

## The Three Options

**Option 1 — Full implementation:**
- Monotonic event IDs per user channel
- Server-side circular buffer (last N events per user in Redis list with TTL)
- On reconnect, replay all events after `Last-Event-ID`
- Cost: Buffer management, TTL tuning, replay logic, Redis memory per user

**Option 2 — Protocol-compliant but shallow:**
- Monotonic event IDs per user channel, sent in SSE `id:` field
- On reconnect, server acknowledges `Last-Event-ID` but does NOT replay — just resumes stream
- Client coded to handle gaps (refetch current state on reconnect)
- Cost: Minimal — just ID generation + header parsing
- Forward-compatible: buffer can be added later without wire protocol change

**Option 3 — Defer entirely:**
- No event IDs in phase 1
- On reconnect, stream resumes with no awareness of what was missed
- Client has no `Last-Event-ID` to send
- Cost: Zero
- Risk: Adding event IDs later changes the wire format (clients must be updated)

## Evidence

- SSE spec: `id:` field is optional but EventSource always sends `Last-Event-ID` if present
- Current recompute is sub-second — gap recovery unlikely to matter for this consumer
- Market data consumers (KZO-87, KZO-85/86) will care about missed events
- Redis LPUSH/LTRIM provides O(1) circular buffer if needed later
- The `useEventStream()` React hook will be the single client — wire format changes are contained

## Key Tensions

1. **YAGNI vs forward-compatibility** — Option 3 is cheapest now but creates a wire format migration. Option 2 is nearly as cheap but avoids the migration.
2. **Buffer complexity vs consumer needs** — Option 1 serves future market data consumers but adds Redis memory management that no current consumer needs.
3. **Client behavior** — EventSource always reconnects. Without event IDs (Option 3), the browser reconnects but neither side knows what was missed. With IDs but no replay (Option 2), at least the server knows the gap size and can log/alert.

## Visual Diagrams

```
Option 1 (Full):
Client ──reconnect──► Server
  Last-Event-ID: 42    │
                        ├─ lookup buffer[userId]
                        ├─ find events after #42
                        └─ replay #43, #44, #45 → Client

Option 2 (Shallow):
Client ──reconnect──► Server
  Last-Event-ID: 42    │
                        ├─ log "client reconnected, last=#42"
                        └─ resume stream from #46 → Client
                        (client refetches state independently)

Option 3 (Defer):
Client ──reconnect──► Server
  (no Last-Event-ID)    │
                        └─ resume stream → Client
                        (neither side knows what was missed)
```
