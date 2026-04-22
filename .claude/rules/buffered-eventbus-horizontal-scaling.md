# BufferedEventBus: Local EventEmitter vs Inner-Bus Delegation

`BufferedEventBus` currently uses its **own** `EventEmitter` for pub/sub instead of delegating to the inner `EventBus` (`InMemoryEventBus` or `RedisEventBus`). The inner bus is kept only for `close()` lifecycle delegation. This is correct for single-instance deployment but will break cross-instance delivery when horizontal scaling lands (KZO-121).

## The current shape

```ts
class BufferedEventBus implements EventBus {
  private readonly local = new EventEmitter();
  private readonly inner: EventBus;  // InMemoryEventBus OR RedisEventBus

  publishEvent(userId, event) {
    // Enrich with seq
    const seqEvent = { ...event, seq: nextSeq(userId) };
    // Publish to LOCAL bus only (seq delivered cleanly)
    this.local.emit(`user:${userId}`, seqEvent);
    // Inner bus NOT notified — would lose seq in cross-instance transport
  }

  close() {
    // Only close() delegates
    return this.inner.close();
  }
}
```

## Why the inner bus is not used for publish today

Delivering `seq` through the inner bus is fragile:
- Inner `EventBus` handlers receive `{ type, data }` without seq in the event envelope.
- Correlating seq back through async Redis delivery breaks with multiple subscribers (different consumers would derive different seq values for the same event).
- Local `EventEmitter` is correct for single-instance — publishers and subscribers share the same process memory, seq is authoritative.

## The scaling path (KZO-121)

When KZO-121 (distributed connection counting) or horizontal scaling arrives, `BufferedEventBus.publishEvent()` must also delegate to the inner bus for cross-instance Redis transport:

- **Local EventEmitter** — same-instance delivery, authoritative seq
- **Inner bus (Redis)** — cross-instance delivery, must preserve seq through the transport

Both paths need seq enrichment, and the two subscriber sets (local + cross-instance) must not double-fire for same-instance subscribers. Options:
1. Publish locally AND to inner bus; local subscribers filter out echoes from inner bus by instance-id
2. Publish only to inner bus; all subscribers go through the Redis path (simpler but adds latency to same-instance delivery)

Decision deferred to KZO-121 scoping. This rule exists so the decision is **made**, not accidentally sidestepped.

## Why this is a rule (not a memory note)

Promoted from auto-memory during KZO-159 shutdown. The original memory entry was load-bearing for KZO-121 scoping work. Promoting to a rule ensures:
- Future Architects designing KZO-121 see this explicitly, not via archaeology
- Any PR that touches `BufferedEventBus.publishEvent()` gets a cross-instance review flag

## How to apply

- Any PR that modifies `BufferedEventBus.publishEvent()`, `BufferedEventBus` constructor wiring, or the inner-bus interface: read this rule, confirm the change is compatible with the eventual cross-instance path, or explicitly document the divergence.
- When KZO-121 begins: revisit this file as the design-reference starting point.
- Do NOT "clean up" the dual-path structure (local + inner close delegation) on the assumption that the inner bus is unused — it is load-bearing for the lifecycle and will become load-bearing for publish when horizontal scaling lands.
