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

---

## MemoryPersistence dual-store mirror — admin-row stores must mirror unconditionally

When MemoryPersistence gains a **new feature-specific store** (separate from the legacy per-user catalog map) that admin endpoints / global-scope queries read from, every test-seed path that writes to the legacy store **must also unconditionally mirror** to the new store — regardless of `userId` scope. Admin/global-scope rows are catalog-global by design; gating the mirror on `userId === undefined` (or any per-user condition) creates a silent split between what tests seed and what admin endpoints see.

```ts
// ❌ Wrong — mirror gated on userId; admin endpoint sees empty store when seed carries a session
_seedInstrument(instrument, userId?: string) {
  this._catalogForWrite(userId).set(key, instrument);
  if (userId === undefined) {
    this._adminInstrumentMemRows.set(adminKey, toAdminRow(instrument));  // gate is wrong
  }
}

// ✅ Correct — mirror is unconditional
_seedInstrument(instrument, userId?: string) {
  this._catalogForWrite(userId).set(key, instrument);
  this._adminInstrumentMemRows.set(adminKey, toAdminRow(instrument));    // always
}
```

**Why:** KZO-195 iter 4 introduced a userId-gated mirror; iter 7 surfaced the bug only when Suite 7 (E2E OAuth admin smoke) finally reached its assertion — the QA spec's seed call carries a session userId → bypassed the mirror → admin endpoint saw empty rows. Iter 8 dropped the gate. Caught only after suites 7+8 finally executed mid-convergence; suites 1-4 (unit) cannot exercise the seed→admin-endpoint round trip and gave false-green for 4 iterations.

**How to apply:**
- Any new feature-specific store added to `MemoryPersistence` that admin/global queries read from → audit `_replaceInstruments`, `_seedInstrument`, `_replaceX`, etc. for unconditional mirroring.
- Test verification: run the related E2E spec full-pass (Suite 7 / Suite 8), not just the unit suite. Unit tests don't traverse the seed → admin-endpoint path.
- Code Reviewer checklist for any PR adding a new `_*MemRows` map: grep every test-seed write path; flag any conditional mirror as MEDIUM unless explicitly justified.
