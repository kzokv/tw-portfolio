---
name: sse_preconnect_race
description: useEventStream with enabled:condition loses events if backend fires via setImmediate — pre-connect with enabled:true instead
type: project
---

When `useEventStream` is configured with `enabled: someCondition` (e.g., `enabled: recomputingSymbols.size > 0`), the `EventSource` only opens when the condition becomes `true`. If the backend fires SSE events via `setImmediate` (before the next React render cycle after the triggering action), those events are emitted before the client's EventSource is connected — and are silently lost.

**The fix:** Pre-connect the EventSource with `enabled: true` so it is open before the mutation is triggered. Use client-side state to track whether to show the loading UI, rather than relying on the EventSource connection state as the loading indicator.

**Why:** Discovered in KZO-114 PR2 during SSE timing analysis. The `recompute_started` and `recompute_complete` events can arrive within the same event loop turn as the 202 response; conditional enable means the race is guaranteed to lose on fast machines.

**How to apply:** When using `useEventStream` in a component that triggers a mutation and then awaits SSE confirmation, use `enabled: true` and manage the "waiting for recompute" state separately (e.g., a `recomputingSymbols: Set<string>` ref). Do not use the EventSource open/close state as the loading indicator.
