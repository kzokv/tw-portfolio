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

---

## Companion: Relative runtime-submodule re-export resolution failure (KZO-196)

A complementary failure mode arises when you try to extract runtime value exports into a **separate submodule file** (`gics.ts`) and re-export it via `export * from "./gics.js"` from the barrel. Under the standard Turbopack/webpack value-export audit (above), this looks safe — the barrel already has runtime exports, so adding another is routine. However, when `apps/web/tsconfig.json` aliases `@vakwen/shared-types` to the direct source path (`libs/shared-types/src/index.ts`), webpack resolves the barrel *by filename*. A relative `./gics.js` import inside the barrel then fails to resolve because webpack looks for the file relative to the **aliased entry point**, not the physical disk path — there is no `gics.js` adjacent to the webpack-resolved path.

**The failure is invisible to `tsc --noEmit` and Vitest.** It only surfaces when Next.js runs through webpack/Turbopack at `next build` / E2E time.

### Remedies (choose one)

| Option | Description | Trade-off |
|---|---|---|
| **(a) Inline into `index.ts`** | Move the submodule content directly into the barrel. No relative import needed. | Barrel grows; harder to tree-shake. KZO-196's chosen workaround. |
| **(b) Add `extensionAlias` to Next.js webpack config** | In `apps/web/next.config.mjs`: `config.resolve.extensionAlias = { '.js': ['.ts', '.js'] }`. Tells webpack to try `.ts` when it sees `.js`. | Requires a Next.js config change; may affect other packages. |
| **(c) Build to `dist/`** | Give `libs/shared-types` a proper build step (e.g. `tsup`) that emits real `.js` files. The alias in `tsconfig.json` then points at `dist/index.js`, and relative imports resolve physically. | Requires adding a build step and coordinating `package.json` `exports`. |

### KZO-196 experience

`libs/shared-types/src/gics.ts` was created with 11 sectors × 25 industry-group entries and four exported helpers. The barrel re-exported it via `export * from "./gics.js"`. All suites except Suite 6 (E2E) were green. Suite 6 failed on page load with a webpack module-not-found-style error because `apps/web/tsconfig.json`'s `@vakwen/shared-types` alias resolved to `libs/shared-types/src/index.ts`, and webpack could not find `./gics.js` relative to that resolved path.

**Resolution in KZO-196:** inlined the content into `index.ts` (option a). KZO-202 tracks the proper extraction once `extensionAlias` lands.

### How to apply

- Before creating a new runtime-value submodule file in `libs/shared-types/src/` (or any package aliased by `apps/web/tsconfig.json`), verify whether `apps/web/tsconfig.json` uses a **direct-source alias** (e.g. `"@vakwen/shared-types": ["libs/shared-types/src/index.ts"]`) or a **dist alias** (e.g. pointing at `dist/`).
- If a direct-source alias is in place AND you want a separate submodule file: either use option (b) or (c), or inline the content into the barrel (option a) until the alias is updated.
- The sibling rule (above the separator) covers the **first-value-export audit** when the barrel transitions from type-only to mixed. This companion covers the **relative-import resolution gap** for subsequent submodule additions.
- KZO-202 is the follow-up ticket. Once it lands, `gics.ts` can be extracted and both rules should be updated to reflect the resolved alias strategy.
