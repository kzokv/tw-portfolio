---
name: memory-persistence-gaps
description: MemoryPersistence limitations that affect test placement and assertion correctness
type: project
---

`MemoryPersistence` (the in-memory backend) has several structural gaps compared to `PostgresPersistence`. These affect which tests belong in the unit layer vs the Postgres integration layer.

**Known gaps:**

| Feature | MemoryPersistence | PostgresPersistence |
|---|---|---|
| Email uniqueness | No enforcement (silent overwrite) | Enforced via partial unique index |
| `linkedAt` / `lastSeenAt` | Always `null` (fields not tracked) | Populated from DB timestamps |
| User lookup by userId | O(n) scan of `usersByEmail` map | O(1) indexed by primary key |

**Test placement rule:**
- **409 email conflict tests** (e.g. A8: duplicate email → 409) belong in the Postgres integration layer, not in API shape tests backed by MemoryPersistence. MemoryPersistence doesn't enforce uniqueness, so the 409 will never fire there.

**Why:** KZO-78 QA discovered that A8 coverage was missing from the integration test suite because it was written against MemoryPersistence. The test passed silently without triggering a conflict.

**How to apply:** When writing tests for email uniqueness, conflict resolution, or identity timestamp assertions, route them to `test/integration/` (Postgres-backed) rather than unit-level tests using MemoryPersistence.
