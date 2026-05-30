---
name: instrument_type_nullability
description: InstrumentType | null widening pattern — each consumer needs its own null guard, MemoryInstrument is a separate type not in the chain
type: project
---

When widening `InstrumentType` to nullable (e.g., for catalog sync), the null propagates beyond domain/persistence types into multiple consumers:

- `dashboard.ts` — `mapInstrumentOption` must filter null types to keep `InstrumentOptionDto` non-null
- `portfolio.ts` — `createTransaction` needs a defense-in-depth null guard (line 65)
- `registerRoutes.ts` — route-level guard at the trade creation boundary
- `memory.ts` — `MemoryInstrument` internal type must be widened alongside `InstrumentDef.type`

## MemoryInstrument is a separate internal type

`MemoryInstrument` in `apps/api/src/persistence/memory.ts` is NOT derived from `InstrumentDef`. It is a standalone internal interface used only by the in-memory persistence backend. When widening `InstrumentDef.type` to nullable, `MemoryInstrument.instrumentType` must be widened separately.

This matters for QA: tests that seed instruments with `_seedInstrument({ instrumentType: null })` won't compile unless `MemoryInstrument` is also updated.

**Why:** TypeScript can't narrow across function boundaries, so each consumer that expects non-null `InstrumentType` needs its own guard. `MemoryInstrument` is easy to miss since it's not in the type chain — discovered in KZO-83 when QA's trade guard test failed to compile.

**How to apply:** Any future type widening on `InstrumentRef.instrumentType`:
1. Check all consumers in `dashboard.ts`, `portfolio.ts`, and `registerRoutes.ts` — each needs its own null guard
2. Grep for `MemoryInstrument` in `memory.ts` and widen in parallel
3. Run typecheck after widening to catch any remaining consumers
