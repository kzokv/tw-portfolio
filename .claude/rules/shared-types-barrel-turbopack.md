# Shared-Types Barrel: Turbopack Value-Export Trap

When adding the **first runtime value export** to a previously type-only barrel (typically `libs/shared-types/src/index.ts`), re-audit every sibling `export *` statement. Any pure-type submodule must be downgraded to `export type *` — otherwise Turbopack fails to resolve the submodule at bundle time.

**The failure is invisible to `tsc --noEmit` and Vitest.** It only surfaces when Next.js goes through Turbopack's resolver at `next dev` / `next build` / E2E time. The symptom is late and confusing — typecheck green, vitest green, E2E fails on page load with a module-not-found-style error.

## The mechanics

A type-only barrel (all `import type` / `export type *`) is erased at bundle time — Turbopack never needs to actually resolve submodule paths. Add one runtime value export (e.g. a zod schema, a function) and the barrel suddenly becomes real JS that Turbopack must process. At that point any sibling `export * from "./pure-types.js"` where `pure-types.ts` has no runtime exports can blow up because Turbopack tries to resolve `./pure-types.js` as a real module.

## The pattern

```ts
// libs/shared-types/src/index.ts

// Pure-type submodule — downgrade to `export type *`
export type * from "./events.js";
export type * from "./user.js";

// Mixed submodule (has both types AND values) — keep `export *`
export * from "./dashboard.js";

// First-time runtime value export
export { parsePerformanceRange } from "./performance-range.js";
export { dashboardPerformanceRangesSchema } from "./performance-range.js";
```

## Audit checklist (when adding the first runtime value export)

1. Grep every `export *` statement in the barrel
2. For each, open the target file and check: does it have any `export` of a value (function, const, class)?
   - **Yes** → keep `export *`
   - **No, only types** → change to `export type *`
3. Run `npm run test:e2e:oauth:mem --prefix apps/web` (or equivalent E2E suite that exercises Turbopack) before claiming the change is safe — unit tests will not catch this.

## Why

Surfaced during KZO-159 (158A) Task #5 full-suite gate. `libs/shared-types/src/index.ts` previously had only `import type` re-exports. Backend Implementer added `parsePerformanceRange` + `dashboardPerformanceRangesSchema` as first runtime value exports. Typecheck + vitest stayed green; E2E OAuth suite caught the broken `export * from "./events.js"` at bundle time. Architect promoted it as a strong rule candidate during shutdown — this is exactly the kind of gotcha that bites again when undocumented.

## How to apply

- Any time a shared-types (or other cross-package) barrel transitions from type-only to mixed (types + runtime values).
- Also applies to any `libs/*/src/index.ts` barrel that is imported by `apps/web` — Turbopack governs the whole bundle graph, not just web app files.
- Pre-PR code review item: if the diff adds a runtime `export` to a barrel, verify the sibling `export *` audit was performed.
