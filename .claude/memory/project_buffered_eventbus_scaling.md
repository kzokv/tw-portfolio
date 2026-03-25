---
name: project_buffered_eventbus_scaling
description: BufferedEventBus uses local EventEmitter — must extend for horizontal scaling (KZO-121)
type: project
---

`BufferedEventBus` uses its own `EventEmitter` for pub/sub instead of delegating to the inner `EventBus` (InMemoryEventBus or RedisEventBus). The inner bus is kept only for `close()` lifecycle delegation.

**Why:** Delivering `seq` through the inner bus is fragile — inner EventBus handlers receive `{ type, data }` without seq, and correlating seq back through async Redis delivery breaks with multiple subscribers. Local EventEmitter is correct for single-instance.

**How to apply:** When KZO-121 (distributed connection counting) or horizontal scaling arrives, `BufferedEventBus.publishEvent()` must also delegate to the inner bus for cross-instance Redis transport. The local EventEmitter handles same-instance delivery; the inner bus handles cross-instance delivery. Both paths need seq enrichment.
