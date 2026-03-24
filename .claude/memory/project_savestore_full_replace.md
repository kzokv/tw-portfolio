---
name: saveStore full-replace — scoped replay methods required
description: saveStore deletes ALL user trade events — replay functions must use scoped persistence methods, never saveStore
type: project
---

The existing `saveStore` in `postgres.ts` uses a full-replace strategy: it deletes ALL trade events for a user and re-inserts everything. Any async recompute function (e.g. `replayPositionHistory`) that runs after a 202 response CANNOT use `saveStore` — it would destroy accounting data for all symbols, not just the affected account+symbol pair.

**Why:** Discovered during KZO-114 debate. The scope decisions assumed `saveStore` could be used for replay, but this is architecturally incompatible with scoped (per-account+symbol) replay.

**How to apply:** When writing any function that mutates accounting state for a subset of a user's data, use targeted persistence methods (`deleteLotsForAccountSymbol`, `bulkUpsertLots`, etc.) rather than `saveStore`.
