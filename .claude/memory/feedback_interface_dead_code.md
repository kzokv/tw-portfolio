---
name: Interface-driven persistence design produces dead code
description: When designing persistence interfaces with many methods, verify all methods have callers before shipping
type: feedback
---

When designing a persistence interface (e.g., `IPostgresClient`) with many methods upfront for a complex feature, some methods may end up unused if the route implementation takes a different path than initially designed. Example: `updateTradeEventDerivedFields` was designed for separate fee updates but the PATCH route inlined fees into `updateTradeEvent`.

**Why:** KZO-114 code review caught an unused method. Dead interface methods create maintenance burden and confusion about the intended data flow.

**How to apply:** Before submitting a PR that introduces or extends a persistence interface, grep for all method names and verify each has at least one caller outside the interface definition.
