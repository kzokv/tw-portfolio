---
slug: kzo-114
source: scope-grill
created: 2026-03-25
tickets: [KZO-114]
required_reading:
  - .worklog/debate/sse-fix-debate.md
superseded_by: null
---

# Todo: KZO-114 — SSE Reliability Hardening

> **For agents starting a fresh session:** read all files listed in `required_reading` above before starting implementation.

## Design Decision

**SSE as preferred fast path + 10-second polling safety net.**

- SSE delivers events instantly when connection is healthy (95% case)
- 10-second safety net timer fires only if SSE delivered nothing
- SSE delivery (success or failure) cancels the safety net timer
- Safety net refreshes data silently, clears loading state with neutral message: "Portfolio updated."
- Log a warning (`console.warn` or structured log) when safety net fires instead of SSE

## Implementation Steps

### P0 — Crash Fixes (trivial)

- [ ] **Gap B: try/catch in `writeEvent()`** — `apps/api/src/routes/sseRoute.ts:130-133`. Wrap `reply.raw.write()` in try/catch to prevent `ERR_STREAM_DESTROYED` when Redis callback fires after socket close. The catch block should be silent (close handler will clean up).

```ts
function writeEvent(eventType: string, data: unknown): void {
  try {
    seq++;
    reply.raw.write(`id: ${seq}\nevent: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch {
    // Socket already destroyed — close handler will clean up
  }
}
```

- [ ] **Gap G: try/catch in `scheduleReplayWithRetry` catch block** — `apps/api/src/services/replayPositionHistory.ts:197-202`. The `await eventBus.publishEvent()` inside the first catch block (and inside the retry's catch at line 218) can throw if Redis is disconnected, producing an unhandled promise rejection inside `setImmediate`. Wrap both `publishEvent` calls in try/catch.

### P1 — Safety Net Rewrite

- [ ] **Rewrite fallback timer in `useTransactionMutations`** — `apps/web/features/portfolio/hooks/useTransactionMutations.ts:347-364`. Replace the current 2-second unconditional "success" timer with:
  1. A `sseDeliveredRef` boolean, set to `true` in `handleSSEEvent` when any event arrives
  2. A 10-second timer that checks `sseDeliveredRef`:
     - If `true` → timer was already cancelled by SSE, no-op (defensive)
     - If `false` → SSE was silent; log warning, call `refresh()`, clear loading state, show "Portfolio updated." (new i18n key: `mutations.safetyNetMessage`)
  3. SSE event handler (`handleSSEEvent`) cancels the safety net timer on any delivery (success or failure)
  4. Remove the current 30-second hard timeout — the 10s safety net replaces it
  5. Keep the `recompute_failed` → error message path in SSE handler (SSE failure messaging still takes priority when SSE is working)

- [ ] **Add i18n key** — `apps/web/features/dashboard/i18n.ts` and `apps/web/lib/i18n/types.ts`: add `mutations.safetyNetMessage` → "Portfolio updated." for all locales

- [ ] **Add structured warning log** — when safety net fires, log: `console.warn("[useTransactionMutations] SSE silent for recompute — safety net fired", { symbols: [...recomputingSymbols] })`

### P1 — Retry Resilience

- [ ] **Gap D: Sliding-window retry reset** — `apps/web/hooks/useEventStream.ts`. The current `open` handler (line 50-52) already resets `retryCountRef` to 0 on successful connection. Enhance with a stability window:
  1. Track `lastStableTimestampRef` — set to `Date.now()` on each `open` event
  2. On `error`, only increment `retryCountRef` if `Date.now() - lastStableTimestampRef < 60_000` (connection was not stable for 60s)
  3. If the connection was stable for 60+ seconds before the error, reset `retryCountRef` to 0 instead of incrementing — this was a transient drop, not a persistent failure
  4. This prevents tunnel jitter (cloudflared restart, Cloudflare edge failover) from permanently exhausting MAX_RETRIES

## Out of Scope (separate ticket)

- **Gap A** — Event replay buffer with Last-Event-ID (10s polling backstop covers missed events)
- **Gap C** — Write backpressure handling (low event volume, 512M container, max 5 connections)
- **Gap E** — Reconnect detection heuristic (polling backstop covers; obsolete once Gap A lands)
- **Gap F** — `connection: keep-alive` header (cosmetic, HTTP/2 ignores it)
- **Gap H** — Instance-local connection counting (single instance today)

## References

- Debate note: `.worklog/debate/sse-fix-debate.md`
- SSE route: `apps/api/src/routes/sseRoute.ts`
- Event stream hook: `apps/web/hooks/useEventStream.ts`
- Transaction mutations: `apps/web/features/portfolio/hooks/useTransactionMutations.ts`
- Replay service: `apps/api/src/services/replayPositionHistory.ts`
