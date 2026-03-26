# Test Placement: Persistence Backend Selection

`MemoryPersistence` has structural gaps that make certain tests meaningless at the unit layer. Route them to `test/integration/` (Postgres-backed) instead.

**Known MemoryPersistence gaps:**

| Feature | MemoryPersistence | PostgresPersistence |
|---|---|---|
| Email uniqueness | No enforcement (silent overwrite) | Enforced via partial unique index |
| `linkedAt` / `lastSeenAt` | Always `null` | Populated from DB timestamps |
| User lookup by userId | O(n) scan | O(1) indexed by primary key |

**Test placement rule:**
- **409 email conflict tests** (duplicate email → 409) must go in `test/integration/` — MemoryPersistence doesn't enforce uniqueness, so the 409 will never fire there, producing a false-green test.
- **Timestamp assertions** (`linkedAt`, `lastSeenAt`) must go in `test/integration/`.

**Why:** KZO-78 QA discovered A8 (duplicate email → 409) coverage was missing from the integration layer because the test was written against MemoryPersistence and passed silently without triggering a conflict.

**How to apply:** When writing tests for email uniqueness, conflict resolution, or identity timestamp assertions, use `test/integration/` with a real Postgres backend.
