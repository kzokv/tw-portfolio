# Account Shape Extension — 4-File Touch-Point Checklist

When extending the `AccountDto` shape (e.g. KZO-167 added `defaultCurrency`, `accountType`; KZO-179 added multi-account creation surface; KZO-180 added reporting-currency consumer), four files must change in the same PR. This rule names every touch-point so future Architect briefs and pre-PR reviews can grep against a fixed list rather than rediscover the layout per ticket.

## The four touch-points

1. **`libs/shared-types/src/index.ts`** — extend the `AccountDto` interface; add any new literal-union types (e.g. `AccountDefaultCurrency`, `AccountType`).
2. **`apps/api/src/services/store.ts:~67`** (`createStore`) — **the canonical default-account literal.** Backs both `MemoryPersistence` (via pure pass-through in `loadStore()`) AND is the source of truth for the seed shape.
3. **`apps/api/src/persistence/postgres.ts`** — three subsites:
   - INSERT at the default-seed site (~L430)
   - INSERT at the saveStore upsert (~L2233) AND its `DO UPDATE SET` clause
   - SELECT projection at the row-rebuild (~L2077) — column → camelCase mapping
4. **`apps/api/src/types/store.ts`** (sometimes) — if you're collapsing a duplicate `Account` interface to point at `AccountDto` instead.

## "MemoryPersistence mirror" is a misnomer

`MemoryPersistence` itself does NOT need an account-literal change. Its `loadStore()` (`apps/api/src/persistence/memory.ts:907`) is pure pass-through over `createStore()`. Searching `MemoryPersistence` for the default-account literal is a wasted detour — older scope-todos use the phrasing "MemoryPersistence mirror" for what is actually `services/store.ts:67`.

**Why:** Saved iteration 2 of KZO-167 — the Implementer needed an explicit pointer at `services/store.ts:67` because the scope-todo's "MemoryPersistence mirror" phrasing pointed at the wrong file. KZO-179 and KZO-180 then followed the same checklist cleanly.

**How to apply:** Any future ticket that adds fields to the account shape uses this 4-file checklist as the implementation skeleton. Architect must name `services/store.ts:67` explicitly in the Implementer brief, not delegate to "and the MemoryPersistence mirror." Pre-PR code review: grep new field name across all 4 touch-points; missing any is a HIGH finding.

---

## Companion: Deterministic cash-entry IDs from trade IDs

`apps/api/src/services/cashLedgerService.ts` exports `buildTradeSettlementCashEntry(tx)` whose `id` field is `cash-${tx.id}`. Calling it twice with the same `tx` produces the same `id` — **by design.** This is what lets `replaceCashLedgerEntryForTrade(store, tx.id, entry)` find and replace the prior entry on fee-profile recompute.

```ts
// ❌ Wrong — IDs are deterministic, not random
expect(e1.id).not.toBe(e2.id);

// ✅ Correct
expect(entry.id).toBe(`cash-${tx.id}`);
```

**Why:** Iter 1 of KZO-167 had a unit test asserting `e1.id !== e2.id` for two calls with the same `tx`. The assertion was wrong because the design is intentional — IDs are derived deterministically from the trade ID for idempotent settlement tracking on fee-profile recompute (Path 3 in KZO-167's emission paths).

**How to apply:** When unit-testing `buildTradeSettlementCashEntry` (or any other `${prefix}-${idSource}` deterministic-ID builder), assert on the exact derived ID format, never on per-call uniqueness. Same logic applies to any future deterministic-id builder this codebase ships — look for the `${prefix}-${idSource}` template.
