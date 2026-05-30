# useEventStream Pre-Connect Pattern

When using `useEventStream` in a component that triggers a mutation and awaits SSE confirmation, always use `enabled: true` (pre-connect) and manage loading state separately. Never use the EventSource open/close state as the loading indicator.

**The problem:**
If `useEventStream` is configured with `enabled: someCondition`, the EventSource only opens when the condition becomes true. But the backend may fire SSE events via `setImmediate` (before the next React render cycle) after the triggering action. Those events are emitted before the client's EventSource is connected — and are silently lost.

```tsx
// ❌ Wrong — events lost if backend fires via setImmediate
const { isConnected } = useEventStream({
  enabled: recomputingSymbols.size > 0,  // Opens AFTER mutation triggered
});

const handleRecompute = async () => {
  const res = await fetch("/api/recompute");
  // Backend might fire SSE events NOW, before condition becomes true
};
```

**Correct pattern:**
```tsx
// ✅ Correct — EventSource always open
const recomputingSymbols = useRef(new Set<string>());

const { isConnected } = useEventStream({
  enabled: true,  // Pre-connect, always listening
});

const handleRecompute = async (symbol: string) => {
  recomputingSymbols.current.add(symbol);  // Client-side state
  setMutating(true);                        // Loading indicator

  try {
    const res = await fetch("/api/recompute");
    // Backend fires recompute_complete event
    // Client's EventSource is already open, event is received
  } finally {
    recomputingSymbols.current.delete(symbol);
    setMutating(false);
  }
};

// Render loading UI based on client state, not EventSource connection
{mutating && <span>Recomputing...</span>}
```

**Key insight:**
Separate concerns:
- **EventSource connection state** = network readiness (always true after `enabled: true`)
- **Loading UI state** = business logic (your mutation status Ref or state)

**Why:** Discovered in KZO-114 PR2 during SSE timing analysis. The `recompute_started` and `recompute_complete` events can arrive within the same event loop turn as the 202 response. A race between mutation and conditional enable guarantees event loss on fast machines.

**How to apply:**
- When implementing mutations that await SSE confirmation, use `enabled: true`
- Manage loading state separately (Ref, state variable, or store)
- Do not use `isConnected` or EventSource lifecycle as the loading indicator
